import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveGenerationCandidatesMock } = vi.hoisted(() => ({
  resolveGenerationCandidatesMock: vi.fn(),
}));
vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationCandidates: resolveGenerationCandidatesMock,
}));

import { confirmAssignmentSessionStep } from '../src/application/confirm-assignment-session-step.js';
import {
  confirmAssignmentSessionStepPersistence,
  confirmStudentAssignmentSession,
  updateAssignmentSessionRecovery,
} from '../src/domain/assignment-session-repository.js';
import { insertDraft } from '../src/domain/draft-repository.js';
import { publishConfirmedLessonMemoryEntry } from '../src/domain/lesson-memory-repository.js';
import { insertPromptPackage } from '../src/domain/prompt-package-repository.js';
import { updateTranscriptWorkingContent } from '../src/domain/transcript-repository.js';
import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

describe('application/confirm-assignment-session-step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveGenerationCandidatesMock.mockReturnValue([{ provider: 'openai', model: 'gpt-5.2' }]);
  });
  const sessionRecord = {
    id: 'session-1',
    userId: 'user-1',
    studentId: 'student-1',
    lessonId: null,
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    promptPackageId: null,
    draftId: null,
    revision: 2,
    confirmedStep: 'source' as const,
    confirmed: {
      student: { studentId: 'student-1' },
      source: {
        lessonId: null,
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
        transcriptStorageUri: 's3://transcripts/content/a.txt',
        transcriptHash: 'a'.repeat(64),
      },
      context: null,
      create: null,
    },
    creationRequestId: null,
    publishTarget: null,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    selectedProfileId: null,
    selectedProfileRevisionId: null,
    selectedProfileRevisionHash: null,
    shareJobId: null,
    createdAt: new Date('2026-07-19T00:00:00Z'),
    updatedAt: new Date('2026-07-19T00:01:00Z'),
  };

  it('enqueues the exact confirmed Source intent after the transaction commits', async () => {
    const confirm = vi.fn().mockResolvedValue({
      session: sessionRecord,
      invalidated: ['prompt', 'draft', 'preview'],
      lessonMemoryIntent: {
        outcome: 'created',
        entryId: 'memory-1',
        sourceStorageUri: 's3://transcripts/content/a.txt',
        sourceContentHash: 'a'.repeat(64),
      },
    });
    const enqueue = vi.fn().mockResolvedValue(undefined);

    const result = await confirmAssignmentSessionStep({
      config: { generation: {} } as never,
      userId: 'user-1',
      sessionId: 'session-1',
      request: {
        step: 'source',
        expectedRevision: 1,
        lessonId: null,
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
      },
      overrides: {
        confirmation: { confirm },
        lessonMemory: { enqueueConfirmedIntent: enqueue },
      } as never,
    });

    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingEntryId: 'memory-1',
        sourceStorageUri: 's3://transcripts/content/a.txt',
        sourceContentHash: 'a'.repeat(64),
      }),
    );
    expect(result.invalidated).toEqual(['prompt', 'draft', 'preview']);
  });

  it('does not enqueue or report invalidation for an identical Source replay', async () => {
    const enqueue = vi.fn();
    const session = sessionRecord;

    const result = await confirmAssignmentSessionStep({
      config: { generation: {} } as never,
      userId: 'user-1',
      sessionId: 'session-1',
      request: {
        step: 'source',
        expectedRevision: 1,
        lessonId: null,
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
      },
      overrides: {
        confirmation: {
          confirm: vi.fn().mockResolvedValue({
            session,
            invalidated: [],
            lessonMemoryIntent: null,
          }),
        },
        lessonMemory: { enqueueConfirmedIntent: enqueue },
      } as never,
    });

    expect(result).toMatchObject({ session: { id: session.id, revision: 2 }, invalidated: [] });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    {
      step: 'context' as const,
      expectedRevision: 2,
      teacherNotes: null,
      profileId: null,
      profileRevisionId: null,
      profileRevisionHash: null,
    },
    {
      step: 'create' as const,
      expectedRevision: 3,
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      draftWorkingVersion: 1,
    },
  ])('confirms $step without requiring lesson-memory generation configuration', async (request) => {
    resolveGenerationCandidatesMock.mockReturnValue([]);
    const confirm = vi.fn().mockResolvedValue({
      session: { ...sessionRecord, confirmedStep: 'context' },
      invalidated: ['prompt', 'draft', 'preview'],
      lessonMemoryIntent: null,
    });

    await confirmAssignmentSessionStep({
      config: { generation: {} } as never,
      userId: 'user-1',
      sessionId: 'session-1',
      request,
      overrides: { confirmation: { confirm } } as never,
    });

    expect(resolveGenerationCandidatesMock).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ lessonMemory: undefined }));
  });
});

