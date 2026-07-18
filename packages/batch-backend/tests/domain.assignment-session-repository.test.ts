import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function resetTables() {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('TRUNCATE TABLE assignment_sessions RESTART IDENTITY CASCADE');
  });
}

async function insertUserAndStudent(userId: string, studentId: string) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, role)
       VALUES ($1, $2, 'hash', 'user') ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@example.test`],
    );
    await client.query(`INSERT INTO students (id, student) VALUES ($1, 'Alpha Tester')`, [
      studentId,
    ]);
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
        INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
        VALUES ($1, 'upload', $2, $3, 12, 'ingested')
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

describe('domain/assignment-session-repository persistence contract', () => {
  beforeEach(async () => {
    await resetTables();
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

  it('keeps completed Share readable but out of resume, counts, and active-recording reuse', async () => {
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
        `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status)
         VALUES ($1, 'upload', $2, $3, 12, 'ingested')`,
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
    ).resolves.toMatchObject({ id: next.id, recordingId });
    await expect(
      repository.getActiveAssignmentSessionByRecording(userId, recordingId),
    ).resolves.toMatchObject({ id: next.id });
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

  it('treats confirmed Share as the active-session uniqueness boundary', async () => {
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
    ).rejects.toMatchObject({ code: '23505' });

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

  it('defines every resumable-session index from confirmed Share completion', async () => {
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const indexes = await client.query<{ indexname: string; indexdef: string }>(
        `
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN (
            'idx_assignment_sessions_user_active_recording',
            'idx_assignment_sessions_user_active_updated',
            'idx_assignment_sessions_lesson_updated'
          )
        ORDER BY indexname
        `,
      );

      expect(indexes.rows).toHaveLength(3);
      for (const index of indexes.rows) {
        expect(index.indexdef).toContain("confirmed_step <> 'share'::text");
        expect(index.indexdef).not.toContain('archived_at');
      }
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
