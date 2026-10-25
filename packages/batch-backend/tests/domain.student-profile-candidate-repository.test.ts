import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createEmptyFoundationalProfile } from '../src/application/foundational-profile.js';
import { processStudentProfileCandidateRefreshJob } from '../src/application/process-student-profile-candidate-refresh-job.js';
import {
  activateProfileRevisionForStudent,
  saveProfileRevisionContent,
} from '../src/application/profile-content.js';
import { refreshProfileDraftFromApprovedCandidates } from '../src/application/profile-draft-refresh.js';
import {
  approveStudentProfileCandidate,
  refreshStudentProfileCandidatesFromCanonicalMemory,
} from '../src/application/student-profile-candidates.js';
import { activateProfileRevision } from '../src/domain/profile-revision-repository.js';
import {
  getEligibleReadyStudentMemorySnapshotById,
  getLatestReadyStudentMemorySnapshotByStudentId,
  getProfileCandidateSourceStudentMemorySnapshotById,
  getStudentMemorySnapshotById,
  insertCanonicalReadyStudentMemorySnapshot,
  insertStudentMemorySnapshot,
} from '../src/domain/student-memory-snapshot-repository.js';
import {
  copyStudentProfileCandidateDraftRevisionLinks,
  getStudentProfileCandidateById,
  insertStudentProfileCandidate,
  linkStudentProfileCandidatesToDraftRevision,
  listLatestStudentProfileCandidatesByKeys,
  listStudentProfileCandidates,
  markStudentProfileCandidatesPromotedByRevision,
  persistStudentProfileCandidateRefresh,
  supersedePendingStudentProfileCandidates,
  updateStudentProfileCandidateReview,
} from '../src/domain/student-profile-candidate-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { insertLessonMemory } from './support/student-memory-fixture.js';
import { requirePgTestEnv } from './support/test-env.js';

async function refreshFixture() {
  const studentId = randomUUID();
  await withPgClient((client) =>
    client.query("INSERT INTO students (id, student) VALUES ($1, 'Ari')", [studentId]),
  );
  const lessonId = await insertLessonMemory({
    studentId,
    status: 'ready',
    withConfirmedSource: true,
  });
  const fact = {
    fact: 'Prefers short checklist practice.',
    category: 'study preference',
    authority: 'teacher_confirmed' as const,
    confidence: 'high' as const,
    reviewNeeded: false,
    evidence: [{ sourceId: lessonId, quote: 'Short checklists help.' }],
  };
  await withPgClient((client) =>
    client.query('UPDATE lesson_memory_entries SET student_facts = $2::jsonb WHERE id = $1', [
      lessonId,
      JSON.stringify([fact]),
    ]),
  );
  const snapshot = await insertCanonicalReadyStudentMemorySnapshot({
    studentId,
    schemaVersion: 'student-memory.v1',
    provider: 'fixture',
    model: 'fixture',
    lessonMemoryEntryIds: [lessonId],
    personalFacts: [fact],
    generationNotes: {
      triggerSourceKind: 'lesson_memory',
      triggerSourceEntryId: lessonId,
      includedLessonMemoryEntryIds: [lessonId],
    },
  });
  const params = {
    studentId,
    sourceSnapshotId: snapshot.id,
    sourceLessonMemoryIds: [lessonId],
    expectedActiveRevisionId: null,
    proposals: [
      {
        studentId,
        sourceSnapshotId: snapshot.id,
        sourceLessonMemoryIds: [lessonId],
        targetSection: 'learning_preferences_study_habits' as const,
        candidateKey: 'learning_preferences_study_habits:prefers short checklist practice',
        ...fact,
      },
    ],
  };
  return { studentId, lessonId, snapshot, params };
}

async function activateWithProfile(
  revisionId: string,
  studentId: string,
  contentHash: string,
  profile: unknown,
) {
  await withPgClient((client) =>
    client.query(
      'UPDATE student_profile_revisions SET structured_content = $2::jsonb WHERE id = $1',
      [revisionId, JSON.stringify(profile)],
    ),
  );
  await activateProfileRevision(studentId, revisionId);
  return markStudentProfileCandidatesPromotedByRevision(revisionId, {
    studentId,
    contentHash,
    structuredContent: profile,
  });
}

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

