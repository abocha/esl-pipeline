import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getStudentProfileCandidateById,
  insertStudentProfileCandidate,
  linkStudentProfileCandidatesToDraftRevision,
  listLatestStudentProfileCandidatesByKeys,
  listStudentProfileCandidates,
  markStudentProfileCandidatesPromotedByRevision,
  supersedePendingStudentProfileCandidates,
  updateStudentProfileCandidateReview,
} from '../src/domain/student-profile-candidate-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

async function truncateCandidateTables() {
  await withPgClient(async (client) => {
    await client.query(
      'TRUNCATE TABLE student_profile_candidate_draft_revisions, student_profile_candidates, student_memory_snapshots, lesson_memory_entries, homework_memory_entries, transcripts, recordings, jobs, students, users, profile_revisions, profiles RESTART IDENTITY CASCADE',
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

  it('promotes candidates for any linked draft revision even after a newer draft is linked later', async () => {
    const studentId = randomUUID();
    const profileId = randomUUID();
    const revisionA = randomUUID();
    const revisionB = randomUUID();

    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO students (id, student, created_at, updated_at) VALUES ($1, 'Ari', NOW(), NOW())`,
        [studentId],
      );
      await client.query(
        `INSERT INTO profiles (id, label, active_revision_id, created_at, updated_at)
         VALUES ($1, 'Ari', NULL, NOW(), NOW())`,
        [profileId],
      );
      await client.query(
        `INSERT INTO profile_revisions (
           id, profile_id, content, content_hash, source, status, version_number, version_label,
           activated_at, deprecated_at, created_at, created_by, restored_from_revision_id
         )
         VALUES
           ($1, $3, 'Draft A', 'hash-a', 'update', 'draft', 1, 'v1', NULL, NULL, NOW(), NULL, NULL),
           ($2, $3, 'Draft B', 'hash-b', 'update', 'draft', 2, 'v2', NULL, NULL, NOW(), NULL, NULL)`,
        [revisionA, revisionB, profileId],
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

    await markStudentProfileCandidatesPromotedByRevision(revisionA);
    const promoted = await getStudentProfileCandidateById(studentId, candidate.id);

    expect(promoted).toMatchObject({
      id: candidate.id,
      status: 'promoted',
      promotedRevisionId: revisionA,
    });
    expect(promoted?.promotedAt).toBeInstanceOf(Date);
  });
});
