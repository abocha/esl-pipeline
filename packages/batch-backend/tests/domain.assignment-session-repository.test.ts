import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  archiveAssignmentSession,
  createOrReuseAssignmentSession,
  getAssignmentSessionByIdForUser,
  listAssignmentSessionsForUser,
  updateAssignmentSession,
} from '../src/domain/assignment-session-repository.js';
import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function resetTables() {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('TRUNCATE TABLE assignment_sessions RESTART IDENTITY CASCADE');
  });
}

async function insertUser(userId: string) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO users (id, email, password_hash, role, is_active, created_at, updated_at)
      VALUES ($1, $2, 'hash', 'user', TRUE, NOW(), NOW())
      `,
      [userId, `${userId.replaceAll('-', '').slice(0, 16)}@example.com`],
    );
  });
}

async function insertRecording(recordingId: string) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO recordings (
        id, source, source_path, storage_uri, bytes, status, created_at, updated_at
      )
      VALUES ($1, 'upload', 'lesson.mp3', 'local://recordings/lesson.mp3', 12, 'ingested', NOW(), NOW())
      `,
      [recordingId],
    );
  });
}

async function insertStudent(studentId: string) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO students (id, student, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      `,
      [studentId, `Alex ${studentId.slice(0, 8)}`],
    );
  });
}

async function insertLesson(studentId: string, lessonId: string) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO student_lessons (
        id,
        student_id,
        starts_at,
        duration_minutes,
        status,
        consumes_credit
      )
      VALUES ($1, $2, '2026-05-18T10:00:00.000Z', 60, 'scheduled', FALSE)
      `,
      [lessonId, studentId],
    );
  });
}

describe('domain/assignment-session-repository', () => {
  beforeEach(async () => {
    await resetTables();
  });

  it('creates, lists, and updates a user-owned assignment session', async () => {
    const userId = randomUUID();
    const recordingId = randomUUID();
    await insertUser(userId);
    await insertRecording(recordingId);

    const created = await createOrReuseAssignmentSession({
      userId,
      recordingId,
      currentStage: 'source',
      selectedPreset: 'general-english',
    });

    expect(created.userId).toBe(userId);
    expect(created.recordingId).toBe(recordingId);
    expect(created.currentStage).toBe('source');
    expect(created.selectedPreset).toBe('general-english');

    const updated = await updateAssignmentSession({
      id: created.id,
      userId,
      currentStage: 'assignment',
      teacherNotes: 'Target past tense.',
      selectedGenerationProvider: 'openrouter',
      selectedGenerationModel: 'model-1',
    });

    expect(updated).not.toBeNull();
    expect(updated!.currentStage).toBe('assignment');
    expect(updated!.teacherNotes).toBe('Target past tense.');
    expect(updated!.selectedGenerationProvider).toBe('openrouter');

    const listed = await listAssignmentSessionsForUser(userId, 10);
    expect(listed.map((session) => session.id)).toEqual([created.id]);
  });

  it('persists lesson lineage on assignment sessions', async () => {
    const userId = randomUUID();
    const studentId = randomUUID();
    const lessonId = randomUUID();
    await insertUser(userId);
    await insertStudent(studentId);
    await insertLesson(studentId, lessonId);

    const created = await createOrReuseAssignmentSession({
      userId,
      studentId,
      lessonId,
      currentStage: 'source',
    });

    expect(created.lessonId).toBe(lessonId);

    const updated = await updateAssignmentSession({
      id: created.id,
      userId,
      currentStage: 'assignment',
      lessonId: null,
    });

    expect(updated?.lessonId).toBeNull();
  });

  it('reuses an active session for the same user and recording', async () => {
    const userId = randomUUID();
    const recordingId = randomUUID();
    await insertUser(userId);
    await insertRecording(recordingId);

    const first = await createOrReuseAssignmentSession({ userId, recordingId });
    const second = await createOrReuseAssignmentSession({
      userId,
      recordingId,
      currentStage: 'context',
    });

    expect(second.id).toBe(first.id);
    expect(second.currentStage).toBe('context');
  });

  it('handles concurrent create-or-reuse calls for the same recording', async () => {
    const userId = randomUUID();
    const recordingId = randomUUID();
    await insertUser(userId);
    await insertRecording(recordingId);

    const [first, second] = await Promise.all([
      createOrReuseAssignmentSession({
        userId,
        recordingId,
        currentStage: 'source',
      }),
      createOrReuseAssignmentSession({
        userId,
        recordingId,
        currentStage: 'context',
      }),
    ]);

    expect(second.id).toBe(first.id);
    const listed = await listAssignmentSessionsForUser(userId, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.recordingId).toBe(recordingId);
  });

  it('enforces user ownership for get, update, and archive operations', async () => {
    const ownerId = randomUUID();
    const otherUserId = randomUUID();
    await insertUser(ownerId);
    await insertUser(otherUserId);

    const session = await createOrReuseAssignmentSession({
      userId: ownerId,
      currentStage: 'context',
    });

    await expect(getAssignmentSessionByIdForUser(session.id, otherUserId)).resolves.toBeNull();
    await expect(
      updateAssignmentSession({
        id: session.id,
        userId: otherUserId,
        currentStage: 'assignment',
      }),
    ).resolves.toBeNull();
    await expect(archiveAssignmentSession(session.id, otherUserId)).resolves.toBeNull();

    const archived = await archiveAssignmentSession(session.id, ownerId);
    expect(archived?.archivedAt).toBeInstanceOf(Date);
    await expect(getAssignmentSessionByIdForUser(session.id, ownerId)).resolves.toBeNull();
  });
});
