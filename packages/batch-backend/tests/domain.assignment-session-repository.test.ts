import './support/bootstrap-pg-test-env.js';

import { createHash, randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function resetTables() {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('TRUNCATE TABLE assignment_sessions RESTART IDENTITY CASCADE');
  });
}

async function insertUserAndStudent(userId: string, studentId: string) {
  const workspaceId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, 'hash', 'user') ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@example.test`],
    );
    await client.query(`INSERT INTO workspaces (id, name) VALUES ($1, 'Assignment test')`, [
      workspaceId,
    ]);
    await client.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
    await client.query(
      `INSERT INTO students (id, student, workspace_id) VALUES ($1, 'Alpha Tester', $2)`,
      [studentId, workspaceId],
    );
  });
}

async function insertStudentConfirmedSession(params: {
  id: string;
  userId: string;
  studentId: string;
  recordingId?: string;
}) {
  return withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    if (params.recordingId) {
      await client.query(
        `
        INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status,
          source_identity_kind, source_fingerprint_scheme, source_fingerprint)
        VALUES ($1::uuid, 'upload', $2, $3, 12, 'ingested', 'audio',
          'prepared-media-sha256-v1', replace(($1::uuid)::text, '-', '') || replace(($1::uuid)::text, '-', ''))
        ON CONFLICT (id) DO NOTHING
        `,
        [params.recordingId, params.studentId, `s3://recordings/${params.recordingId}.mp3`],
      );
    }
    return client.query(
      `
      INSERT INTO assignment_sessions (
        id, user_id, student_id, recording_id, revision, confirmed_step, confirmed_snapshot
      )
      VALUES ($1, $2, $3, $4, 1, 'student', $5::jsonb)
      RETURNING revision, confirmed_step, confirmed_snapshot
      `,
      [
        params.id,
        params.userId,
        params.studentId,
        params.recordingId ?? null,
        JSON.stringify({
          student: { studentId: params.studentId },
          source: null,
          context: null,
          create: null,
        }),
      ],
    );
  });
}

async function createMixedSourceConfirmationFixture(params: {
  workingVersion: number;
  contentHash: string;
  mappingWorkingVersion: number;
  mappingContentHash: string;
}) {
  const userId = randomUUID();
  const studentId = randomUUID();
  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  await insertUserAndStudent(userId, studentId);
  const repository = await import('../src/domain/assignment-session-repository.js');
  const session = await repository.confirmStudentAssignmentSession({
    userId,
    requestId: randomUUID(),
    studentId,
    lessonId: null,
  });
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO recordings
         (id, source, student_id, storage_uri, bytes, status, audio_topology,
          source_identity_kind, source_fingerprint_scheme, source_fingerprint)
       VALUES ($1::uuid, 'upload', $2, $3, 12, 'transcribed', 'mixed_recording', 'audio',
         'prepared-media-sha256-v1', replace(($1::uuid)::text, '-', '') || replace(($1::uuid)::text, '-', ''))`,
      [recordingId, studentId, `local://recordings/${recordingId}.mp3`],
    );
    await client.query(
      `INSERT INTO transcripts
         (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
          mode, model, language, fallback_used, summary_json)
       VALUES ($1, $2, $3, $4, $5, 'elevenlabs', 'timeline', 'scribe_v2', 'auto', false, $6::jsonb)`,
      [
        transcriptId,
        recordingId,
        `local://transcripts/${transcriptId}.txt`,
        params.workingVersion,
        params.contentHash,
        JSON.stringify({
          audioTopology: 'mixed_recording',
          speakerTracks: { speakers: [{ speaker: 0 }, { speaker: 1 }] },
          speakerRoleMapping: {
            version: 'speaker-role-mapping-v1',
            provenance: 'tutor_confirmed',
            confidence: null,
            roles: [
              { speaker: 0, role: 'teacher' },
              { speaker: 1, role: 'student' },
            ],
            confirmedWorkingVersion: params.mappingWorkingVersion,
            confirmedContentHash: params.mappingContentHash,
          },
        }),
      ],
    );
  });
  await repository.attachAssignmentSourceCandidate({
    id: session.id,
    userId,
    expectedRevision: session.revision,
    recordingId,
    transcriptId,
  });
  return { userId, studentId, recordingId, transcriptId, sessionId: session.id, ...params };
}

async function confirmMixedSource(
  repository: Pick<
    typeof import('../src/domain/assignment-session-repository.js'),
    'confirmAssignmentSessionStepPersistence'
  >,
  fixture: Awaited<ReturnType<typeof createMixedSourceConfirmationFixture>>,
) {
  return repository.confirmAssignmentSessionStepPersistence({
    id: fixture.sessionId,
    userId: fixture.userId,
    request: {
      step: 'source',
      expectedRevision: 2,
      lessonId: null,
      recordingId: fixture.recordingId,
      transcriptId: fixture.transcriptId,
      transcriptWorkingVersion: fixture.workingVersion,
    },
    lessonMemory: {
      schemaVersion: 'lesson-memory-test-v1',
      provider: 'openai',
      model: 'test-model',
      requestedAt: new Date(),
    },
  });
}

async function createInitialEnrichmentWithEvidence(status: 'ready' | 'failed') {
  const fixture = await createMixedSourceConfirmationFixture({
    workingVersion: 1,
    contentHash: 'a'.repeat(64),
    mappingWorkingVersion: 1,
    mappingContentHash: 'a'.repeat(64),
  });
  const repository = await import('../src/domain/assignment-session-repository.js');
  const confirmed = await confirmMixedSource(repository, fixture);
  const operationId = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('UPDATE lesson_memory_entries SET status = $2 WHERE id = $1', [
      confirmed.lessonMemoryIntent?.entryId,
      status,
    ]);
    const result = await client.query<{ id: string }>(
      'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
      [fixture.sessionId],
    );
    return result.rows[0]!.id;
  });
  return { fixture, confirmed, operationId };
}