async function truncateCandidateTables() {
  await withPgClient(async (client) => {
    await client.query(
      'TRUNCATE TABLE student_profile_candidate_draft_revisions, student_profile_candidates, student_memory_snapshots, lesson_memory_entries, homework_memory_entries, transcripts, recordings, jobs, students, users, student_profile_revisions RESTART IDENTITY CASCADE',
    );
  });
}

const describeIfPg = hasPgTestEnv ? describe : describe.skip;

describeIfPg('domain/student-profile-candidate-repository', () => {
  beforeAll(async () => {
    await truncateCandidateTables();
  });

  afterAll(async () => {
    await truncateCandidateTables();
    await closePgPool();
  });

  beforeEach(async () => {
    await truncateCandidateTables();
  });

  it('serializes concurrent duplicate delivery into one live review proposal', async () => {
    const { params, studentId } = await refreshFixture();
    const results = await Promise.all([
      persistStudentProfileCandidateRefresh(params),
      persistStudentProfileCandidateRefresh(params),
    ]);
    expect(results.flatMap((result) => result.created)).toHaveLength(1);
    expect(
      (await listStudentProfileCandidates({ studentId, limit: 25, offset: 0 })).items,
    ).toHaveLength(1);
  });

  it.each(['pending_review', 'approved', 'rejected', 'promoted', 'superseded'] as const)(
    'preserves existing %s history and edited approval text',
    async (status) => {
      const { params, studentId } = await refreshFixture();
      const original = await insertStudentProfileCandidate({
        ...params.proposals[0]!,
        status,
        reviewState:
          status === 'rejected'
            ? 'rejected'
            : status === 'pending_review'
              ? 'deferred'
              : 'approved',
        dedupDecision: { decision: 'created', model: 'historical-model' },
      });
      await withPgClient((client) =>
        client.query(
          "UPDATE student_profile_candidates SET approved_fact = 'Teacher edited fact.', reviewed_at = NOW() WHERE id = $1",
          [original.id],
        ),
      );
      expect((await persistStudentProfileCandidateRefresh(params)).created).toEqual([]);
      expect(await getStudentProfileCandidateById(studentId, original.id)).toMatchObject({
        status,
        approvedFact: 'Teacher edited fact.',
        dedupDecision: { decision: 'created', model: 'historical-model' },
      });
    },
  );

  it('allows review when only an old unreviewed system stale artifact covered the key', async () => {
    const { params, studentId } = await refreshFixture();
    const artifact = await insertStudentProfileCandidate({
      ...params.proposals[0]!,
      status: 'rejected',
      reviewState: 'rejected',
      dedupDecision: { decision: 'stale', model: 'historical-model' },
    });
    expect((await persistStudentProfileCandidateRefresh(params)).created).toHaveLength(1);
    expect((await getStudentProfileCandidateById(studentId, artifact.id))?.dedupDecision).toEqual({
      decision: 'stale',
      model: 'historical-model',
    });
  });

  it.each(['student', 'replaced source', 'remapped authority'] as const)(
    'rejects invalid %s evidence before insertion',
    async (invalid) => {
      const fixture = await refreshFixture();
      let params = fixture.params;
      if (invalid === 'student') {
        const otherStudent = randomUUID();
        await withPgClient((client) =>
          client.query("INSERT INTO students (id, student) VALUES ($1, 'Other')", [otherStudent]),
        );
        params = {
          ...params,
          studentId: otherStudent,
          proposals: params.proposals.map((proposal) => ({ ...proposal, studentId: otherStudent })),
        };
      } else if (invalid === 'replaced source') {
        await withPgClient((client) =>
          client.query("UPDATE lesson_memory_entries SET status = 'superseded' WHERE id = $1", [
            fixture.lessonId,
          ]),
        );
      } else {
        await withPgClient((client) =>
          client.query(
            `UPDATE assignment_sessions SET confirmed_snapshot =
          jsonb_set(confirmed_snapshot, '{source,transcriptHash}', to_jsonb($2::text))
          WHERE id = (SELECT assignment_session_id FROM lesson_memory_entries WHERE id = $1)`,
            [fixture.lessonId, 'b'.repeat(64)],
          ),
        );
      }
      expect(await persistStudentProfileCandidateRefresh(params)).toMatchObject({
        outcome: 'source_obsolete',
        created: [],
      });
      expect(
        (await listStudentProfileCandidates({ studentId: fixture.studentId, limit: 25, offset: 0 }))
          .items,
      ).toEqual([]);
    },
  );

  it('delivers delayed snapshot A after B exists without drifting to B or self-suppressing A', async () => {
    const { studentId, snapshot, lessonId } = await refreshFixture();
    const lessonB = await insertLessonMemory({
      studentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    const factB = {
      fact: 'Likes hiking.',
      category: 'interest',
      authority: 'student_stated',
      confidence: 'high',
      reviewNeeded: false,
      evidence: [{ quote: 'I hike each month.' }],
    };
    await withPgClient((client) =>
      client.query('UPDATE lesson_memory_entries SET student_facts = $2::jsonb WHERE id = $1', [
        lessonB,
        JSON.stringify([factB]),
      ]),
    );
    const snapshotB = await insertCanonicalReadyStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory.v1',
      provider: 'fixture',
      model: 'fixture',
      lessonMemoryEntryIds: [lessonId, lessonB],
      snapshotSummary: 'Snapshot B from canonical publication.',
      generationNotes: {
        triggerSourceKind: 'lesson_memory',
        triggerSourceEntryId: lessonB,
        includedLessonMemoryEntryIds: [lessonB],
      },
    });
    const payload = {
      kind: 'student-profile-candidate-refresh' as const,
      studentId,
      sourceSnapshotId: snapshot.id,
      trigger: 'student-memory-snapshot-ready' as const,
    };
    expect(await getStudentMemorySnapshotById(snapshot.id)).toMatchObject({
      status: 'superseded',
      supersededById: snapshotB.id,
    });
    expect(await getEligibleReadyStudentMemorySnapshotById(snapshot.id)).toBeNull();
    expect((await getLatestReadyStudentMemorySnapshotByStudentId(studentId))?.id).toBe(
      snapshotB.id,
    );
    expect(await getProfileCandidateSourceStudentMemorySnapshotById(snapshot.id)).toMatchObject({
      id: snapshot.id,
      status: 'superseded',
    });
    const snapshotC = await insertCanonicalReadyStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory.v1',
      provider: 'fixture',
      model: 'fixture',
      lessonMemoryEntryIds: [lessonId, lessonB],
      snapshotSummary: 'Snapshot C from canonical publication.',
      generationNotes: { triggerSourceKind: 'lesson_memory', triggerSourceEntryId: lessonB },
    });
    expect((await getStudentMemorySnapshotById(snapshotB.id))?.status).toBe('superseded');
    expect((await getLatestReadyStudentMemorySnapshotByStudentId(studentId))?.id).toBe(
      snapshotC.id,
    );
    await processStudentProfileCandidateRefreshJob({ payload });
    await processStudentProfileCandidateRefreshJob({ payload });
    const candidates = await listStudentProfileCandidates({ studentId, limit: 25, offset: 0 });
    expect(candidates.items).toHaveLength(1);
    expect(candidates.items[0]).toMatchObject({
      sourceSnapshotId: snapshot.id,
      sourceLessonMemoryIds: [lessonId],
      fact: 'Prefers short checklist practice.',
    });
    expect(candidates.items[0]?.dedupDecision).not.toHaveProperty('model');
  });

  it.each([
    'source invalidated',
    'replaced lesson',
    'remapped authority',
    'unfinished intent',
    'foreign successor',
  ] as const)(
    'rejects superseded snapshot A with %s at both read and persistence',
    async (invalid) => {
      const { studentId, snapshot, lessonId, params } = await refreshFixture();
      const successor = await insertCanonicalReadyStudentMemorySnapshot({
        studentId,
        schemaVersion: 'student-memory.v1',
        provider: 'fixture',
        model: 'fixture',
        lessonMemoryEntryIds: [lessonId],
        snapshotSummary: 'Newer aggregate.',
      });
      expect((await getProfileCandidateSourceStudentMemorySnapshotById(snapshot.id))?.id).toBe(
        snapshot.id,
      );
      await withPgClient(async (client) => {
        if (invalid === 'source invalidated') {
          await client.query(
            `UPDATE student_memory_snapshots SET generation_notes = generation_notes ||
            '{"continuityReason":"source_invalidated"}'::jsonb WHERE id = $1`,
            [snapshot.id],
          );
        } else if (invalid === 'replaced lesson') {
          await client.query(
            "UPDATE lesson_memory_entries SET status = 'superseded' WHERE id = $1",
            [lessonId],
          );
        } else if (invalid === 'remapped authority') {
          await client.query(
            `UPDATE assignment_sessions SET confirmed_snapshot =
            jsonb_set(confirmed_snapshot, '{source,transcriptHash}', to_jsonb($2::text))
            WHERE id = (SELECT assignment_session_id FROM lesson_memory_entries WHERE id = $1)`,
            [lessonId, 'b'.repeat(64)],
          );
        } else if (invalid === 'unfinished intent') {
          await client.query(
            `UPDATE student_memory_snapshots SET personal_facts = '[]'::jsonb,
            content_hash = NULL, snapshot_summary = NULL WHERE id = $1`,
            [snapshot.id],
          );
        } else {
          const otherStudent = randomUUID();
          await client.query("INSERT INTO students (id, student) VALUES ($1, 'Other')", [
            otherStudent,
          ]);
          const foreign = await insertStudentMemorySnapshot({
            studentId: otherStudent,
            schemaVersion: 'student-memory.v1',
            provider: 'fixture',
            model: 'fixture',
            status: 'ready',
          });
          await client.query(
            'UPDATE student_memory_snapshots SET superseded_by_id = $2 WHERE id = $1',
            [snapshot.id, foreign.id],
          );
        }
      });
      expect(await getProfileCandidateSourceStudentMemorySnapshotById(snapshot.id)).toBeNull();
      expect(
        await refreshStudentProfileCandidatesFromCanonicalMemory({
          studentId,
          sourceSnapshotId: snapshot.id,
        }),
      ).toMatchObject({
        outcome: 'skipped',
        skipReason: 'source_snapshot_unavailable_or_obsolete',
      });
      expect(await persistStudentProfileCandidateRefresh(params)).toMatchObject({
        outcome: 'source_obsolete',
        created: [],
      });
      expect(
        (await listStudentProfileCandidates({ studentId, limit: 25, offset: 0 })).items,
      ).toEqual([]);
      expect((await getStudentMemorySnapshotById(successor.id))?.id).toBe(successor.id);
    },
  );

  it('inserts and lists candidates for a student', async () => {
    const studentId = randomUUID();
    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
    });

    const inserted = await insertStudentProfileCandidate({
      studentId,
      targetSection: 'goals_motivation',
      candidateKey: 'goals_motivation:wants more confidence at work',
      fact: 'Wants more confidence at work.',
      category: 'goal',
      authority: 'student_stated',
      confidence: 'high',
      reviewNeeded: false,
      sourceLessonMemoryIds: [],
      evidence: [],
    });

    const listed = await listStudentProfileCandidates({
      studentId,
      statuses: ['pending_review'],
      limit: 10,
      offset: 0,
    });
    const loaded = await getStudentProfileCandidateById(studentId, inserted.id);

    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.candidateKey).toBe('goals_motivation:wants more confidence at work');
    expect(loaded?.id).toBe(inserted.id);
  });

  it('updates review lifecycle and review state together', async () => {
    const studentId = randomUUID();
    const reviewerId = randomUUID();

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
      await client.query(
        `INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
         VALUES ($1, 'reviewer@example.com', 'test-hash', 'user', TRUE, NOW(), NOW())`,
        [reviewerId],
      );
    });

    const inserted = await insertStudentProfileCandidate({
      studentId,
      targetSection: 'learning_preferences_study_habits',
      candidateKey: 'learning_preferences_study_habits:likes structured explanations',
      fact: 'Likes structured explanations.',
      category: 'study preference',
      authority: 'teacher_confirmed',
      confidence: 'medium',
      reviewNeeded: false,
      sourceLessonMemoryIds: [],
      evidence: [],
    });

    const updated = await updateStudentProfileCandidateReview({
      studentId,
      candidateId: inserted.id,
      status: 'approved',
      reviewState: 'approved',
      reviewerId,
      reviewerNote: 'Confirmed across lessons.',
      approvedFact: 'Responds well to structured explanations.',
    });

    expect(updated).toMatchObject({
      id: inserted.id,
      status: 'approved',
      reviewState: 'approved',
      reviewerId,
      approvedFact: 'Responds well to structured explanations.',
    });
  });

  it('supersedes older pending candidates for the same deterministic key', async () => {
    const studentId = randomUUID();

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
    });

    const first = await insertStudentProfileCandidate({
      id: '00000000-0000-0000-0000-000000000001',
      studentId,
      targetSection: 'interests_personal_context',
      candidateKey: 'interests_personal_context:likes pickleball',
      fact: 'Likes pickleball.',
      category: 'interest',
      authority: 'student_stated',
      confidence: 'medium',
      reviewNeeded: true,
      sourceLessonMemoryIds: [],
      evidence: [],
    });

    const second = await insertStudentProfileCandidate({
      id: '00000000-0000-0000-0000-000000000002',
      studentId,
      targetSection: 'interests_personal_context',
      candidateKey: 'interests_personal_context:likes pickleball',
      fact: 'Likes pickleball.',
      category: 'interest',
      authority: 'teacher_confirmed',
      confidence: 'high',
      reviewNeeded: false,
      sourceLessonMemoryIds: ['00000000-0000-0000-0000-000000000020'],
      evidence: [],
    });

    await supersedePendingStudentProfileCandidates({
      studentId,
      candidateKey: 'interests_personal_context:likes pickleball',
      supersededById: second.id,
      supersededAt: second.createdAt,
    });

    const latestByKey = await listLatestStudentProfileCandidatesByKeys(studentId, [
      'interests_personal_context:likes pickleball',
    ]);
    const all = await listStudentProfileCandidates({
      studentId,
      limit: 10,
      offset: 0,
    });

    expect(latestByKey.get('interests_personal_context:likes pickleball')?.id).toBe(second.id);
    expect(all.items.find((item) => item.id === first.id)?.status).toBe('superseded');
  });

  it('prefers active candidates over newer rejected duplicates for deterministic key lookup', async () => {
    const studentId = randomUUID();

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
    });

    const active = await insertStudentProfileCandidate({
      id: '00000000-0000-0000-0000-000000000011',
      studentId,
      targetSection: 'goals_motivation',
      candidateKey: 'goals_motivation:wants more confidence at work',
      fact: 'Wants more confidence at work.',
      category: 'goal',
      authority: 'student_stated',
      confidence: 'high',
      reviewNeeded: false,
      sourceLessonMemoryIds: [],
      evidence: [],
    });
    const rejected = await insertStudentProfileCandidate({
      id: '00000000-0000-0000-0000-000000000012',
      studentId,
      targetSection: 'goals_motivation',
      candidateKey: 'goals_motivation:wants more confidence at work',
      fact: 'Wants more confidence at work.',
      category: 'goal',
      authority: 'student_stated',
      confidence: 'high',
      reviewNeeded: false,
      sourceLessonMemoryIds: [],
      evidence: [],
      status: 'rejected',
      reviewState: 'rejected',
    });

    const latestByKey = await listLatestStudentProfileCandidatesByKeys(studentId, [
      'goals_motivation:wants more confidence at work',
    ]);

    expect(rejected.createdAt.getTime()).toBeGreaterThanOrEqual(active.createdAt.getTime());
    expect(latestByKey.get('goals_motivation:wants more confidence at work')?.id).toBe(active.id);
  });

  it('promotes candidates for any linked draft revision even after a newer draft is linked later', async () => {
    const studentId = randomUUID();
    const revisionA = randomUUID();
    const revisionB = randomUUID();

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );

      await client.query(
        `INSERT INTO student_profile_revisions (
           id, student_id, content, content_hash, source, status, version_number, version_label,
           activated_at, deprecated_at, created_at, created_by, restored_from_revision_id
         )
         VALUES
           ($1, $3, 'Draft A', 'hash-a', 'update', 'draft', 1, 'v1', NULL, NULL, NOW(), NULL, NULL),
           ($2, $3, 'Draft B', 'hash-b', 'update', 'draft', 2, 'v2', NULL, NULL, NOW(), NULL, NULL)`,
        [revisionA, revisionB, studentId],
      );
    });

    const candidate = await insertStudentProfileCandidate({
      studentId,
      targetSection: 'interests_personal_context',
      candidateKey: 'interests_personal_context:likes pickleball',
      fact: 'Likes pickleball.',
      category: 'interest',
      authority: 'teacher_confirmed',
      confidence: 'high',
      reviewNeeded: false,
      sourceLessonMemoryIds: [],
      evidence: [],
      status: 'approved',
      reviewState: 'approved',
    });

    await linkStudentProfileCandidatesToDraftRevision({
      studentId,
      candidateIds: [candidate.id],
      draftRevisionId: revisionA,
    });
    await linkStudentProfileCandidatesToDraftRevision({
      studentId,
      candidateIds: [candidate.id],
      draftRevisionId: revisionB,
    });

    await activateWithProfile(revisionA, studentId, 'hash-a', {
      interestsAndUsefulThemes: ['Likes pickleball.'],
    });
    const promoted = await getStudentProfileCandidateById(studentId, candidate.id);

    expect(promoted).toMatchObject({
      id: candidate.id,
      status: 'promoted',
      promotedRevisionId: revisionA,
    });
    expect(promoted?.promotedAt).toBeInstanceOf(Date);
  });

  it('moves linked approved candidates from approved listings to promoted listings', async () => {
    const studentId = randomUUID();
    const revisionId = randomUUID();

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );

      await client.query(
        `INSERT INTO student_profile_revisions (
           id, student_id, content, content_hash, source, status, version_number, version_label,
           activated_at, deprecated_at, created_at, created_by, restored_from_revision_id
         )
         VALUES ($1, $2, 'Draft', 'hash-a', 'profile_revision_refresh', 'draft', 1, 'v1', NULL, NULL, NOW(), NULL, NULL)`,
        [revisionId, studentId],
      );
    });

    const candidate = await insertStudentProfileCandidate({
      studentId,
      targetSection: 'learning_preferences_study_habits',
      candidateKey: 'learning_preferences_study_habits:prefers clear review blocks',
      fact: 'Prefers clear review blocks.',
      category: 'study_preference',
      authority: 'teacher_confirmed',
      confidence: 'high',
      reviewNeeded: false,
      sourceLessonMemoryIds: [],
      evidence: [],
      status: 'approved',
      reviewState: 'approved',
    });

    await linkStudentProfileCandidatesToDraftRevision({
      studentId,
      candidateIds: [candidate.id],
      draftRevisionId: revisionId,
    });

    const approvedBefore = await listStudentProfileCandidates({
      studentId,
      statuses: ['approved'],
      limit: 25,
      offset: 0,
      order: 'desc',
    });
    expect(approvedBefore.items.map((item) => item.id)).toContain(candidate.id);
    const readBeforeActivation = await getStudentProfileCandidateById(studentId, candidate.id);

    await activateWithProfile(revisionId, studentId, 'hash-a', {
      studyPreferences: ['Prefers clear review blocks.'],
    });

    const approvedAfter = await listStudentProfileCandidates({
      studentId,
      statuses: ['approved'],
      limit: 25,
      offset: 0,
      order: 'desc',
    });
    const promotedAfter = await listStudentProfileCandidates({
      studentId,
      statuses: ['promoted'],
      limit: 25,
      offset: 0,
      order: 'desc',
    });

    expect(approvedAfter.items.map((item) => item.id)).not.toContain(candidate.id);
    expect(promotedAfter.items).toHaveLength(1);
    expect(promotedAfter.items[0]).toMatchObject({
      id: candidate.id,
      status: 'promoted',
      promotedRevisionId: revisionId,
    });
    // An already-started review may reach the UPDATE after activation commits.
    expect(
      await updateStudentProfileCandidateReview({
        studentId,
        candidateId: candidate.id,
        status: 'approved',
        reviewState: 'approved',
        approvedFact: 'Teacher changed this after activation.',
      }),
    ).toBeNull();
    await expect(
      approveStudentProfileCandidate({
        studentId,
        candidateId: candidate.id,
        approvedFact: 'Delayed teacher edit.',
        overrides: {
          candidates: {
            getById: async () => readBeforeActivation,
            persistRefresh: persistStudentProfileCandidateRefresh,
            updateReview: updateStudentProfileCandidateReview,
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_candidate_state', status: 409 });
    expect(await getStudentProfileCandidateById(studentId, candidate.id)).toMatchObject({
      status: 'promoted',
      promotedRevisionId: revisionId,
    });
  });

  it('does not promote old wording when the teacher review edit wins before activation', async () => {
    const { params, studentId } = await refreshFixture();
    const candidate = await insertStudentProfileCandidate({
      ...params.proposals[0]!,
      status: 'approved',
      reviewState: 'approved',
    });
    const revisionId = randomUUID();
    await withPgClient((client) =>
      client.query(
        `INSERT INTO student_profile_revisions
      (id, student_id, content, content_hash, source, status, version_number, version_label)
      VALUES ($1, $2, 'Old wording draft', 'old-wording-hash', 'profile_revision_refresh', 'draft', 1, 'v1')`,
        [revisionId, studentId],
      ),
    );
    await linkStudentProfileCandidatesToDraftRevision({
      studentId,
      candidateIds: [candidate.id],
      draftRevisionId: revisionId,
    });
    await updateStudentProfileCandidateReview({
      studentId,
      candidateId: candidate.id,
      status: 'approved',
      reviewState: 'approved',
      approvedFact: 'Teacher revised wording.',
    });
    await activateWithProfile(revisionId, studentId, 'old-wording-hash', {
      studyPreferences: [candidate.fact],
    });
    expect(await getStudentProfileCandidateById(studentId, candidate.id)).toMatchObject({
      status: 'approved',
      approvedFact: 'Teacher revised wording.',
      promotedRevisionId: null,
    });
  });

  it.each([true, false])(
    'preserves draft lineage and promotes only a retained fact (retained=%s)',
    async (retained) => {
      const studentId = randomUUID();
      const generatedRevisionId = randomUUID();
      const editedRevisionId = randomUUID();

      await withPgClient(async (client) => {
        await client.query(
          `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
          [studentId],
        );

        await client.query(
          `INSERT INTO student_profile_revisions (
           id, student_id, content, content_hash, source, status, version_number, version_label,
           activated_at, deprecated_at, created_at, created_by, restored_from_revision_id
         )
         VALUES
           ($1, $3, 'Generated draft', 'hash-generated', 'profile_revision_refresh', 'draft', 1, 'v1', NULL, NULL, NOW(), NULL, NULL),
           ($2, $3, 'Edited draft', 'hash-edited', 'update', 'draft', 2, 'v2', NULL, NULL, NOW(), NULL, NULL)`,
          [generatedRevisionId, editedRevisionId, studentId],
        );
      });

      const candidate = await insertStudentProfileCandidate({
        studentId,
        targetSection: 'learning_preferences_study_habits',
        candidateKey: 'learning_preferences_study_habits:prefers clear review blocks',
        fact: 'Prefers clear review blocks.',
        category: 'study_preference',
        authority: 'teacher_confirmed',
        confidence: 'high',
        reviewNeeded: false,
        sourceLessonMemoryIds: [],
        evidence: [],
        status: 'approved',
        reviewState: 'approved',
      });

      await linkStudentProfileCandidatesToDraftRevision({
        studentId,
        candidateIds: [candidate.id],
        draftRevisionId: generatedRevisionId,
      });
      await copyStudentProfileCandidateDraftRevisionLinks({
        sourceRevisionId: generatedRevisionId,
        targetRevisionId: editedRevisionId,
      });

      await activateWithProfile(editedRevisionId, studentId, 'hash-edited', {
        studyPreferences: retained ? ['Prefers clear review blocks.'] : ['Enjoys organized tasks.'],
      });
      const promoted = await getStudentProfileCandidateById(studentId, candidate.id);

      expect(promoted).toMatchObject({
        id: candidate.id,
        status: retained ? 'promoted' : 'approved',
        promotedRevisionId: retained ? editedRevisionId : null,
      });
      const links = await withPgClient((client) =>
        client.query(
          'SELECT revision_id FROM student_profile_candidate_draft_revisions WHERE candidate_id = $1',
          [candidate.id],
        ),
      );
      expect(links.rows.map((row) => row.revision_id).sort()).toEqual(
        [generatedRevisionId, editedRevisionId].sort(),
      );
    },
  );

  it.each([false, true])(
    'preserves approved wording through persisted draft, edits and activation (remove=%s)',
    async (remove) => {
      const studentId = randomUUID();
      await withPgClient((client) =>
        client.query("INSERT INTO students (id, student) VALUES ($1, 'Ari')", [studentId]),
      );
      const candidates = await Promise.all(
        ['Prefers short drills.', 'Enjoys climbing.', 'Unselected fact.'].map((fact, index) =>
          insertStudentProfileCandidate({
            studentId,
            targetSection:
              index === 0 ? 'learning_preferences_study_habits' : 'interests_personal_context',
            candidateKey: fact,
            fact,
            category: 'preference',
            authority: 'teacher_confirmed',
            confidence: 'high',
            reviewNeeded: false,
            status: 'approved',
            reviewState: 'approved',
            sourceLessonMemoryIds: [],
            evidence: [],
          }),
        ),
      );
      const selectedIds = candidates.slice(0, 2).map((c) => c.id);
      const generatedProfile = {
        ...createEmptyFoundationalProfile(),
        studyPreferences: ['Brief exercises and outdoor activities.'],
        teacherNotes: 'Prefers short drills. Enjoys climbing.',
      };
      const draft = await refreshProfileDraftFromApprovedCandidates({
        request: { studentId, candidateIds: selectedIds },
        overrides: {
          students: { getById: async () => ({ id: studentId, student: 'Ari', voices: {} }) },
          memory: { getOverview: async () => null },
          drafting: {
            generate: async () => ({
              structuredProfile: generatedProfile,
              rawOutput: generatedProfile,
              rawText: JSON.stringify(generatedProfile),
              provider: 'openai',
              model: 'fixture',
              finishReason: 'stop',
            }),
          },
        },
      });
      expect([...draft.includedCandidateIds].sort()).toEqual([...selectedIds].sort());
      expect(draft.draftRevision.structuredContent).toMatchObject({
        studyPreferences: expect.arrayContaining(['Prefers short drills.']),
        interestsAndUsefulThemes: ['Enjoys climbing.'],
      });
      const links = await withPgClient((client) =>
        client.query(
          'SELECT candidate_id FROM student_profile_candidate_draft_revisions WHERE revision_id=$1',
          [draft.draftRevision.id],
        ),
      );
      expect(links.rows.map((r) => r.candidate_id).sort()).toEqual([...selectedIds].sort());
      const premature = await markStudentProfileCandidatesPromotedByRevision(
        draft.draftRevision.id,
        {
          studentId,
          contentHash: draft.draftRevision.contentHash,
          structuredContent: draft.draftRevision.structuredContent,
        },
      );
      expect(premature.promotedCandidateIds).toEqual([]);
      expect(premature.omittedCandidates).toEqual(
        expect.arrayContaining(
          selectedIds.map((candidateId) => ({ candidateId, reason: 'revision_changed' })),
        ),
      );
      const foreign = await markStudentProfileCandidatesPromotedByRevision(draft.draftRevision.id, {
        studentId: randomUUID(),
        contentHash: draft.draftRevision.contentHash,
        structuredContent: draft.draftRevision.structuredContent,
      });
      expect(foreign).toEqual({
        linkedCandidateCount: 0,
        promotedCandidateIds: [],
        omittedCandidates: [],
      });
      const editedProfile = {
        ...draft.draftRevision.structuredContent!,
        studyPreferences: remove
          ? ['Brief exercises and outdoor activities.']
          : draft.draftRevision.structuredContent!.studyPreferences,
      };
      const edited = await saveProfileRevisionContent(studentId, '', {
        status: 'draft',
        structuredContent: editedProfile,
        inheritCandidateLinksFromRevisionId: draft.draftRevision.id,
      });
      const activated = await activateProfileRevisionForStudent(studentId, edited.id);
      expect(activated?.candidatePromotion).toEqual({
        linkedCandidateCount: 2,
        promotedCandidateIds: expect.arrayContaining(remove ? [candidates[1]!.id] : selectedIds),
        omittedCandidates: remove
          ? [{ candidateId: candidates[0]!.id, reason: 'fact_not_represented' }]
          : [],
      });
      expect(activated?.candidatePromotion?.promotedCandidateIds).toHaveLength(remove ? 1 : 2);
      expect(await getStudentProfileCandidateById(studentId, candidates[0]!.id)).toMatchObject({
        status: remove ? 'approved' : 'promoted',
        promotedRevisionId: remove ? null : edited.id,
      });
      expect(await getStudentProfileCandidateById(studentId, candidates[2]!.id)).toMatchObject({
        status: 'approved',
        promotedRevisionId: null,
      });
      const retry = await activateProfileRevisionForStudent(studentId, edited.id);
      expect(retry?.candidatePromotion).toEqual(activated?.candidatePromotion);
    },
  );

  it('fences an active profile change before candidate insertion', async () => {
    const { params, studentId } = await refreshFixture();
    const revisionId = randomUUID();
    await withPgClient((client) =>
      client.query(
        `INSERT INTO student_profile_revisions
      (id, student_id, content, content_hash, source, status, version_number, version_label)
      VALUES ($1, $2, 'Updated profile', 'changed-profile-hash', 'update', 'draft', 1, 'v1')`,
        [revisionId, studentId],
      ),
    );
    await activateProfileRevision(studentId, revisionId);
    expect(await persistStudentProfileCandidateRefresh(params)).toMatchObject({
      outcome: 'active_profile_changed',
      created: [],
    });
    expect((await listStudentProfileCandidates({ studentId, limit: 25, offset: 0 })).items).toEqual(
      [],
    );
  });
});