describe('application/confirm-assignment-session-step transactional persistence', () => {
  it('supersedes prior ready memory when a new session confirms changed content for the same transcript', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const sourceAHash = 'a'.repeat(64);
    const sourceBHash = 'b'.repeat(64);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        'TRUNCATE TABLE assignment_sessions, lesson_memory_entries, student_memory_snapshots, transcripts, recordings, students, users RESTART IDENTITY CASCADE',
      );
      await client.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')`,
        [userId, `${userId}@example.test`],
      );
      await client.query(`INSERT INTO students (id, student) VALUES ($1, 'Alpha')`, [studentId]);
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 's3://recordings/a.mp3', 1, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, working_version, content_hash, stt_provider,
           mode, model, language, fallback_used
         ) VALUES ($1, $2, 's3://transcripts/content/a.txt', 1, $3, 'deepgram',
                   'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, sourceAHash],
      );
    });
    const memory = {
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      requestedAt: new Date('2026-07-19T00:00:00Z'),
    };
    const firstSession = await confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    const confirmedA = await confirmAssignmentSessionStepPersistence({
      id: firstSession.id,
      userId,
      request: {
        step: 'source',
        expectedRevision: firstSession.revision,
        lessonId: null,
        recordingId,
        transcriptId,
        transcriptWorkingVersion: 1,
      },
      lessonMemory: memory,
    });
    await publishConfirmedLessonMemoryEntry({
      id: confirmedA.lessonMemoryIntent!.entryId,
      studentId,
      transcriptId,
      recordingId,
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      sourceStorageUri: 's3://transcripts/content/a.txt',
      sourceContentHash: sourceAHash,
    });
    const snapshotId = randomUUID();
    const completedJobId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO student_memory_snapshots (
           id, student_id, schema_version, generated_at, provider, model, status,
           lesson_memory_entry_ids
         ) VALUES ($1, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.2', 'ready', $3::uuid[])`,
        [snapshotId, studentId, [confirmedA.lessonMemoryIntent!.entryId]],
      );
      await client.query(
        `INSERT INTO jobs (id, state, student_id, user_id) VALUES ($1, 'succeeded', $2, $3)`,
        [completedJobId, studentId, userId],
      );
      await client.query(
        `UPDATE assignment_sessions
         SET confirmed_step = 'share', share_job_id = $2, revision = revision + 1
         WHERE id = $1`,
        [firstSession.id, completedJobId],
      );
    });
    await updateTranscriptWorkingContent({
      id: transcriptId,
      expectedWorkingVersion: 1,
      storageUri: 's3://transcripts/content/b.txt',
      contentHash: sourceBHash,
    });
    const secondSession = await confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    const confirmedB = await confirmAssignmentSessionStepPersistence({
      id: secondSession.id,
      userId,
      request: {
        step: 'source',
        expectedRevision: secondSession.revision,
        lessonId: null,
        recordingId,
        transcriptId,
        transcriptWorkingVersion: 2,
      },
      lessonMemory: { ...memory, requestedAt: new Date('2026-07-19T00:01:00Z') },
    });

    const authority = await withPgClientSessionContext({ rlsBypass: true }, async (client) => ({
      memories: await client.query<{ source_content_hash: string; status: string }>(
        `SELECT source_content_hash, status FROM lesson_memory_entries
         WHERE transcript_id = $1 ORDER BY source_content_hash`,
        [transcriptId],
      ),
      snapshot: await client.query<{ status: string }>(
        'SELECT status FROM student_memory_snapshots WHERE id = $1',
        [snapshotId],
      ),
    }));
    expect(authority.memories.rows).toEqual([
      { source_content_hash: sourceAHash, status: 'superseded' },
      { source_content_hash: sourceBHash, status: 'pending' },
    ]);
    expect(authority.snapshot.rows[0]?.status).toBe('superseded');
    expect(confirmedB.lessonMemoryIntent).toMatchObject({ outcome: 'created' });
  });

  it('captures exact Source provenance, replays idempotently, and supersedes A when B is confirmed', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const sourceAHash = '559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd';
    const sourceBHash = 'df7e70e5021544f4834bbee64a9e3789febc4be81470df629cad6ddb03320a5c';
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        'TRUNCATE TABLE assignment_sessions, lesson_memory_entries, student_profile_bindings, profile_revisions, profiles, transcripts, recordings, students, users RESTART IDENTITY CASCADE',
      );
      await client.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')`,
        [userId, `${userId}@example.test`],
      );
      await client.query(`INSERT INTO students (id, student) VALUES ($1, 'Alpha')`, [studentId]);
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 's3://recordings/a.mp3', 1, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, working_version, content_hash, stt_provider,
           mode, model, language, fallback_used
         ) VALUES ($1, $2, 's3://transcripts/content/a.txt', 1, $3, 'deepgram',
                   'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, sourceAHash],
      );
    });
    const student = await confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    const memory = {
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      requestedAt: new Date('2026-07-19T00:00:00Z'),
    };
    const sourceRequest = {
      step: 'source' as const,
      expectedRevision: 1,
      lessonId: null,
      recordingId,
      transcriptId,
      transcriptWorkingVersion: 1,
    };

    const confirmedA = await confirmAssignmentSessionStepPersistence({
      id: student.id,
      userId,
      request: sourceRequest,
      lessonMemory: memory,
    });
    expect(confirmedA.session).toMatchObject({
      revision: 2,
      confirmedStep: 'source',
      confirmed: {
        source: {
          transcriptWorkingVersion: 1,
          transcriptStorageUri: 's3://transcripts/content/a.txt',
          transcriptHash: sourceAHash,
        },
      },
    });
    expect(confirmedA.invalidated).toEqual(['prompt', 'draft', 'preview']);

    const replay = await confirmAssignmentSessionStepPersistence({
      id: student.id,
      userId,
      request: sourceRequest,
      lessonMemory: memory,
    });
    expect(replay.session.revision).toBe(2);
    expect(replay.invalidated).toEqual([]);
    expect(replay.lessonMemoryIntent).toMatchObject({ outcome: 'pending_exists' });
    const readySnapshotId = randomUUID();
    const pendingSnapshotId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO student_memory_snapshots (
           id, student_id, schema_version, generated_at, provider, model, status,
           lesson_memory_entry_ids
         ) VALUES
           ($1, $3, 'student-memory.v1', NOW(), 'openai', 'gpt-5.2', 'ready', $4::uuid[]),
           ($2, $3, 'student-memory.v1', NOW(), 'openai', 'gpt-5.2', 'pending', ARRAY[]::uuid[])`,
        [readySnapshotId, pendingSnapshotId, studentId, [confirmedA.lessonMemoryIntent!.entryId]],
      );
    });

    await updateTranscriptWorkingContent({
      id: transcriptId,
      expectedWorkingVersion: 1,
      storageUri: 's3://transcripts/content/b.txt',
      contentHash: sourceBHash,
    });
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: student.id,
        userId,
        request: sourceRequest,
        lessonMemory: memory,
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_WORKING_CONFLICT' });

    const confirmedB = await confirmAssignmentSessionStepPersistence({
      id: student.id,
      userId,
      request: { ...sourceRequest, expectedRevision: 2, transcriptWorkingVersion: 2 },
      lessonMemory: { ...memory, requestedAt: new Date('2026-07-19T00:01:00Z') },
    });
    expect(confirmedB.session).toMatchObject({
      revision: 3,
      confirmed: {
        source: {
          transcriptWorkingVersion: 2,
          transcriptStorageUri: 's3://transcripts/content/b.txt',
          transcriptHash: sourceBHash,
        },
      },
    });
    const rows = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ source_content_hash: string; status: string }>(
        `SELECT source_content_hash, status FROM lesson_memory_entries
         WHERE transcript_id = $1 ORDER BY generated_at`,
        [transcriptId],
      ),
    );
    expect(rows.rows).toEqual([
      { source_content_hash: sourceAHash, status: 'superseded' },
      { source_content_hash: sourceBHash, status: 'pending' },
    ]);
    const snapshotStatuses = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ id: string; status: string }>(
        `SELECT id, status FROM student_memory_snapshots
           WHERE id = ANY($1::uuid[]) ORDER BY id`,
        [[readySnapshotId, pendingSnapshotId]],
      ),
    );
    expect(snapshotStatuses.rows.map((row) => row.status)).toEqual(['superseded', 'superseded']);
    const lateA = await publishConfirmedLessonMemoryEntry({
      id: confirmedA.lessonMemoryIntent!.entryId,
      studentId,
      transcriptId,
      recordingId,
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      sourceStorageUri: 's3://transcripts/content/a.txt',
      sourceContentHash: sourceAHash,
    });
    expect(lateA).toBeNull();

    await publishConfirmedLessonMemoryEntry({
      id: confirmedB.lessonMemoryIntent!.entryId,
      studentId,
      transcriptId,
      recordingId,
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      sourceStorageUri: 's3://transcripts/content/b.txt',
      sourceContentHash: sourceBHash,
    });
    const recordingCId = randomUUID();
    const transcriptCId = randomUUID();
    const sourceCHash = 'e'.repeat(64);
    const readyBSnapshotId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 's3://recordings/c.mp3', 1, 'transcribed')`,
        [recordingCId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
            mode, model, language, fallback_used)
         VALUES ($1, $2, 's3://transcripts/content/c.txt', 1, $3, 'deepgram',
                 'timeline', 'nova-3', 'multi', false)`,
        [transcriptCId, recordingCId, sourceCHash],
      );
      await client.query(
        `INSERT INTO student_memory_snapshots
           (id, student_id, schema_version, generated_at, provider, model, status,
            lesson_memory_entry_ids)
         VALUES ($1, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.2', 'ready', $3::uuid[])`,
        [readyBSnapshotId, studentId, [confirmedB.lessonMemoryIntent!.entryId]],
      );
    });
    const confirmedC = await confirmAssignmentSessionStepPersistence({
      id: student.id,
      userId,
      request: {
        step: 'source',
        expectedRevision: confirmedB.session.revision,
        lessonId: null,
        recordingId: recordingCId,
        transcriptId: transcriptCId,
        transcriptWorkingVersion: 1,
      },
      lessonMemory: { ...memory, requestedAt: new Date('2026-07-19T00:02:00Z') },
    });
    const replacedAuthority = await withPgClientSessionContext(
      { rlsBypass: true },
      async (client) => ({
        oldMemory: await client.query<{ status: string }>(
          'SELECT status FROM lesson_memory_entries WHERE id = $1',
          [confirmedB.lessonMemoryIntent!.entryId],
        ),
        oldSnapshot: await client.query<{ status: string }>(
          'SELECT status FROM student_memory_snapshots WHERE id = $1',
          [readyBSnapshotId],
        ),
      }),
    );
    expect(replacedAuthority.oldMemory.rows[0]?.status).toBe('superseded');
    expect(replacedAuthority.oldSnapshot.rows[0]?.status).toBe('superseded');

    const lessonId = randomUUID();
    const sameAuthoritySnapshotId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO student_lessons (id, student_id, starts_at, created_by)
         VALUES ($1, $2, NOW(), $3)`,
        [lessonId, studentId, userId],
      );
      await client.query(
        `INSERT INTO student_memory_snapshots
           (id, student_id, schema_version, generated_at, provider, model, status,
            lesson_memory_entry_ids)
         VALUES ($1, $2, 'student-memory.v1', NOW(), 'openai', 'gpt-5.2', 'pending', ARRAY[]::uuid[])`,
        [sameAuthoritySnapshotId, studentId],
      );
    });
    const relinkedLesson = await confirmAssignmentSessionStepPersistence({
      id: student.id,
      userId,
      request: {
        step: 'source',
        expectedRevision: confirmedC.session.revision,
        lessonId,
        recordingId: recordingCId,
        transcriptId: transcriptCId,
        transcriptWorkingVersion: 1,
      },
      lessonMemory: { ...memory, requestedAt: new Date('2026-07-19T00:03:00Z') },
    });
    expect(relinkedLesson.lessonMemoryIntent).toMatchObject({
      entryId: confirmedC.lessonMemoryIntent!.entryId,
      outcome: 'pending_exists',
    });
    const sameAuthoritySnapshot = await withPgClientSessionContext({ rlsBypass: true }, (client) =>
      client.query<{ status: string }>(
        'SELECT status FROM student_memory_snapshots WHERE id = $1',
        [sameAuthoritySnapshotId],
      ),
    );
    expect(sameAuthoritySnapshot.rows[0]?.status).toBe('pending');

    const recovered = await updateAssignmentSessionRecovery({
      id: student.id,
      userId,
      expectedRevision: relinkedLesson.session.revision,
      patch: { teacherNotes: 'other tab' },
    });
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: student.id,
        userId,
        request: {
          step: 'context',
          expectedRevision: relinkedLesson.session.revision,
          teacherNotes: 'stale tab',
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
        lessonMemory: memory,
      }),
    ).rejects.toMatchObject({
      code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
      session: expect.objectContaining({ revision: recovered.revision }),
    });
  });

  it('requires confirmed prerequisites and captures exact Create lineage', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const transcriptHash = 'a'.repeat(64);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        'TRUNCATE TABLE assignment_sessions, lesson_memory_entries, student_profile_bindings, profile_revisions, profiles, transcripts, recordings, students, users RESTART IDENTITY CASCADE',
      );
      await client.query(
        `INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, 'hash', 'user')`,
        [userId, `${userId}@example.test`],
      );
      await client.query(`INSERT INTO students (id, student) VALUES ($1, 'Alpha')`, [studentId]);
      await client.query(
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, 's3://recordings/a.mp3', 1, 'transcribed')`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, working_version, content_hash, stt_provider,
           mode, model, language, fallback_used
         ) VALUES ($1, $2, 's3://transcripts/content/a.txt', 1, $3, 'deepgram',
                   'timeline', 'nova-3', 'multi', false)`,
        [transcriptId, recordingId, transcriptHash],
      );
    });
    const session = await confirmStudentAssignmentSession({
      userId,
      requestId: randomUUID(),
      studentId,
      lessonId: null,
    });
    const memory = {
      schemaVersion: 'lesson-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      requestedAt: new Date(),
    };
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: session.id,
        userId,
        request: {
          step: 'context',
          expectedRevision: 1,
          teacherNotes: null,
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
        lessonMemory: memory,
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_STEP_PREREQUISITE_MISSING' });

    const source = await confirmAssignmentSessionStepPersistence({
      id: session.id,
      userId,
      request: {
        step: 'source',
        expectedRevision: 1,
        lessonId: null,
        recordingId,
        transcriptId,
        transcriptWorkingVersion: 1,
      },
      lessonMemory: memory,
    });
    await updateTranscriptWorkingContent({
      id: transcriptId,
      expectedWorkingVersion: 1,
      storageUri: 's3://transcripts/content/b.txt',
      contentHash: 'c'.repeat(64),
    });
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: session.id,
        userId,
        request: {
          step: 'context',
          expectedRevision: source.session.revision,
          teacherNotes: null,
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_WORKING_CONFLICT' });
    const refreshedSource = await confirmAssignmentSessionStepPersistence({
      id: session.id,
      userId,
      request: {
        step: 'source',
        expectedRevision: source.session.revision,
        lessonId: null,
        recordingId,
        transcriptId,
        transcriptWorkingVersion: 2,
      },
      lessonMemory: memory,
    });
    const otherStudentId = randomUUID();
    const otherProfileId = `profiles/${randomUUID()}.md`;
    const otherProfileRevisionId = randomUUID();
    const otherProfileHash = 'profile-hash';
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(`INSERT INTO students (id, student) VALUES ($1, 'Other')`, [
        otherStudentId,
      ]);
      await client.query(`INSERT INTO profiles (id, label) VALUES ($1, 'Other profile')`, [
        otherProfileId,
      ]);
      await client.query(
        `INSERT INTO profile_revisions
           (id, profile_id, content, content_hash, source, status, version_number,
            version_label, activated_at, created_at)
         VALUES ($1, $2, 'content', $3, 'create', 'active', 1, 'v1', NOW(), NOW())`,
        [otherProfileRevisionId, otherProfileId, otherProfileHash],
      );
      await client.query(
        `INSERT INTO student_profile_bindings
           (id, student_id, profile_id, effective_from, reason, changed_by)
         VALUES ($1, $2, $3, NOW(), 'student_update', $4)`,
        [randomUUID(), otherStudentId, otherProfileId, userId],
      );
    });
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: session.id,
        userId,
        request: {
          step: 'context',
          expectedRevision: refreshedSource.session.revision,
          teacherNotes: null,
          profileId: otherProfileId,
          profileRevisionId: otherProfileRevisionId,
          profileRevisionHash: otherProfileHash,
        },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_STEP_LINEAGE_INVALID' });
    const confirmedProfileId = `profiles/${randomUUID()}.md`;
    const confirmedProfileRevisionId = randomUUID();
    const confirmedProfileRawHash = 'e'.repeat(64);
    const renderedProfileHash = 'f'.repeat(64);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(`INSERT INTO profiles (id, label) VALUES ($1, 'Confirmed profile')`, [
        confirmedProfileId,
      ]);
      await client.query(
        `INSERT INTO profile_revisions
           (id, profile_id, content, content_hash, source, status, version_number,
            version_label, activated_at, created_at)
         VALUES ($1, $2, 'raw structured source', $3, 'create', 'active', 1, 'v1', NOW(), NOW())`,
        [confirmedProfileRevisionId, confirmedProfileId, confirmedProfileRawHash],
      );
      await client.query(
        `INSERT INTO student_profile_bindings
           (id, student_id, profile_id, effective_from, reason, changed_by)
         VALUES ($1, $2, $3, NOW(), 'student_update', $4)`,
        [randomUUID(), studentId, confirmedProfileId, userId],
      );
    });
    const context = await confirmAssignmentSessionStepPersistence({
      id: session.id,
      userId,
      request: {
        step: 'context',
        expectedRevision: refreshedSource.session.revision,
        teacherNotes: null,
        profileId: confirmedProfileId,
        profileRevisionId: confirmedProfileRevisionId,
        profileRevisionHash: confirmedProfileRawHash,
      },
      lessonMemory: memory,
    });
    const prompt = await insertPromptPackage({
      recordingId,
      transcriptId,
      studentId,
      lessonId: null,
      templateVersion: 'template-v1',
      notes: null,
      resolvedProfileId: confirmedProfileId,
      resolvedProfileRevisionId: confirmedProfileRevisionId,
      resolvedProfileHash: renderedProfileHash,
      storageUri: 's3://prompts/prompt.json',
    });
    const draft = await insertDraft({
      promptPackageId: prompt.id,
      studentId,
      lessonId: null,
      storageUri: 's3://drafts/content/a.md',
      workingVersion: 1,
      contentHash: 'b'.repeat(64),
      createdBy: userId,
    });
    const recoveredLineage = await updateAssignmentSessionRecovery({
      id: session.id,
      userId,
      expectedRevision: context.session.revision,
      patch: { promptPackageId: prompt.id, draftId: draft.id },
    });
    const replacementPrompt = await insertPromptPackage({
      recordingId,
      transcriptId,
      studentId,
      lessonId: null,
      templateVersion: 'template-v2',
      notes: null,
      resolvedProfileId: confirmedProfileId,
      resolvedProfileRevisionId: confirmedProfileRevisionId,
      resolvedProfileHash: renderedProfileHash,
      storageUri: 's3://prompts/replacement.json',
    });
    await expect(
      updateAssignmentSessionRecovery({
        id: session.id,
        userId,
        expectedRevision: recoveredLineage.revision,
        patch: { promptPackageId: replacementPrompt.id },
      }),
    ).rejects.toMatchObject({ code: 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID' });
    const created = await confirmAssignmentSessionStepPersistence({
      id: session.id,
      userId,
      request: {
        step: 'create',
        expectedRevision: recoveredLineage.revision,
        promptPackageId: prompt.id,
        draftId: draft.id,
        draftWorkingVersion: 1,
      },
      lessonMemory: memory,
    });
    expect(created).toMatchObject({
      invalidated: ['preview'],
      session: {
        confirmedStep: 'create',
        confirmed: {
          create: {
            promptPackageId: prompt.id,
            draftId: draft.id,
            draftWorkingVersion: 1,
            draftStorageUri: 's3://drafts/content/a.md',
            draftHash: 'b'.repeat(64),
          },
        },
      },
    });
    await updateTranscriptWorkingContent({
      id: transcriptId,
      expectedWorkingVersion: 2,
      storageUri: 's3://transcripts/content/c.txt',
      contentHash: 'd'.repeat(64),
    });
    await expect(
      confirmAssignmentSessionStepPersistence({
        id: session.id,
        userId,
        request: {
          step: 'create',
          expectedRevision: created.session.revision,
          promptPackageId: prompt.id,
          draftId: draft.id,
          draftWorkingVersion: 1,
        },
      }),
    ).rejects.toMatchObject({ code: 'ARTIFACT_WORKING_CONFLICT' });
  });
});