describe('domain/assignment-session-repository persistence contract', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('creates one source-bound onboarding intent and atomically activates one evidence revision', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const first = await confirmMixedSource(repository, fixture);
    await confirmMixedSource(repository, fixture);
    const before = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const operations = await client.query<{ id: string; profile_id: string; state: string }>(
        `SELECT id, profile_id, state FROM profile_initial_enrichment_operations
         WHERE assignment_session_id = $1`,
        [fixture.sessionId],
      );
      const profile = await client.query<{ provenance: string }>(
        'SELECT provenance FROM profiles WHERE id = $1',
        [operations.rows[0]?.profile_id],
      );
      await client.query(
        `UPDATE lesson_memory_entries SET status = 'ready'
         WHERE id = $1`,
        [first.lessonMemoryIntent?.entryId],
      );
      return { operations: operations.rows, provenance: profile.rows[0]?.provenance };
    });
    expect(before.operations).toHaveLength(1);
    expect(before.operations[0]?.state).toBe('waiting_evidence');
    expect(before.provenance).toBe('tutor_only');
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const generate = async () => ({
      structuredProfile: {
        schemaVersion: 'foundational_profile_v1' as const,
        overallLevel: 'B1',
        primaryGoals: ['Practise clear updates'],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
      rawOutput: {},
      rawText: '{}',
      provider: 'openai' as const,
      model: 'test-model',
    });
    await reconcileProfileInitialEnrichmentOperation(
      before.operations[0]!.id,
      loadConfig(),
      generate,
    );
    await reconcileProfileInitialEnrichmentOperation(
      before.operations[0]!.id,
      loadConfig(),
      generate,
    );
    const after = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const operations = await client.query<{ state: string; result_revision_id: string }>(
        'SELECT state, result_revision_id FROM profile_initial_enrichment_operations WHERE id = $1',
        [before.operations[0]!.id],
      );
      const profile = await client.query<{ provenance: string; active_revision_id: string }>(
        'SELECT provenance, active_revision_id FROM profiles WHERE id = $1',
        [before.operations[0]!.profile_id],
      );
      const revisions = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM profile_revisions WHERE profile_id = $1',
        [before.operations[0]!.profile_id],
      );
      return { operation: operations.rows[0], profile: profile.rows[0], revisions: revisions.rows };
    });
    expect(after.operation?.state).toBe('succeeded');
    expect(after.profile?.provenance).toBe('evidence_enriched');
    expect(after.profile?.active_revision_id).toBe(after.operation?.result_revision_id);
    expect(after.revisions).toEqual([
      { id: after.operation?.result_revision_id, status: 'active' },
    ]);
    const { getAssignmentLearnerContext } = await import(
      '../src/application/assignment-learner-context.js'
    );
    const learnerContext = await getAssignmentLearnerContext(fixture.userId, fixture.sessionId);
    expect(learnerContext?.state).toBe('completed');
    expect(learnerContext?.profile?.revisionId).toBe(after.operation?.result_revision_id);
    await expect(
      repository.confirmAssignmentSessionStepPersistence({
        id: fixture.sessionId,
        userId: fixture.userId,
        request: {
          step: 'context',
          expectedRevision: first.session.revision,
          teacherNotes: null,
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
      }),
    ).rejects.toThrow('ASSIGNMENT_STEP_PROFILE_STALE');
  });

  it('preserves free-form tutor seed content that structured parsing cannot round-trip', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const profileId = `profiles/${randomUUID()}.md`;
    const seedContent =
      '# About Alex\n\nNever schedule calls after 18:00.\n\n| Topic | Tutor note |\n|---|---|\n| Family | Ask privately before using in exercises |';
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO profiles (id, label, provenance) VALUES ($1, 'Tutor seed', 'tutor_only')`,
        [profileId],
      );
      await client.query('UPDATE students SET profile_id = $2 WHERE id = $1', [
        fixture.studentId,
        profileId,
      ]);
      await client.query(
        `INSERT INTO student_profile_bindings
         (id, student_id, profile_id, effective_from, reason, changed_by)
         VALUES ($1, $2, $3, NOW(), 'student_update', $4)`,
        [randomUUID(), fixture.studentId, profileId, fixture.userId],
      );
    });
    const { insertProfileRevision } = await import('../src/domain/profile-revision-repository.js');
    await insertProfileRevision({
      profileId,
      content: seedContent,
      contentHash: createHash('sha256').update(seedContent).digest('hex'),
      source: 'create',
      status: 'active',
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmed = await confirmMixedSource(repository, fixture);
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('UPDATE lesson_memory_entries SET status = $2 WHERE id = $1', [
        confirmed.lessonMemoryIntent?.entryId,
        'ready',
      ]);
      const result = await client.query<{ id: string }>(
        'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      return result.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), async () => ({
      structuredProfile: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B1',
        primaryGoals: ['Speak confidently'],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
      rawOutput: {},
      rawText: '{}',
      provider: 'openai',
      model: 'test-model',
    }));
    const result = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const operation = await client.query<{
        generation_input: { seedContent: string; seedIsStructured: boolean };
      }>('SELECT generation_input FROM profile_initial_enrichment_operations WHERE id = $1', [
        op.id,
      ]);
      const revision = await client.query<{
        content: string;
        structured_content: { teacherNotes: string };
      }>(
        `SELECT r.content, r.structured_content FROM profiles p
         JOIN profile_revisions r ON r.id = p.active_revision_id WHERE p.id = $1`,
        [profileId],
      );
      return { input: operation.rows[0]!.generation_input, revision: revision.rows[0]! };
    });
    expect(result.input).toMatchObject({ seedContent, seedIsStructured: false });
    expect(result.revision.content).toContain(seedContent);
    expect(result.revision.structured_content.teacherNotes).toContain(seedContent);
    expect(result.revision.content).toContain('Speak confidently');
  });

  it('merges a structured starter seed without copying its rendered Markdown into Teacher Notes', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const profileId = `profiles/${randomUUID()}.md`;
    const structuredSeed = {
      schemaVersion: 'foundational_profile_v1' as const,
      overallLevel: 'A2',
      primaryGoals: ['Prepare for interviews'],
      communicationContexts: ['Weekly team calls'],
      interestsAndUsefulThemes: ['Gardening'],
      stableStrengths: [],
      persistentChallenges: [],
      studyPreferences: [],
      durableConstraints: ['Avoid evening calls'],
      teacherNotes: 'Use short examples.',
    };
    const { renderFoundationalProfileContent } = await import(
      '../src/application/foundational-profile.js'
    );
    const seedContent = renderFoundationalProfileContent(structuredSeed);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO profiles (id, label, provenance) VALUES ($1, 'Structured seed', 'tutor_only')`,
        [profileId],
      );
      await client.query('UPDATE students SET profile_id = $2 WHERE id = $1', [
        fixture.studentId,
        profileId,
      ]);
      await client.query(
        `INSERT INTO student_profile_bindings
         (id, student_id, profile_id, effective_from, reason, changed_by)
         VALUES ($1, $2, $3, NOW(), 'student_update', $4)`,
        [randomUUID(), fixture.studentId, profileId, fixture.userId],
      );
    });
    const { insertProfileRevision } = await import('../src/domain/profile-revision-repository.js');
    await insertProfileRevision({
      profileId,
      content: seedContent,
      contentHash: createHash('sha256').update(seedContent).digest('hex'),
      structuredContent: structuredSeed,
      source: 'create',
      status: 'active',
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmed = await confirmMixedSource(repository, fixture);
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('UPDATE lesson_memory_entries SET status = $2 WHERE id = $1', [
        confirmed.lessonMemoryIntent?.entryId,
        'ready',
      ]);
      const result = await client.query<{ id: string }>(
        'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      return result.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), async () => ({
      structuredProfile: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B1',
        primaryGoals: ['Speak confidently'],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: 'Practice aloud.',
      },
      rawOutput: {},
      rawText: '{}',
      provider: 'openai',
      model: 'test-model',
    }));
    const result = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const operation = await client.query<{
        generation_input: { seedContent: string; seedIsStructured: boolean };
      }>('SELECT generation_input FROM profile_initial_enrichment_operations WHERE id = $1', [
        op.id,
      ]);
      const revision = await client.query<{
        content: string;
        structured_content: {
          primaryGoals: string[];
          communicationContexts: string[];
          durableConstraints: string[];
          teacherNotes: string;
        };
      }>(
        `SELECT r.content, r.structured_content FROM profiles p
         JOIN profile_revisions r ON r.id = p.active_revision_id WHERE p.id = $1`,
        [profileId],
      );
      return { input: operation.rows[0]!.generation_input, revision: revision.rows[0]! };
    });
    expect(result.input).toMatchObject({ seedContent, seedIsStructured: true });
    expect(result.revision.structured_content.primaryGoals).toEqual([
      'Prepare for interviews',
      'Speak confidently',
    ]);
    expect(result.revision.structured_content.communicationContexts).toContain('Weekly team calls');
    expect(result.revision.structured_content.durableConstraints).toContain('Avoid evening calls');
    expect(result.revision.structured_content.teacherNotes).toBe(
      'Use short examples.\n\nPractice aloud.',
    );
    expect(result.revision.structured_content.teacherNotes).not.toContain('# Foundational Profile');
    expect(result.revision.content).not.toContain('Original tutor-authored profile (verbatim)');
  });

  it('does not resubmit an ambiguous reserved provider call after duplicate delivery', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmed = await confirmMixedSource(repository, fixture);
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('UPDATE lesson_memory_entries SET status = $2 WHERE id = $1', [
        confirmed.lessonMemoryIntent?.entryId,
        'ready',
      ]);
      const rows = await client.query<{ id: string }>(
        'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      return rows.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let rejectProvider!: (reason: Error) => void;
    const provider = new Promise<never>((_resolve, reject) => {
      rejectProvider = reject;
    });
    const generate = vi.fn(async () => {
      enter();
      return provider;
    });
    const first = reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), generate);
    await entered;
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), generate);
    expect(generate).toHaveBeenCalledTimes(1);
    rejectProvider(new Error('provider timeout after submission'));
    await first;
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), generate);
    expect(generate).toHaveBeenCalledTimes(1);
    const state = await withPgClientSessionContext({ rlsBypass: true }, async (client) =>
      client.query<{ state: string; submission_id: string }>(
        'SELECT state, submission_id FROM profile_initial_enrichment_operations WHERE id = $1',
        [op.id],
      ),
    );
    expect(state.rows[0]?.state).toBe('uncertain');
    expect(state.rows[0]?.submission_id).toBeTruthy();
  });

  it('expires an unresolved reserved submission without making another provider call', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    await confirmMixedSource(repository, fixture);
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query<{ id: string }>(
        'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      await client.query(
        `UPDATE profile_initial_enrichment_operations
         SET state = 'submitting', submission_id = $2,
           submission_reserved_at = NOW() - INTERVAL '16 minutes' WHERE id = $1`,
        [result.rows[0]!.id, randomUUID()],
      );
      await client.query('UPDATE transcripts SET content_hash = $2 WHERE id = $1', [
        fixture.transcriptId,
        'b'.repeat(64),
      ]);
      return result.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const generate = vi.fn();
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), generate);
    const result = await withPgClientSessionContext({ rlsBypass: true }, async (client) =>
      client.query<{ state: string; failure_code: string }>(
        'SELECT state, failure_code FROM profile_initial_enrichment_operations WHERE id = $1',
        [op.id],
      ),
    );
    expect(result.rows[0]).toEqual({
      state: 'uncertain',
      failure_code: 'submission_unresolved',
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it('blocks Context while preparing, then pins and replays the enriched revision', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmedSource = await confirmMixedSource(repository, fixture);
    await expect(
      repository.confirmAssignmentSessionStepPersistence({
        id: fixture.sessionId,
        userId: fixture.userId,
        request: {
          step: 'context',
          expectedRevision: confirmedSource.session.revision,
          teacherNotes: 'Practice introductions',
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_STEP_PROFILE_PREPARING' });
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('UPDATE lesson_memory_entries SET status = $2 WHERE id = $1', [
        confirmedSource.lessonMemoryIntent?.entryId,
        'ready',
      ]);
      const result = await client.query<{ id: string }>(
        'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      return result.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), async () => ({
      structuredProfile: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B1',
        primaryGoals: ['Generated goal'],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
      rawOutput: {},
      rawText: '{}',
      provider: 'openai',
      model: 'test-model',
    }));
    const active = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query<{
        profile_id: string;
        active_revision_id: string;
        content_hash: string;
      }>(
        `SELECT p.id AS profile_id, p.active_revision_id, r.content_hash
         FROM profiles p JOIN profile_revisions r ON r.id = p.active_revision_id
         JOIN students s ON s.profile_id = p.id WHERE s.id = $1`,
        [fixture.studentId],
      );
      return result.rows[0]!;
    });
    const request = {
      step: 'context' as const,
      expectedRevision: confirmedSource.session.revision,
      teacherNotes: 'Practice introductions',
      profileId: active.profile_id,
      profileRevisionId: active.active_revision_id,
      profileRevisionHash: active.content_hash,
    };
    const confirmedContext = await repository.confirmAssignmentSessionStepPersistence({
      id: fixture.sessionId,
      userId: fixture.userId,
      request,
    });
    const replay = await repository.confirmAssignmentSessionStepPersistence({
      id: fixture.sessionId,
      userId: fixture.userId,
      request,
    });
    expect(replay.session.confirmed.context).toEqual(confirmedContext.session.confirmed.context);
    expect(replay.session.revision).toBe(confirmedContext.session.revision);
  });

  it.each(['failed', 'uncertain'] as const)(
    'allows all-null Context fallback after %s onboarding',
    async (state) => {
      const fixture = await createMixedSourceConfirmationFixture({
        workingVersion: 1,
        contentHash: 'a'.repeat(64),
        mappingWorkingVersion: 1,
        mappingContentHash: 'a'.repeat(64),
      });
      const repository = await import('../src/domain/assignment-session-repository.js');
      const source = await confirmMixedSource(repository, fixture);
      await withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query(
          `UPDATE profile_initial_enrichment_operations SET state = $2,
           failure_code = 'controlled_failure' WHERE assignment_session_id = $1`,
          [fixture.sessionId, state],
        ),
      );
      const { getAssignmentLearnerContext } = await import(
        '../src/application/assignment-learner-context.js'
      );
      const projection = await getAssignmentLearnerContext(fixture.userId, fixture.sessionId);
      expect(projection?.confirmationAvailable).toBe(true);
      expect(projection?.state).toBe('failed');
      const confirmed = await repository.confirmAssignmentSessionStepPersistence({
        id: fixture.sessionId,
        userId: fixture.userId,
        request: {
          step: 'context',
          expectedRevision: source.session.revision,
          teacherNotes: 'Continue with tutor guidance',
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
      });
      expect(confirmed.session.confirmed.context?.teacherNotes).toBe(
        'Continue with tutor guidance',
      );
    },
  );

  it('preserves a tutor revision activated while generation is in flight', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmed = await confirmMixedSource(repository, fixture);
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('UPDATE lesson_memory_entries SET status = $2 WHERE id = $1', [
        confirmed.lessonMemoryIntent?.entryId,
        'ready',
      ]);
      const result = await client.query<{ id: string; profile_id: string }>(
        'SELECT id, profile_id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      return result.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let resolveProvider!: (value: any) => void;
    const provider = new Promise<any>((resolve) => {
      resolveProvider = resolve;
    });
    const first = reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), async () => {
      enter();
      return provider;
    });
    await entered;
    const { insertProfileRevision } = await import('../src/domain/profile-revision-repository.js');
    const tutor = await insertProfileRevision({
      profileId: op.profile_id,
      content: '# Tutor edit',
      contentHash: 'b'.repeat(64),
      source: 'update',
      status: 'active',
    });
    resolveProvider({
      structuredProfile: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B1',
        primaryGoals: ['Generated goal'],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
    });
    await first;
    const result = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const operation = await client.query<{ state: string }>(
        'SELECT state FROM profile_initial_enrichment_operations WHERE id = $1',
        [op.id],
      );
      const profile = await client.query<{ active_revision_id: string; provenance: string }>(
        'SELECT active_revision_id, provenance FROM profiles WHERE id = $1',
        [op.profile_id],
      );
      return { operation: operation.rows[0], profile: profile.rows[0] };
    });
    expect(result.operation?.state).toBe('superseded');
    expect(result.profile).toEqual({ active_revision_id: tutor.id, provenance: 'tutor_only' });
  });

  it('rolls back active revision deprecation and pointer change when insertion fails', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    await confirmMixedSource(repository, fixture);
    const profileId = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query<{ profile_id: string }>(
        'SELECT profile_id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      return result.rows[0]!.profile_id;
    });
    const { insertProfileRevision } = await import('../src/domain/profile-revision-repository.js');
    const original = await insertProfileRevision({
      profileId,
      content: '# Tutor seed',
      contentHash: 'b'.repeat(64),
      source: 'create',
      status: 'active',
    });
    await expect(
      insertProfileRevision({
        id: original.id,
        profileId,
        content: '# Conflicting revision',
        contentHash: 'c'.repeat(64),
        source: 'update',
        status: 'active',
      }),
    ).rejects.toBeTruthy();
    const rows = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const profile = await client.query<{ active_revision_id: string }>(
        'SELECT active_revision_id FROM profiles WHERE id = $1',
        [profileId],
      );
      const revisions = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM profile_revisions WHERE profile_id = $1',
        [profileId],
      );
      return { profile: profile.rows[0], revisions: revisions.rows };
    });
    expect(rows.profile?.active_revision_id).toBe(original.id);
    expect(rows.revisions).toEqual([{ id: original.id, status: 'active' }]);
  });

  it('recovers a lost Source onboarding intent without creating a second operation', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    await confirmMixedSource(repository, fixture);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        'DELETE FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
    });
    await repository.reconcileDeferredInitialEnrichmentIntents();
    await repository.reconcileDeferredInitialEnrichmentIntents();
    const operations = await withPgClientSessionContext({ rlsBypass: true }, async (client) =>
      client.query<{ state: string }>(
        'SELECT state FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      ),
    );
    expect(operations.rows).toEqual([{ state: 'waiting_evidence' }]);
  });

  it('reconciles stable queue delivery and terminalizes exhausted lesson evidence without starving ready work', async () => {
    const repository = await import('../src/domain/assignment-session-repository.js');
    const stale = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    await confirmMixedSource(repository, stale);
    const ready = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'b'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'b'.repeat(64),
    });
    const readyConfirmation = await confirmMixedSource(repository, ready);
    const ids = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `UPDATE profile_initial_enrichment_operations
         SET created_at = NOW() - INTERVAL '25 hours' WHERE assignment_session_id = $1`,
        [stale.sessionId],
      );
      await client.query('UPDATE lesson_memory_entries SET status = $2 WHERE id = $1', [
        readyConfirmation.lessonMemoryIntent?.entryId,
        'ready',
      ]);
      const result = await client.query<{ id: string; assignment_session_id: string }>(
        `SELECT id, assignment_session_id FROM profile_initial_enrichment_operations
         WHERE assignment_session_id = ANY($1::uuid[])`,
        [[stale.sessionId, ready.sessionId]],
      );
      return result.rows;
    });
    const staleId = ids.find((row) => row.assignment_session_id === stale.sessionId)!.id;
    const readyId = ids.find((row) => row.assignment_session_id === ready.sessionId)!.id;
    const { enqueuePendingProfileInitialEnrichments, initialEnrichmentJobId } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const delivered: Array<{ operationId: string; jobId: string }> = [];
    let dropReadyOnce = true;
    const queue = {
      reconcile: vi.fn(async (payload: { operationId: string }, options: { jobId?: string }) => {
        if (payload.operationId === readyId && dropReadyOnce) {
          dropReadyOnce = false;
          throw new Error('queue temporarily unavailable');
        }
        delivered.push({ operationId: payload.operationId, jobId: options.jobId! });
      }),
    };
    await enqueuePendingProfileInitialEnrichments(queue as never);
    await enqueuePendingProfileInitialEnrichments(queue as never);
    expect(queue.reconcile.mock.calls[0]?.[0]).toMatchObject({ operationId: readyId });
    expect(delivered).toContainEqual({
      operationId: readyId,
      jobId: initialEnrichmentJobId(readyId),
    });
    expect(delivered).toContainEqual({
      operationId: staleId,
      jobId: initialEnrichmentJobId(staleId),
    });
    const { processStudentMemoryJob } = await import(
      '../src/application/process-student-memory-job.js'
    );
    const { loadConfig } = await import('../src/config/env.js');
    await processStudentMemoryJob({
      config: loadConfig(),
      payload: { kind: 'profile-initial-enrichment', operationId: staleId },
    });
    await processStudentMemoryJob({
      config: loadConfig(),
      payload: { kind: 'profile-initial-enrichment', operationId: staleId },
    });
    const terminal = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ state: string; failure_code: string }>(
        'SELECT state, failure_code FROM profile_initial_enrichment_operations WHERE id = $1',
        [staleId],
      ),
    );
    expect(terminal.rows[0]).toEqual({
      state: 'failed',
      failure_code: 'lesson_evidence_timeout',
    });
  });

  it('supersedes waiting evidence after a tutor edit and unlocks Context', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const source = await confirmMixedSource(repository, fixture);
    const operation = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const row = await client.query<{ id: string; profile_id: string }>(
        'SELECT id, profile_id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      return row.rows[0]!;
    });
    const { insertProfileRevision } = await import('../src/domain/profile-revision-repository.js');
    const tutor = await insertProfileRevision({
      profileId: operation.profile_id,
      content: '# Tutor correction while lesson evidence is pending',
      contentHash: 'b'.repeat(64),
      source: 'update',
      status: 'active',
    });
    const { enqueuePendingProfileInitialEnrichments } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const queue = { reconcile: vi.fn().mockResolvedValue(undefined) };
    await enqueuePendingProfileInitialEnrichments(queue as never);
    expect(queue.reconcile).toHaveBeenCalledWith(
      { kind: 'profile-initial-enrichment', operationId: operation.id },
      expect.anything(),
    );
    const { processStudentMemoryJob } = await import(
      '../src/application/process-student-memory-job.js'
    );
    const { loadConfig } = await import('../src/config/env.js');
    await processStudentMemoryJob({
      config: loadConfig(),
      payload: { kind: 'profile-initial-enrichment', operationId: operation.id },
    });
    const state = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ state: string }>(
        'SELECT state FROM profile_initial_enrichment_operations WHERE id = $1',
        [operation.id],
      ),
    );
    expect(state.rows[0]?.state).toBe('superseded');
    const { getAssignmentLearnerContext } = await import(
      '../src/application/assignment-learner-context.js'
    );
    const context = await getAssignmentLearnerContext(fixture.userId, fixture.sessionId);
    expect(context?.confirmationAvailable).toBe(true);
    expect(context?.profile?.revisionId).toBe(tutor.id);
    const confirmed = await repository.confirmAssignmentSessionStepPersistence({
      id: fixture.sessionId,
      userId: fixture.userId,
      request: {
        step: 'context',
        expectedRevision: source.session.revision,
        teacherNotes: 'Tutor correction is authoritative',
        profileId: operation.profile_id,
        profileRevisionId: tutor.id,
        profileRevisionHash: tutor.contentHash,
      },
    });
    expect(confirmed.session.confirmed.context?.profileRevisionId).toBe(tutor.id);
  });

  it('holds Context through a source replacement until deferred onboarding intent exists', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const original = await confirmMixedSource(repository, fixture);
    const oldId = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const row = await client.query<{ id: string }>(
        'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      await client.query(
        `UPDATE profile_initial_enrichment_operations
         SET state = 'submitting', submission_id = $2, submission_reserved_at = NOW()
         WHERE id = $1`,
        [row.rows[0]!.id, randomUUID()],
      );
      await client.query(
        `UPDATE transcripts SET working_version = 2, content_hash = $2,
           summary_json = jsonb_set(jsonb_set(summary_json,
             '{speakerRoleMapping,confirmedWorkingVersion}', '2'::jsonb),
             '{speakerRoleMapping,confirmedContentHash}', to_jsonb($2::text))
         WHERE id = $1`,
        [fixture.transcriptId, 'b'.repeat(64)],
      );
      return row.rows[0]!.id;
    });
    const replacement = await repository.confirmAssignmentSessionStepPersistence({
      id: fixture.sessionId,
      userId: fixture.userId,
      request: {
        step: 'source',
        expectedRevision: original.session.revision,
        lessonId: null,
        recordingId: fixture.recordingId,
        transcriptId: fixture.transcriptId,
        transcriptWorkingVersion: 2,
      },
      lessonMemory: {
        schemaVersion: 'lesson-memory-test-v1',
        provider: 'openai',
        model: 'test-model',
        requestedAt: new Date(),
      },
    });
    const { getAssignmentLearnerContext } = await import(
      '../src/application/assignment-learner-context.js'
    );
    const assertPreparing = async () => {
      const context = await getAssignmentLearnerContext(fixture.userId, fixture.sessionId);
      expect(context?.state).toBe('preparing');
      expect(context?.confirmationAvailable).toBe(false);
      await expect(
        repository.confirmAssignmentSessionStepPersistence({
          id: fixture.sessionId,
          userId: fixture.userId,
          request: {
            step: 'context',
            expectedRevision: replacement.session.revision,
            teacherNotes: 'Wait for current source',
            profileId: null,
            profileRevisionId: null,
            profileRevisionHash: null,
          },
        }),
      ).rejects.toMatchObject({ code: 'ASSIGNMENT_STEP_PROFILE_PREPARING' });
    };
    await assertPreparing();
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE profile_initial_enrichment_operations SET state = 'superseded'
         WHERE id = $1`,
        [oldId],
      ),
    );
    await assertPreparing();
    await repository.reconcileDeferredInitialEnrichmentIntents();
    const rows = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ state: string; transcript_hash: string }>(
        `SELECT state, transcript_hash FROM profile_initial_enrichment_operations
         WHERE assignment_session_id = $1 ORDER BY created_at`,
        [fixture.sessionId],
      ),
    );
    expect(rows.rows).toContainEqual({
      state: 'waiting_evidence',
      transcript_hash: 'b'.repeat(64),
    });
    await assertPreparing();
  });

  it('fails onboarding when exact lesson-memory generation has terminally failed', async () => {
    const { operationId } = await createInitialEnrichmentWithEvidence('failed');
    const { enqueuePendingProfileInitialEnrichments } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const queue = { reconcile: vi.fn().mockResolvedValue(undefined) };
    await enqueuePendingProfileInitialEnrichments(queue as never);
    expect(queue.reconcile).toHaveBeenCalledWith(
      { kind: 'profile-initial-enrichment', operationId },
      expect.objectContaining({ jobId: `profile-initial-enrichment-${operationId}` }),
    );
    const { processStudentMemoryJob } = await import(
      '../src/application/process-student-memory-job.js'
    );
    const { loadConfig } = await import('../src/config/env.js');
    await processStudentMemoryJob({
      config: loadConfig(),
      payload: { kind: 'profile-initial-enrichment', operationId },
    });
    const result = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ state: string; failure_code: string }>(
        'SELECT state, failure_code FROM profile_initial_enrichment_operations WHERE id = $1',
        [operationId],
      ),
    );
    expect(result.rows[0]).toEqual({
      state: 'failed',
      failure_code: 'lesson_evidence_failed',
    });
  });

  it('defers before execution through pacing and releases the provider reservation', async () => {
    const { operationId } = await createInitialEnrichmentWithEvidence('ready');
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const { StudentMemoryPacingDeferredError } = await import(
      '../src/application/student-memory-generation-pacing.js'
    );
    const deferred = new StudentMemoryPacingDeferredError({
      reason: 'budget_rpm_minute',
      provider: 'openai',
      model: 'test-model',
      notBefore: new Date(Date.now() + 60_000),
      estimatedTokens: 100,
    });
    const generator = vi.fn();
    const pacer = { run: vi.fn().mockRejectedValue(deferred) };
    await expect(
      reconcileProfileInitialEnrichmentOperation(
        operationId,
        loadConfig(),
        generator,
        pacer as never,
      ),
    ).rejects.toBe(deferred);
    expect(pacer.run).toHaveBeenCalledWith(
      expect.objectContaining({
        workload: 'profile_initial_enrichment',
        recordUsage: false,
      }),
    );
    expect(generator).not.toHaveBeenCalled();
    const row = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ state: string; submission_id: string | null }>(
        'SELECT state, submission_id FROM profile_initial_enrichment_operations WHERE id = $1',
        [operationId],
      ),
    );
    expect(row.rows[0]).toEqual({ state: 'queued', submission_id: null });
  });

  it('terminalizes a non-minute budget preflight without reserving provider submission', async () => {
    const { operationId } = await createInitialEnrichmentWithEvidence('ready');
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const { GenerationBudgetExceededError } = await import(
      '../src/application/generation-budget-guard.js'
    );
    const generator = vi.fn();
    const pacer = {
      run: vi.fn().mockRejectedValue(
        new GenerationBudgetExceededError({
          provider: 'openai',
          model: 'test-model',
          limitType: 'daily_requests',
          limit: 1,
          used: 1,
          window: 'day',
          message: 'daily budget exhausted',
        }),
      ),
    };
    await reconcileProfileInitialEnrichmentOperation(
      operationId,
      loadConfig(),
      generator,
      pacer as never,
    );
    const row = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ state: string; failure_code: string; submission_id: string | null }>(
        'SELECT state, failure_code, submission_id FROM profile_initial_enrichment_operations WHERE id = $1',
        [operationId],
      ),
    );
    expect(row.rows[0]).toEqual({
      state: 'failed',
      failure_code: 'budget_unavailable',
      submission_id: null,
    });
    expect(generator).not.toHaveBeenCalled();
  });

  it.each([
    { status: 400, category: 'provider_contract_error', state: 'failed' },
    { status: 429, category: 'provider_rate_limit', state: 'queued' },
  ] as const)('classifies a definite provider $status rejection as $state', async (caseInfo) => {
    const { operationId } = await createInitialEnrichmentWithEvidence('ready');
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const { ProfileRevisionDraftingError } = await import(
      '../src/application/profile-revision-drafting.js'
    );
    const generator = vi.fn().mockRejectedValue(
      new ProfileRevisionDraftingError({
        category: caseInfo.category,
        provider: 'openai',
        model: 'test-model',
        message: 'definite rejection',
        rejectedBeforeExecution: true,
        providerStatus: caseInfo.status,
        ...(caseInfo.status === 429 ? { retryAfterMs: 120_000 } : {}),
      }),
    );
    const attempt = reconcileProfileInitialEnrichmentOperation(
      operationId,
      loadConfig(),
      generator,
    );
    if (caseInfo.status === 429) {
      const { StudentMemoryPacingDeferredError } = await import(
        '../src/application/student-memory-generation-pacing.js'
      );
      await expect(attempt).rejects.toMatchObject({
        name: StudentMemoryPacingDeferredError.name,
        retryAfterMs: 120_000,
        notBefore: expect.any(Date),
      });
    } else {
      await attempt;
    }
    const row = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ state: string; submission_id: string | null }>(
        'SELECT state, submission_id FROM profile_initial_enrichment_operations WHERE id = $1',
        [operationId],
      ),
    );
    expect(row.rows[0]).toEqual({ state: caseInfo.state, submission_id: null });
    expect(generator).toHaveBeenCalledTimes(1);
  });

  it('does not recover a lost intent from a stale confirmed transcript', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    await confirmMixedSource(repository, fixture);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        'DELETE FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      await client.query(
        'UPDATE transcripts SET working_version = working_version + 1 WHERE id = $1',
        [fixture.transcriptId],
      );
    });
    await repository.reconcileDeferredInitialEnrichmentIntents();
    const operations = await withPgClientSessionContext({ rlsBypass: true }, async (client) =>
      client.query(
        'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      ),
    );
    expect(operations.rows).toEqual([]);
  });

  it('replays the same confirmed source without restarting a terminal operation', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    await confirmMixedSource(repository, fixture);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `UPDATE profile_initial_enrichment_operations SET state = 'failed',
         failure_code = 'model_unavailable' WHERE assignment_session_id = $1`,
        [fixture.sessionId],
      );
    });
    await confirmMixedSource(repository, fixture);
    const rows = await withPgClientSessionContext({ rlsBypass: true }, async (client) =>
      client.query<{ state: string }>(
        'SELECT state FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      ),
    );
    expect(rows.rows).toEqual([{ state: 'failed' }]);
  });

  it('discards a persisted result when canonical Source ownership has changed', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    await confirmMixedSource(repository, fixture);
    const { renderFoundationalProfileContent } = await import(
      '../src/application/foundational-profile.js'
    );
    const profileResult = {
      schemaVersion: 'foundational_profile_v1' as const,
      overallLevel: 'B1',
      primaryGoals: ['Generated goal'],
      communicationContexts: [],
      interestsAndUsefulThemes: [],
      stableStrengths: [],
      persistentChallenges: [],
      studyPreferences: [],
      durableConstraints: [],
      teacherNotes: null,
    };
    const content = renderFoundationalProfileContent(profileResult);
    const { createHash } = await import('node:crypto');
    const resultHash = createHash('sha256').update(content, 'utf8').digest('hex');
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query<{ id: string; profile_id: string }>(
        'SELECT id, profile_id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      await client.query(
        `UPDATE profile_initial_enrichment_operations
         SET state = 'result_ready', validated_result = $2::jsonb, result_hash = $3
         WHERE id = $1`,
        [result.rows[0]!.id, JSON.stringify(profileResult), resultHash],
      );
      await client.query(
        `UPDATE assignment_source_bindings SET binding_role = 'working'
         WHERE assignment_session_id = $1`,
        [fixture.sessionId],
      );
      return result.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig());
    const result = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const operation = await client.query<{ state: string }>(
        'SELECT state FROM profile_initial_enrichment_operations WHERE id = $1',
        [op.id],
      );
      const profile = await client.query<{ active_revision_id: string | null; provenance: string }>(
        'SELECT active_revision_id, provenance FROM profiles WHERE id = $1',
        [op.profile_id],
      );
      return { operation: operation.rows[0], profile: profile.rows[0] };
    });
    expect(result.operation?.state).toBe('superseded');
    expect(result.profile).toEqual({ active_revision_id: null, provenance: 'tutor_only' });
  });

  it('commits a persisted result after worker restart without provider regeneration', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    await confirmMixedSource(repository, fixture);
    const { renderFoundationalProfileContent } = await import(
      '../src/application/foundational-profile.js'
    );
    const profileResult = {
      schemaVersion: 'foundational_profile_v1' as const,
      overallLevel: 'B1',
      primaryGoals: ['Generated goal'],
      communicationContexts: [],
      interestsAndUsefulThemes: [],
      stableStrengths: [],
      persistentChallenges: [],
      studyPreferences: [],
      durableConstraints: [],
      teacherNotes: null,
    };
    const { createHash } = await import('node:crypto');
    const resultHash = createHash('sha256')
      .update(renderFoundationalProfileContent(profileResult), 'utf8')
      .digest('hex');
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query<{ id: string; profile_id: string }>(
        'SELECT id, profile_id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      await client.query(
        `UPDATE profile_initial_enrichment_operations
         SET state = 'result_ready', validated_result = $2::jsonb, result_hash = $3
         WHERE id = $1`,
        [result.rows[0]!.id, JSON.stringify(profileResult), resultHash],
      );
      return result.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const generate = vi.fn();
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), generate);
    expect(generate).not.toHaveBeenCalled();
    const result = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const operation = await client.query<{ state: string; result_revision_id: string }>(
        'SELECT state, result_revision_id FROM profile_initial_enrichment_operations WHERE id = $1',
        [op.id],
      );
      const profile = await client.query<{ active_revision_id: string; provenance: string }>(
        'SELECT active_revision_id, provenance FROM profiles WHERE id = $1',
        [op.profile_id],
      );
      return { operation: operation.rows[0], profile: profile.rows[0] };
    });
    expect(result.operation?.state).toBe('succeeded');
    expect(result.profile).toEqual({
      active_revision_id: result.operation?.result_revision_id,
      provenance: 'evidence_enriched',
    });
  });

  it('keeps a validated provider result when post-response accounting fails', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmed = await confirmMixedSource(repository, fixture);
    const op = await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('UPDATE lesson_memory_entries SET status = $2 WHERE id = $1', [
        confirmed.lessonMemoryIntent?.entryId,
        'ready',
      ]);
      const result = await client.query<{ id: string }>(
        'SELECT id FROM profile_initial_enrichment_operations WHERE assignment_session_id = $1',
        [fixture.sessionId],
      );
      return result.rows[0]!;
    });
    const { loadConfig } = await import('../src/config/env.js');
    const { reconcileProfileInitialEnrichmentOperation } = await import(
      '../src/application/profile-initial-enrichment.js'
    );
    const generator: typeof import('../src/application/profile-revision-drafting.js').generateProfileRevisionDraft =
      vi.fn(async ({ request }) => {
        await request.onValidatedResponse!({
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B1',
          primaryGoals: ['Generated goal'],
          communicationContexts: [],
          interestsAndUsefulThemes: [],
          stableStrengths: [],
          persistentChallenges: [],
          studyPreferences: [],
          durableConstraints: [],
          teacherNotes: null,
        });
        throw new Error('budget usage database write failed');
      });
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), generator);
    await reconcileProfileInitialEnrichmentOperation(op.id, loadConfig(), generator);
    expect(generator).toHaveBeenCalledTimes(1);
    const operation = await withPgClientSessionContext({ rlsBypass: true }, async (client) =>
      client.query<{ state: string }>(
        'SELECT state FROM profile_initial_enrichment_operations WHERE id = $1',
        [op.id],
      ),
    );
    expect(operation.rows[0]?.state).toBe('succeeded');
  });

  it('requires the first persisted row to contain a confirmed Student snapshot', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    await insertUserAndStudent(userId, studentId);

    const inserted = await insertStudentConfirmedSession({
      id: randomUUID(),
      userId,
      studentId,
    });

    expect(inserted.rows[0]).toEqual({
      revision: 1,
      confirmed_step: 'student',
      confirmed_snapshot: {
        student: { studentId },
        source: null,
        context: null,
        create: null,
      },
    });
  });

  it('idempotently confirms Student and CAS-updates recovery without stage or archive state', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const requestId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    const { confirmStudentAssignmentSession, updateAssignmentSessionRecovery } = await import(
      '../src/domain/assignment-session-repository.js'
    );

    const created = await confirmStudentAssignmentSession({
      userId,
      requestId,
      studentId,
      lessonId: null,
    });
    const replayed = await confirmStudentAssignmentSession({
      userId,
      requestId,
      studentId,
      lessonId: null,
    });

    expect(replayed.id).toBe(created.id);
    expect(created).toMatchObject({
      revision: 1,
      confirmedStep: 'student',
      confirmed: { student: { studentId }, source: null, context: null, create: null },
    });
    expect(created).not.toHaveProperty('currentStage');
    expect(created).not.toHaveProperty('archivedAt');

    const updated = await updateAssignmentSessionRecovery({
      id: created.id,
      userId,
      expectedRevision: 1,
      patch: { teacherNotes: 'Recovered automatically' },
    });
    expect(updated).toMatchObject({ revision: 2, teacherNotes: 'Recovered automatically' });

    await expect(
      updateAssignmentSessionRecovery({
        id: created.id,
        userId,
        expectedRevision: 1,
        patch: { teacherNotes: 'Stale tab' },
      }),
    ).rejects.toMatchObject({
      code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
      session: expect.objectContaining({ revision: 2, teacherNotes: 'Recovered automatically' }),
    });

    await expect(
      updateAssignmentSessionRecovery({
        id: created.id,
        userId,
        expectedRevision: 2,
        patch: { confirmedStep: 'share' } as never,
      }),
    ).rejects.toThrow('Assignment recovery field is not allowed');
  });

  it('returns the canonical unfinished assignment when source recovery collides', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const canonicalSessionId = randomUUID();
    const newerSessionId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    await insertStudentConfirmedSession({
      id: canonicalSessionId,
      userId,
      studentId,
      recordingId,
    });
    await insertStudentConfirmedSession({ id: newerSessionId, userId, studentId });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, working_version, content_hash, stt_provider)
         VALUES ($1, $2, 'local://transcripts/canonical.txt', 1, $3, 'deepgram')`,
        [transcriptId, recordingId, 'a'.repeat(64)],
      ),
    );
    const {
      attachAssignmentSourceCandidate,
      getCanonicalAssignmentSessionBySourceRecording,
      updateAssignmentSessionRecovery,
    } = await import('../src/domain/assignment-session-repository.js');
    await attachAssignmentSourceCandidate({
      id: canonicalSessionId,
      userId,
      expectedRevision: 1,
      recordingId,
      transcriptId,
    });

    await expect(
      updateAssignmentSessionRecovery({
        id: newerSessionId,
        userId,
        expectedRevision: 1,
        patch: { recordingId, transcriptId },
      }),
    ).rejects.toMatchObject({
      code: 'ASSIGNMENT_SOURCE_ALREADY_OWNED',
      session: expect.objectContaining({ id: canonicalSessionId, recordingId }),
    });

    const losingRecordingId = randomUUID();
    const losingTranscriptId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (
           id, source, student_id, storage_uri, bytes, status,
           source_identity_kind, source_fingerprint_scheme, source_fingerprint
         )
         SELECT $2, source, student_id, $3, bytes, status,
                source_identity_kind, source_fingerprint_scheme, source_fingerprint
         FROM recordings WHERE id = $1`,
        [recordingId, losingRecordingId, `local://recordings/${losingRecordingId}.mp3`],
      );
      await client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, working_version, content_hash, stt_provider)
         VALUES ($1, $2, $3, 1, $4, 'deepgram')`,
        [
          losingTranscriptId,
          losingRecordingId,
          `local://transcripts/${losingTranscriptId}.txt`,
          'b'.repeat(64),
        ],
      );
    });

    await expect(
      attachAssignmentSourceCandidate({
        id: newerSessionId,
        userId,
        expectedRevision: 1,
        recordingId: losingRecordingId,
        transcriptId: losingTranscriptId,
      }),
    ).resolves.toMatchObject({
      outcome: 'existing_assignment_resumed',
      session: { id: canonicalSessionId },
    });
    const retired = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `SELECT audio_lifecycle, audio_deletion_requested_at
         FROM recordings WHERE id = $1`,
        [losingRecordingId],
      ),
    );
    expect(retired.rows[0]).toMatchObject({
      audio_lifecycle: 'pending',
      audio_deletion_requested_at: expect.any(Date),
    });
    await expect(
      getCanonicalAssignmentSessionBySourceRecording({
        userId,
        studentId,
        recordingId: losingRecordingId,
      }),
    ).resolves.toMatchObject({ id: canonicalSessionId });
  });

  it('rejects mixing source attachment with unrelated recovery fields', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    const { confirmStudentAssignmentSession, updateAssignmentSessionRecovery } = await import(
      '../src/domain/assignment-session-repository.js'
    );
    const session = await confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });

    await expect(
      updateAssignmentSessionRecovery({
        id: session.id,
        userId,
        expectedRevision: session.revision,
        patch: {
          recordingId,
          transcriptId,
          teacherNotes: 'must be a separate recovery write',
        },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID' });
  });

  it('keeps an unclassified historical source readable but rejects a new canonical claim', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    const repository = await import('../src/domain/assignment-session-repository.js');
    const session = await repository.confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (
           id, source, student_id, storage_uri, audio_lifecycle, bytes, status
         ) VALUES ($1, 'manual_transcript', $2, NULL, 'not_retained', 12, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, working_version, content_hash, stt_provider,
           mode, model, language, fallback_used
         ) VALUES ($1, $2, $3, 1, $4, 'manual', 'timeline', 'manual', 'en', false)`,
        [transcriptId, recordingId, `local://transcripts/${transcriptId}.txt`, 'a'.repeat(64)],
      );
    });
    await expect(
      repository.getAssignmentSessionByIdForUser(session.id, userId),
    ).resolves.toMatchObject({
      id: session.id,
    });
    await expect(
      repository.attachAssignmentSourceCandidate({
        id: session.id,
        userId,
        expectedRevision: session.revision,
        recordingId,
        transcriptId,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_REQUIRED' });
  });

  it('rejects Student request-id reuse with different recovery identity', async () => {
    const userId = randomUUID();
    const firstStudentId = randomUUID();
    const secondStudentId = randomUUID();
    const requestId = randomUUID();
    await insertUserAndStudent(userId, firstStudentId);
    await insertUserAndStudent(userId, secondStudentId);
    const { confirmStudentAssignmentSession } = await import(
      '../src/domain/assignment-session-repository.js'
    );

    await confirmStudentAssignmentSession({
      userId,
      requestId,
      studentId: firstStudentId,
      lessonId: null,
    });

    await expect(
      confirmStudentAssignmentSession({
        userId,
        requestId,
        studentId: secondStudentId,
        lessonId: null,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SESSION_REQUEST_CONFLICT' });
  });

  it('atomically reserves one Share job from clean confirmed lineage and replays by stable id', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const draftId = randomUUID();
    const sessionId = randomUUID();
    const requestId = randomUUID();
    const draftUri = `local://drafts/${draftId}/content/confirmed.md`;
    await insertUserAndStudent(userId, studentId);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (
           id, source, student_id, storage_uri, bytes, status,
           source_identity_kind, source_fingerprint_scheme, source_fingerprint
         ) VALUES ($1::uuid, 'upload', $2, 'local://recordings/a.opus', 1, 'transcribed',
           'audio', 'prepared-media-sha256-v1',
           replace(($1::uuid)::text, '-', '') || replace(($1::uuid)::text, '-', ''))`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
            mode, model, language, fallback_used)
         VALUES ($1, $2, 'local://transcripts/a.txt', 1, $3, 'deepgram',
                 'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, 'a'.repeat(64)],
      );
      await client.query(
        `INSERT INTO prompt_packages
           (id, recording_id, transcript_id, student_id, template_version, storage_uri)
         VALUES ($1, $2, $3, $4, 'template-v1', 'local://prompts/a.txt')`,
        [promptPackageId, recordingId, transcriptId, studentId],
      );
      await client.query(
        `INSERT INTO drafts
           (id, prompt_package_id, student_id, storage_uri, working_version, content_hash, created_by)
         VALUES ($1, $2, $3, $4, 1, $5, $6)`,
        [draftId, promptPackageId, studentId, draftUri, 'b'.repeat(64), userId],
      );
      await client.query(
        `INSERT INTO assignment_sessions
           (id, user_id, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
            revision, confirmed_step, confirmed_snapshot, teacher_notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 4, 'create', $8::jsonb, 'dirty')`,
        [
          sessionId,
          userId,
          studentId,
          recordingId,
          transcriptId,
          promptPackageId,
          draftId,
          JSON.stringify({
            student: { studentId },
            source: {
              lessonId: null,
              recordingId,
              transcriptId,
              transcriptWorkingVersion: 1,
              transcriptStorageUri: 'local://transcripts/a.txt',
              transcriptHash: 'a'.repeat(64),
              sourceIdentityKind: 'audio',
              sourceFingerprintScheme: 'prepared-media-sha256-v1',
              sourceFingerprint: recordingId.replaceAll('-', '').repeat(2),
            },
            context: {
              teacherNotes: null,
              profileId: null,
              profileRevisionId: null,
              profileRevisionHash: null,
            },
            create: {
              promptPackageId,
              draftId,
              draftWorkingVersion: 1,
              draftStorageUri: draftUri,
              draftHash: 'b'.repeat(64),
            },
          }),
        ],
      );
      await client.query(
        `INSERT INTO assignment_source_bindings (
           id, workspace_id, user_id, student_id, assignment_session_id,
           source_identity_kind, source_fingerprint_scheme, source_fingerprint,
           binding_role, recording_id, transcript_id
         )
         SELECT $1, s.workspace_id, $2, $3, $4, 'audio', 'prepared-media-sha256-v1',
                replace(($5::uuid)::text, '-', '') || replace(($5::uuid)::text, '-', ''),
                'confirmed', $5, $6
         FROM students s WHERE s.id = $3`,
        [randomUUID(), userId, studentId, sessionId, recordingId, transcriptId],
      );
    });
    const { completeAssignmentShare, publishAssignmentCorrectionJob, reserveAssignmentShare } =
      await import('../src/domain/assignment-session-repository.js');

    await expect(
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SHARE_DIRTY_RECOVERY' });

    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query('UPDATE assignment_sessions SET teacher_notes = NULL WHERE id = $1', [
        sessionId,
      ]),
    );
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE transcripts SET storage_uri = 'local://transcripts/b.txt', working_version = 2,
         content_hash = $2 WHERE id = $1`,
        [transcriptId, 'c'.repeat(64)],
      ),
    );
    await expect(
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SHARE_DIRTY_RECOVERY' });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE transcripts SET storage_uri = 'local://transcripts/a.txt', working_version = 1,
         content_hash = $2 WHERE id = $1`,
        [transcriptId, 'a'.repeat(64)],
      ),
    );
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE drafts SET storage_uri = 'local://drafts/working-b.md', working_version = 2,
         content_hash = $2 WHERE id = $1`,
        [draftId, 'd'.repeat(64)],
      ),
    );
    await expect(
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SHARE_DIRTY_RECOVERY' });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE drafts SET storage_uri = $2, working_version = 1,
         content_hash = $3 WHERE id = $1`,
        [draftId, draftUri, 'b'.repeat(64)],
      ),
    );
    const [first, second] = await Promise.all([
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
      reserveAssignmentShare({
        sessionId,
        userId,
        expectedRevision: 4,
        requestId,
        jobConfig: { publishTarget: 'html', upload: 'auto' },
      }),
    ]);
    const reserved = first.created ? first : second;
    const replay = first.created ? second : first;

    expect(reserved).toMatchObject({
      created: true,
      session: { shareJobId: requestId, revision: 5, confirmedStep: 'create' },
      job: { id: requestId, mdStorageUri: draftUri, state: 'awaiting_approval' },
    });
    expect(replay).toMatchObject({ created: false, job: { id: requestId } });
    const {
      approveAssignmentShareJob,
      approveJob,
      updateAssignmentShareJobDraftLink,
      updateJobDraftLink,
    } = await import('../src/domain/job-repository.js');
    await expect(
      updateJobDraftLink({
        id: requestId,
        expectedState: 'awaiting_approval',
        draftId,
        mdStorageUri: 'local://drafts/operator-replacement.md',
      }),
    ).resolves.toBeNull();
    await expect(
      approveJob({
        id: requestId,
        expectedState: 'awaiting_approval',
        mdStorageUri: draftUri,
      }),
    ).resolves.toBeNull();
    await expect(
      updateAssignmentShareJobDraftLink({
        id: requestId,
        sessionId,
        userId,
        expectedState: 'awaiting_approval',
        draftId,
        mdStorageUri: draftUri,
      }),
    ).resolves.toMatchObject({ id: requestId, draftId, mdStorageUri: draftUri });
    await expect(
      approveAssignmentShareJob({
        id: requestId,
        sessionId,
        userId,
        expectedState: 'awaiting_approval',
        mdStorageUri: draftUri,
      }),
    ).resolves.toMatchObject({ id: requestId, state: 'queued' });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(`UPDATE jobs SET state = 'failed' WHERE id = $1`, [requestId]),
    );
    await expect(
      completeAssignmentShare({
        sessionId,
        userId,
        jobId: requestId,
        enqueueSatisfied: false,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_SHARE_JOB_INTEGRITY_INVALID' });
    await expect(
      completeAssignmentShare({
        sessionId,
        userId,
        jobId: requestId,
        enqueueSatisfied: true,
      }),
    ).resolves.toMatchObject({ confirmedStep: 'share', revision: 6 });
    const jobs = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM jobs WHERE id = $1', [
        requestId,
      ]),
    );
    expect(jobs.rows[0]?.count).toBe('1');
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE jobs
         SET state = 'succeeded', html_url = 'https://example.test/share',
             manifest_path = 's3://manifests/share.json'
         WHERE id = $1`,
        [requestId],
      ),
    );

    for (const correctionFirst of [false, true]) {
      const correctionRequest = {
        requestId: randomUUID(),
        draftId,
        draftWorkingVersion: 1,
        draftHash: 'b'.repeat(64),
      };
      const shareReplay = () =>
        reserveAssignmentShare({
          sessionId,
          userId,
          expectedRevision: 6,
          requestId,
          jobConfig: { publishTarget: 'html', upload: 'auto' },
        });
      const correction = () =>
        publishAssignmentCorrectionJob({
          userId,
          publishedJobId: requestId,
          request: correctionRequest,
        });
      const [share, correctionChild] = correctionFirst
        ? await Promise.all([correction(), shareReplay()]).then(([child, replay]) => [
            replay,
            child,
          ])
        : await Promise.all([shareReplay(), correction()]);

      expect(share).toMatchObject({ created: false, job: { id: requestId } });
      expect(correctionChild).toMatchObject({
        created: true,
        job: { id: correctionRequest.requestId, sourceJobId: requestId, state: 'queued' },
      });
    }
  });

  it('creates one queued correction child from a terminal Share snapshot and rejects mismatched replays', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const draftId = randomUUID();
    const parentId = randomUUID();
    const requestId = randomUUID();
    const draftHash = 'b'.repeat(64);
    const draftUri = `local://drafts/${draftId}/content/${draftHash}.md`;
    await insertUserAndStudent(userId, studentId);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 'local://recordings/a.opus', 1, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
            mode, model, language, fallback_used)
         VALUES ($1, $2, 'local://transcripts/a.txt', 1, $3, 'deepgram',
                 'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, 'a'.repeat(64)],
      );
      await client.query(
        `INSERT INTO prompt_packages
           (id, recording_id, transcript_id, student_id, template_version, storage_uri)
         VALUES ($1, $2, $3, $4, 'template-v1', 'local://prompts/a.txt')`,
        [promptPackageId, recordingId, transcriptId, studentId],
      );
      await client.query(
        `INSERT INTO drafts
           (id, prompt_package_id, student_id, storage_uri, working_version, content_hash, created_by)
         VALUES ($1, $2, $3, $4, 3, $5, $6)`,
        [draftId, promptPackageId, studentId, draftUri, draftHash, userId],
      );
      await client.query(
        `INSERT INTO jobs
           (id, state, md_storage_uri, recording_id, transcript_id, prompt_package_id, draft_id,
            student_id, user_id, preset, with_tts, upload, publish_target, html_url, manifest_path)
         VALUES ($1, 'succeeded', $2, $3, $4, $5, $6, $7, $8, 'b1-default', true,
                 's3', 'html', 'https://example.test/parent', 's3://manifests/parent.json')`,
        [
          parentId,
          draftUri,
          recordingId,
          transcriptId,
          promptPackageId,
          draftId,
          studentId,
          userId,
        ],
      );
      await client.query(
        `INSERT INTO assignment_sessions
           (id, user_id, student_id, recording_id, transcript_id, prompt_package_id, draft_id,
            revision, confirmed_step, confirmed_snapshot, share_job_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 6, 'share', $8::jsonb, $9)`,
        [
          randomUUID(),
          userId,
          studentId,
          recordingId,
          transcriptId,
          promptPackageId,
          draftId,
          JSON.stringify({
            student: { studentId },
            source: {
              lessonId: null,
              recordingId,
              transcriptId,
              transcriptWorkingVersion: 1,
              transcriptStorageUri: 'local://transcripts/a.txt',
              transcriptHash: 'a'.repeat(64),
            },
            context: {
              teacherNotes: null,
              profileId: null,
              profileRevisionId: null,
              profileRevisionHash: null,
            },
            create: {
              promptPackageId,
              draftId,
              draftWorkingVersion: 1,
              draftStorageUri: 'local://drafts/original/content/original.md',
              draftHash: 'c'.repeat(64),
            },
          }),
          parentId,
        ],
      );
    });
    const { publishAssignmentCorrectionJob } = await import(
      '../src/domain/assignment-session-repository.js'
    );
    const request = { requestId, draftId, draftWorkingVersion: 3, draftHash };

    const [first, second] = await Promise.all([
      publishAssignmentCorrectionJob({ userId, publishedJobId: parentId, request }),
      publishAssignmentCorrectionJob({ userId, publishedJobId: parentId, request }),
    ]);
    const created = first.created ? first : second;
    const replay = first.created ? second : first;

    expect(created).toMatchObject({
      created: true,
      job: {
        id: requestId,
        state: 'queued',
        sourceJobId: parentId,
        draftId,
        md: null,
        mdStorageUri: draftUri,
        htmlUrl: null,
        manifestPath: null,
      },
    });
    expect(replay).toMatchObject({ created: false, job: { id: requestId } });
    await expect(
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: { ...request, draftHash: 'd'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_CORRECTION_REQUEST_CONFLICT' });
    await expect(
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: { ...request, draftWorkingVersion: 4 },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_CORRECTION_REQUEST_CONFLICT' });
    const competingRequest = { ...request, requestId: randomUUID() };
    const competing = await Promise.allSettled([
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: competingRequest,
      }),
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: { ...competingRequest, draftWorkingVersion: 4 },
      }),
    ]);
    expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE jobs
         SET state = 'failed', error = 'pipeline failed', started_at = NOW(), finished_at = NOW(),
             manifest_path = 's3://manifests/partial-child.json', html_url = 'https://example.test/child'
         WHERE id = $1`,
        [requestId],
      ),
    );
    const resetReplays = await Promise.all([
      publishAssignmentCorrectionJob({ userId, publishedJobId: parentId, request }),
      publishAssignmentCorrectionJob({ userId, publishedJobId: parentId, request }),
    ]);
    for (const resetReplay of resetReplays) {
      expect(resetReplay).toMatchObject({
        created: false,
        job: {
          id: requestId,
          state: 'queued',
          sourceJobId: parentId,
          draftId,
          mdStorageUri: draftUri,
          error: null,
          startedAt: null,
          finishedAt: null,
          manifestPath: null,
          htmlUrl: null,
        },
      });
    }
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(`UPDATE jobs SET state = 'failed' WHERE id = $1`, [requestId]),
    );
    await expect(
      publishAssignmentCorrectionJob({
        userId,
        publishedJobId: parentId,
        request: { ...request, draftHash: 'd'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_CORRECTION_REQUEST_CONFLICT' });
    await expect(
      withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query<{ state: string }>(`SELECT state FROM jobs WHERE id = $1`, [requestId]),
      ),
    ).resolves.toMatchObject({ rows: [{ state: 'failed' }] });
    await expect(
      withPgClientSessionContext({ rlsBypass: true }, (client) =>
        client.query(`SELECT html_url, manifest_path FROM jobs WHERE id = $1`, [parentId]),
      ),
    ).resolves.toMatchObject({
      rows: [
        { html_url: 'https://example.test/parent', manifest_path: 's3://manifests/parent.json' },
      ],
    });
  });

  it('keeps completed Share readable while direct recovery cannot reclaim its recording pointer', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const shareJobId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    const repository = await import('../src/domain/assignment-session-repository.js');

    const completed = await repository.confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status,
           source_identity_kind, source_fingerprint_scheme, source_fingerprint)
         VALUES ($1::uuid, 'upload', $2, $3, 12, 'ingested', 'audio',
           'prepared-media-sha256-v1', replace(($1::uuid)::text, '-', '') || replace(($1::uuid)::text, '-', ''))`,
        [recordingId, studentId, `s3://recordings/${recordingId}.mp3`],
      );
      await client.query(
        `INSERT INTO jobs (id, state, student_id, user_id) VALUES ($1, 'succeeded', $2, $3)`,
        [shareJobId, studentId, userId],
      );
      await client.query(
        `UPDATE assignment_sessions
         SET recording_id = $2, confirmed_step = 'share', share_job_id = $3, revision = revision + 1
         WHERE id = $1`,
        [completed.id, recordingId, shareJobId],
      );
    });

    await expect(repository.listAssignmentSessionsForUser(userId, 20)).resolves.toEqual([]);
    await expect(repository.countAssignmentSessionsForUser(userId)).resolves.toBe(0);
    await expect(
      repository.getAssignmentSessionByIdForUser(completed.id, userId),
    ).resolves.toMatchObject({
      id: completed.id,
      confirmedStep: 'share',
    });

    const next = await repository.confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    await expect(
      repository.updateAssignmentSessionRecovery({
        id: next.id,
        userId,
        expectedRevision: 1,
        patch: { recordingId },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID' });
  });

  it('fails closed when confirmed snapshot JSON is structurally malformed', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const sessionId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO assignment_sessions (
           id, user_id, student_id, revision, confirmed_step, confirmed_snapshot
         ) VALUES ($1, $2, $3, 1, 'source', $4::jsonb)`,
        [
          sessionId,
          userId,
          studentId,
          JSON.stringify({
            student: { studentId },
            source: {},
            context: null,
            create: null,
          }),
        ],
      );
    });
    const { getAssignmentSessionByIdForUser } = await import(
      '../src/domain/assignment-session-repository.js'
    );

    await expect(getAssignmentSessionByIdForUser(sessionId, userId)).rejects.toMatchObject({
      name: 'ZodError',
    });
  });

  it('does not use assignment-session recording pointers as source ownership', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const firstSessionId = randomUUID();
    const shareJobId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    await insertStudentConfirmedSession({
      id: firstSessionId,
      userId,
      studentId,
      recordingId,
    });

    await expect(
      insertStudentConfirmedSession({
        id: randomUUID(),
        userId,
        studentId,
        recordingId,
      }),
    ).resolves.toBeDefined();

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO jobs (id, state, student_id, user_id) VALUES ($1, 'succeeded', $2, $3)`,
        [shareJobId, studentId, userId],
      );
      await client.query(
        `
        UPDATE assignment_sessions
        SET confirmed_step = 'share', share_job_id = $2, revision = revision + 1
        WHERE id = $1
        `,
        [firstSessionId, shareJobId],
      );
    });

    await expect(
      insertStudentConfirmedSession({
        id: randomUUID(),
        userId,
        studentId,
        recordingId,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects completed Share without the stable linked job', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const sessionId = randomUUID();
    await insertUserAndStudent(userId, studentId);
    await insertStudentConfirmedSession({ id: sessionId, userId, studentId });

    await expect(
      withPgClientSessionContext({ rlsBypass: true }, async (client) =>
        client.query(`UPDATE assignment_sessions SET confirmed_step = 'share' WHERE id = $1`, [
          sessionId,
        ]),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects invalid revisions, steps, and malformed confirmed snapshots', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    await insertUserAndStudent(userId, studentId);

    await expect(
      withPgClientSessionContext({ rlsBypass: true }, async (client) =>
        client.query(
          `
          INSERT INTO assignment_sessions (
            id, user_id, student_id, revision, confirmed_step, confirmed_snapshot
          )
          VALUES ($1, $2, $3, 0, 'unknown', '{}'::jsonb)
          `,
          [randomUUID(), userId, studentId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps resumable indexes separate from canonical source-binding indexes', async () => {
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const indexes = await client.query<{ indexname: string; indexdef: string }>(
        `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_assignment_sessions_user_active_updated',
            'idx_assignment_sessions_lesson_updated',
            'idx_assignment_source_bindings_scoped_source',
            'idx_assignment_source_bindings_session_role'
          )
        ORDER BY indexname
        `,
      );

      expect(indexes.rows).toHaveLength(4);
      for (const index of indexes.rows.filter((row) =>
        row.indexname.startsWith('idx_assignment_sessions_'),
      )) {
        expect(index.indexdef).toContain("confirmed_step <> 'share'::text");
        expect(index.indexdef).not.toContain('archived_at');
      }
    });
  });

  it('accepts source confirmation when the tutor mapping binds the current transcript state', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 2,
      contentHash: 'b'.repeat(64),
      mappingWorkingVersion: 2,
      mappingContentHash: 'b'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');

    await expect(confirmMixedSource(repository, fixture)).resolves.toMatchObject({
      session: { confirmedStep: 'source' },
    });
    const audio = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `SELECT audio_lifecycle, audio_deletion_requested_at
         FROM recordings WHERE id = $1`,
        [fixture.recordingId],
      ),
    );
    expect(audio.rows[0]).toMatchObject({
      audio_lifecycle: 'pending',
      audio_deletion_requested_at: expect.any(Date),
    });
  });

  it('keeps confirmed binding lineage stable until same-identity replacement is confirmed', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmed = await confirmMixedSource(repository, fixture);
    const nextRecordingId = randomUUID();
    const nextTranscriptId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (
           id, source, student_id, storage_uri, bytes, status, audio_topology,
           source_identity_kind, source_fingerprint_scheme, source_fingerprint
         )
         SELECT $2, source, student_id, $3, bytes, status, audio_topology,
                source_identity_kind, source_fingerprint_scheme, source_fingerprint
         FROM recordings WHERE id = $1`,
        [fixture.recordingId, nextRecordingId, `local://recordings/${nextRecordingId}.mp3`],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, working_version, content_hash, stt_provider,
           mode, model, language, fallback_used, summary_json
         )
         SELECT $2, $3, $4, working_version, content_hash, stt_provider,
                mode, model, language, fallback_used, summary_json
         FROM transcripts WHERE id = $1`,
        [
          fixture.transcriptId,
          nextTranscriptId,
          nextRecordingId,
          `local://transcripts/${nextTranscriptId}.txt`,
        ],
      );
    });

    const attached = await repository.attachAssignmentSourceCandidate({
      id: fixture.sessionId,
      userId: fixture.userId,
      expectedRevision: confirmed.session.revision,
      recordingId: nextRecordingId,
      transcriptId: nextTranscriptId,
    });
    expect(attached).toMatchObject({
      outcome: 'source_attached',
      session: { recordingId: nextRecordingId, transcriptId: nextTranscriptId },
    });
    await expect(
      repository.attachAssignmentSourceCandidate({
        id: fixture.sessionId,
        userId: fixture.userId,
        expectedRevision: confirmed.session.revision,
        recordingId: nextRecordingId,
        transcriptId: nextTranscriptId,
      }),
    ).resolves.toMatchObject({
      outcome: 'source_attached',
      session: { revision: attached.session.revision },
    });
    const bindingBeforeConfirmation = await withPgClientSessionContext(
      { rlsBypass: true },
      (client) =>
        client.query(
          `SELECT recording_id, transcript_id FROM assignment_source_bindings
           WHERE assignment_session_id = $1 AND binding_role = 'confirmed'`,
          [fixture.sessionId],
        ),
    );
    expect(bindingBeforeConfirmation.rows[0]).toEqual({
      recording_id: fixture.recordingId,
      transcript_id: fixture.transcriptId,
    });

    const cancelled = await repository.updateAssignmentSessionRecovery({
      id: fixture.sessionId,
      userId: fixture.userId,
      expectedRevision: attached.session.revision,
      patch: { recordingId: null, transcriptId: null },
    });
    expect(cancelled).toMatchObject({
      recordingId: fixture.recordingId,
      transcriptId: fixture.transcriptId,
    });
    const reattached = await repository.attachAssignmentSourceCandidate({
      id: fixture.sessionId,
      userId: fixture.userId,
      expectedRevision: cancelled.revision,
      recordingId: nextRecordingId,
      transcriptId: nextTranscriptId,
    });
    const replaced = await repository.confirmAssignmentSessionStepPersistence({
      id: fixture.sessionId,
      userId: fixture.userId,
      request: {
        step: 'source',
        expectedRevision: reattached.session.revision,
        lessonId: null,
        recordingId: nextRecordingId,
        transcriptId: nextTranscriptId,
        transcriptWorkingVersion: 1,
      },
      lessonMemory: {
        schemaVersion: 'lesson-memory-test-v1',
        provider: 'openai',
        model: 'test-model',
        requestedAt: new Date(),
      },
    });
    expect(replaced.session.confirmed.source).toMatchObject({
      recordingId: nextRecordingId,
      transcriptId: nextTranscriptId,
    });
    const bindingAfterConfirmation = await withPgClientSessionContext(
      { rlsBypass: true },
      (client) =>
        client.query(
          `SELECT recording_id, transcript_id FROM assignment_source_bindings
           WHERE assignment_session_id = $1 AND binding_role = 'confirmed'`,
          [fixture.sessionId],
        ),
    );
    expect(bindingAfterConfirmation.rows[0]).toEqual({
      recording_id: nextRecordingId,
      transcript_id: nextTranscriptId,
    });
  });

  it('serializes competing released-source claims and gives the new owner fresh lineage', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'a'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'a'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmedA = await confirmMixedSource(repository, fixture);
    const replacementRecordingId = randomUUID();
    const replacementTranscriptId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (
           id, source, student_id, storage_uri, bytes, status,
           source_identity_kind, source_fingerprint_scheme, source_fingerprint
         ) VALUES ($1, 'upload', $2, $3, 10, 'transcribed',
           'audio', 'prepared-media-sha256-v1', $4)`,
        [
          replacementRecordingId,
          fixture.studentId,
          `local://recordings/${replacementRecordingId}.mp3`,
          'b'.repeat(64),
        ],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, working_version, content_hash, stt_provider,
           mode, model, language, fallback_used
         ) VALUES ($1, $2, $3, 1, $4, 'deepgram', 'timeline', 'nova-3', 'multi', false)`,
        [
          replacementTranscriptId,
          replacementRecordingId,
          `local://transcripts/${replacementTranscriptId}.txt`,
          'b'.repeat(64),
        ],
      );
    });
    const attachedB = await repository.attachAssignmentSourceCandidate({
      id: fixture.sessionId,
      userId: fixture.userId,
      expectedRevision: confirmedA.session.revision,
      recordingId: replacementRecordingId,
      transcriptId: replacementTranscriptId,
    });
    expect(attachedB.outcome).toBe('source_attached');
    await repository.confirmAssignmentSessionStepPersistence({
      id: fixture.sessionId,
      userId: fixture.userId,
      request: {
        step: 'source',
        expectedRevision: attachedB.session.revision,
        lessonId: null,
        recordingId: replacementRecordingId,
        transcriptId: replacementTranscriptId,
        transcriptWorkingVersion: 1,
      },
      lessonMemory: {
        schemaVersion: 'lesson-memory-test-v1',
        provider: 'openai',
        model: 'test-model',
        requestedAt: new Date(),
      },
    });

    const contenders = await Promise.all(
      [randomUUID(), randomUUID()].map((requestId) =>
        repository.confirmStudentAssignmentSession({
          userId: fixture.userId,
          requestId,
          studentId: fixture.studentId,
          lessonId: null,
        }),
      ),
    );
    const outcomes = await Promise.all(
      contenders.map((session) =>
        repository.attachAssignmentSourceCandidate({
          id: session.id,
          userId: fixture.userId,
          expectedRevision: session.revision,
          recordingId: fixture.recordingId,
          transcriptId: fixture.transcriptId,
        }),
      ),
    );
    expect(outcomes.map((result) => result.outcome).sort()).toEqual([
      'existing_assignment_resumed',
      'source_attached',
    ]);
    const owner = outcomes.find((result) => result.outcome === 'source_attached')!.session;
    const resumed = outcomes.find((result) => result.outcome === 'existing_assignment_resumed')!;
    expect(resumed.session.id).toBe(owner.id);
    expect(owner.recordingId).not.toBe(fixture.recordingId);
    expect(owner.transcriptId).not.toBe(fixture.transcriptId);
    const cloned = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{
        source_fingerprint: string;
        original_recording_id: string;
        original_transcript_id: string;
      }>(
        `SELECT r.source_fingerprint,
                $2::uuid::text AS original_recording_id,
                $3::uuid::text AS original_transcript_id
         FROM recordings r
         JOIN transcripts t ON t.recording_id = r.id
         WHERE r.id = $1 AND t.id = $4`,
        [owner.recordingId, fixture.recordingId, fixture.transcriptId, owner.transcriptId],
      ),
    );
    expect(cloned.rows[0]).toMatchObject({
      source_fingerprint: fixture.recordingId.replaceAll('-', '').repeat(2),
      original_recording_id: fixture.recordingId,
      original_transcript_id: fixture.transcriptId,
    });
  });

  it('makes operator remap authoritative immediately for bindings and late memory workers', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 1,
      contentHash: 'd'.repeat(64),
      mappingWorkingVersion: 1,
      mappingContentHash: 'd'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    const confirmed = await confirmMixedSource(repository, fixture);
    const { insertPromptPackage, isPromptPackageSourceCanonical } = await import(
      '../src/domain/prompt-package-repository.js'
    );
    const originalPackage = await insertPromptPackage({
      recordingId: fixture.recordingId,
      transcriptId: fixture.transcriptId,
      assignmentSessionId: fixture.sessionId,
      studentId: fixture.studentId,
      templateVersion: 'test',
      storageUri: 'local://prompt-packages/original.txt',
    });
    await expect(isPromptPackageSourceCanonical(originalPackage.id)).resolves.toBe(true);
    const target = await repository.confirmStudentAssignmentSession({
      userId: fixture.userId,
      requestId: randomUUID(),
      studentId: fixture.studentId,
      lessonId: null,
    });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE assignment_sessions
         SET recording_id = $2, transcript_id = $3, confirmed_step = 'source',
             confirmed_snapshot = $4::jsonb, revision = 2, updated_at = NOW()
         WHERE id = $1`,
        [
          target.id,
          fixture.recordingId,
          fixture.transcriptId,
          JSON.stringify({
            student: { studentId: fixture.studentId },
            source: confirmed.session.confirmed.source,
            context: null,
            create: null,
          }),
        ],
      ),
    );

    const remapped = await repository.remapCanonicalAssignmentSource({
      userId: fixture.userId,
      targetSessionId: target.id,
      reason: 'test historical correction',
    });
    expect(remapped).toMatchObject({
      previousSessionId: fixture.sessionId,
      session: { id: target.id },
      changed: true,
    });
    await expect(
      repository.isAssignmentConfirmedSourceCanonical(fixture.sessionId, fixture.userId),
    ).resolves.toBe(false);
    await expect(
      repository.isAssignmentConfirmedSourceCanonical(target.id, fixture.userId),
    ).resolves.toBe(true);
    await expect(isPromptPackageSourceCanonical(originalPackage.id)).resolves.toBe(false);
    const currentPackage = await insertPromptPackage({
      recordingId: fixture.recordingId,
      transcriptId: fixture.transcriptId,
      assignmentSessionId: target.id,
      studentId: fixture.studentId,
      templateVersion: 'test',
      storageUri: 'local://prompt-packages/current.txt',
    });
    await expect(isPromptPackageSourceCanonical(currentPackage.id)).resolves.toBe(true);
    const standalonePackage = await insertPromptPackage({
      recordingId: fixture.recordingId,
      transcriptId: fixture.transcriptId,
      studentId: fixture.studentId,
      templateVersion: 'test',
      storageUri: 'local://prompt-packages/standalone.txt',
    });
    await expect(isPromptPackageSourceCanonical(standalonePackage.id)).resolves.toBe(true);

    const { publishConfirmedLessonMemoryEntry } = await import(
      '../src/domain/lesson-memory-repository.js'
    );
    const source = confirmed.session.confirmed.source!;
    await expect(
      publishConfirmedLessonMemoryEntry({
        id: confirmed.lessonMemoryIntent!.entryId,
        assignmentSessionId: fixture.sessionId,
        studentId: fixture.studentId,
        transcriptId: fixture.transcriptId,
        recordingId: fixture.recordingId,
        schemaVersion: 'lesson-memory-test-v1',
        generatedAt: new Date(),
        provider: 'openai',
        model: 'test-model',
        sourceStorageUri: source.transcriptStorageUri,
        sourceContentHash: source.transcriptHash,
      }),
    ).resolves.toBeNull();
    const replayed = await repository.confirmAssignmentSessionStepPersistence({
      id: target.id,
      userId: fixture.userId,
      request: {
        step: 'source',
        expectedRevision: 2,
        lessonId: null,
        recordingId: fixture.recordingId,
        transcriptId: fixture.transcriptId,
        transcriptWorkingVersion: 1,
      },
      lessonMemory: {
        schemaVersion: 'lesson-memory-test-v1',
        provider: 'openai',
        model: 'test-model',
        requestedAt: new Date(),
      },
    });
    expect(replayed.lessonMemoryIntent).toMatchObject({
      entryId: confirmed.lessonMemoryIntent!.entryId,
      outcome: 'pending_exists',
    });
    await expect(
      publishConfirmedLessonMemoryEntry({
        id: confirmed.lessonMemoryIntent!.entryId,
        assignmentSessionId: target.id,
        studentId: fixture.studentId,
        transcriptId: fixture.transcriptId,
        recordingId: fixture.recordingId,
        schemaVersion: 'lesson-memory-test-v1',
        generatedAt: new Date(),
        provider: 'openai',
        model: 'test-model',
        sourceStorageUri: source.transcriptStorageUri,
        sourceContentHash: source.transcriptHash,
      }),
    ).resolves.toMatchObject({ assignmentSessionId: target.id, status: 'ready' });
    const audit = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `SELECT prior_assignment_session_id, canonical_assignment_session_id, action, reason
         FROM assignment_source_binding_audit
         WHERE canonical_assignment_session_id = $1`,
        [target.id],
      ),
    );
    expect(audit.rows).toEqual([
      {
        prior_assignment_session_id: fixture.sessionId,
        canonical_assignment_session_id: target.id,
        action: 'operator_remap',
        reason: 'test historical correction',
      },
    ]);
  });

  it('restores the deletion request without resetting state when Source confirmation is replayed', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 2,
      contentHash: 'd'.repeat(64),
      mappingWorkingVersion: 2,
      mappingContentHash: 'd'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');
    await confirmMixedSource(repository, fixture);
    const nextAttemptAt = new Date('2026-09-07T02:02:03.000Z');
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE recordings
         SET audio_lifecycle = 'delete_failed',
             audio_deletion_requested_at = NULL,
             audio_deletion_attempt_count = 3,
             audio_deletion_error_code = 'recording_audio_delete_failed',
             audio_deletion_next_attempt_at = $2
         WHERE id = $1`,
        [fixture.recordingId, nextAttemptAt],
      ),
    );

    await expect(confirmMixedSource(repository, fixture)).resolves.toMatchObject({
      session: { confirmedStep: 'source' },
    });
    const replayed = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `SELECT audio_lifecycle, audio_deletion_requested_at,
                audio_deletion_attempt_count, audio_deletion_error_code,
                audio_deletion_next_attempt_at, storage_uri
         FROM recordings WHERE id = $1`,
        [fixture.recordingId],
      ),
    );
    expect(replayed.rows[0]).toEqual({
      audio_lifecycle: 'delete_failed',
      audio_deletion_requested_at: expect.any(Date),
      audio_deletion_attempt_count: 3,
      audio_deletion_error_code: 'recording_audio_delete_failed',
      audio_deletion_next_attempt_at: nextAttemptAt,
      storage_uri: `local://recordings/${fixture.recordingId}.mp3`,
    });
  });

  it('keeps a cache-hit Source recording not_retained when confirmed', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 2,
      contentHash: 'e'.repeat(64),
      mappingWorkingVersion: 2,
      mappingContentHash: 'e'.repeat(64),
    });
    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE recordings SET storage_uri = NULL, audio_lifecycle = 'not_retained'
         WHERE id = $1`,
        [fixture.recordingId],
      ),
    );
    const repository = await import('../src/domain/assignment-session-repository.js');

    await expect(confirmMixedSource(repository, fixture)).resolves.toMatchObject({
      session: { confirmedStep: 'source' },
    });
    const audio = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `SELECT audio_lifecycle, audio_deletion_requested_at, storage_uri
         FROM recordings WHERE id = $1`,
        [fixture.recordingId],
      ),
    );
    expect(audio.rows[0]).toEqual({
      audio_lifecycle: 'not_retained',
      audio_deletion_requested_at: null,
      storage_uri: null,
    });
  });

  it('rejects stale mappings until the tutor reconfirms them for the current transcript state', async () => {
    const fixture = await createMixedSourceConfirmationFixture({
      workingVersion: 3,
      contentHash: 'c'.repeat(64),
      mappingWorkingVersion: 2,
      mappingContentHash: 'b'.repeat(64),
    });
    const repository = await import('../src/domain/assignment-session-repository.js');

    await expect(confirmMixedSource(repository, fixture)).rejects.toMatchObject({
      code: 'ASSIGNMENT_STEP_SPEAKER_ROLE_MAPPING_REQUIRED',
    });

    await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query(
        `UPDATE transcripts
         SET summary_json = jsonb_set(
           summary_json,
           '{speakerRoleMapping}',
           $2::jsonb
         )
         WHERE id = $1`,
        [
          fixture.transcriptId,
          JSON.stringify({
            version: 'speaker-role-mapping-v1',
            provenance: 'tutor_confirmed',
            confidence: null,
            roles: [
              { speaker: 0, role: 'teacher' },
              { speaker: 1, role: 'student' },
            ],
            confirmedWorkingVersion: 3,
            confirmedContentHash: 'c'.repeat(64),
          }),
        ],
      ),
    );

    await expect(confirmMixedSource(repository, fixture)).resolves.toMatchObject({
      session: { confirmedStep: 'source' },
    });
  });

  it('keys lesson-memory intent by transcript and confirmed source hash', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const sourceHash = 'a'.repeat(64);
    await insertUserAndStudent(userId, studentId);

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `
        INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
        VALUES ($1, 'upload', $2, 's3://recordings/memory.mp3', 12, 'ingested')
        `,
        [recordingId, studentId],
      );
      await client.query(
        `
        INSERT INTO transcripts (id, recording_id, storage_uri, stt_provider)
        VALUES ($1, $2, 's3://transcripts/memory.json', 'deepgram')
        `,
        [transcriptId, recordingId],
      );

      const insertMemory = () =>
        client.query(
          `
          INSERT INTO lesson_memory_entries (
            id, student_id, transcript_id, recording_id, schema_version, generated_at,
            provider, model, status, source_storage_uri, source_content_hash
          )
          VALUES ($1, $2, $3, $4, '1', NOW(), 'openai', 'gpt-5.6', 'pending', $5, $6)
          `,
          [
            randomUUID(),
            studentId,
            transcriptId,
            recordingId,
            's3://confirmed-transcripts/a.json',
            sourceHash,
          ],
        );

      await insertMemory();
      await expect(insertMemory()).rejects.toMatchObject({ code: '23505' });
    });
  });

  it('rejects partial working and confirmed-source provenance pairs', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    await insertUserAndStudent(userId, studentId);

    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const expectCheckViolation = async (query: () => Promise<unknown>) => {
        await client.query('SAVEPOINT expected_check_violation');
        await expect(query()).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT expected_check_violation');
        await client.query('RELEASE SAVEPOINT expected_check_violation');
      };

      await client.query(
        `
        INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
        VALUES ($1, 'upload', $2, 's3://recordings/provenance.mp3', 12, 'ingested')
        `,
        [recordingId, studentId],
      );
      await client.query(
        `
        INSERT INTO transcripts (id, recording_id, storage_uri, stt_provider)
        VALUES ($1, $2, 's3://transcripts/provenance.json', 'deepgram')
        `,
        [transcriptId, recordingId],
      );

      await expectCheckViolation(() =>
        client.query(`UPDATE transcripts SET working_version = 1 WHERE id = $1`, [transcriptId]),
      );
      await expectCheckViolation(() =>
        client.query(`UPDATE transcripts SET content_hash = $2 WHERE id = $1`, [
          transcriptId,
          'b'.repeat(64),
        ]),
      );

      const insertMemory = (sourceStorageUri: string | null, sourceContentHash: string | null) =>
        client.query(
          `
          INSERT INTO lesson_memory_entries (
            id, student_id, transcript_id, recording_id, schema_version, generated_at,
            provider, model, status, source_storage_uri, source_content_hash
          )
          VALUES ($1, $2, $3, $4, '1', NOW(), 'openai', 'gpt-5.6', 'pending', $5, $6)
          `,
          [randomUUID(), studentId, transcriptId, recordingId, sourceStorageUri, sourceContentHash],
        );

      await expectCheckViolation(() =>
        insertMemory('s3://confirmed-transcripts/partial.json', null),
      );
      await expectCheckViolation(() => insertMemory(null, 'c'.repeat(64)));
    });
  });
});
