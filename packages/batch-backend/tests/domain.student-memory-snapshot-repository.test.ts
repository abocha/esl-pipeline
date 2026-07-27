import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getEligibleReadyStudentMemorySnapshotById,
  getLatestReadyStudentMemorySnapshotByStudentId,
  insertCanonicalReadyStudentMemorySnapshot,
  listStudentMemorySnapshots,
  StudentMemorySnapshotParentChangedError,
  StudentMemorySnapshotSourcesChangedError,
} from '../src/domain/student-memory-snapshot-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

const describeIfPg = hasPgTestEnv ? describe : describe.skip;

async function truncateStudentMemorySnapshotTables() {
  await withPgClient(async (client) => {
    await client.query(
      `TRUNCATE TABLE
        student_memory_snapshots,
        lesson_memory_entries,
        transcripts,
        recordings,
        students
      RESTART IDENTITY CASCADE`,
    );
  });
}

async function insertStudent(studentId = randomUUID()) {
  await withPgClient((client) =>
    client.query(
      `INSERT INTO students (id, student, created_at, updated_at)
       VALUES ($1, 'Ari', NOW(), NOW())`,
      [studentId],
    ),
  );
  return studentId;
}

async function insertLessonMemory(args: {
  studentId: string;
  status: 'ready' | 'superseded';
  withConfirmedSource: boolean;
}) {
  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  const lessonMemoryId = randomUUID();
  await withPgClient(async (client) => {
    await client.query(
      `INSERT INTO recordings
         (id, source, student_id, source_path, storage_uri, bytes, status, created_at, updated_at)
       VALUES ($1, 'upload', $2, 'lesson.wav', $3, 100, 'ingested', NOW(), NOW())`,
      [recordingId, args.studentId, `local://recordings/${recordingId}.wav`],
    );
    await client.query(
      `INSERT INTO transcripts
         (id, recording_id, storage_uri, mode, model, language, stt_provider,
          fallback_used, created_at, updated_at)
       VALUES ($1, $2, $3, 'timeline', 'nova-3', 'multi', 'deepgram', FALSE, NOW(), NOW())`,
      [transcriptId, recordingId, `local://transcripts/${transcriptId}.txt`],
    );
    await client.query(
      `INSERT INTO lesson_memory_entries
         (id, student_id, transcript_id, recording_id, schema_version, generated_at,
          provider, model, status, source_kind, source_storage_uri, source_content_hash)
       VALUES ($1, $2, $3, $4, 'lesson-memory.v1', NOW(), 'openai', 'gpt-5.2', $5,
               'lesson_transcript', $6, $7)`,
      [
        lessonMemoryId,
        args.studentId,
        transcriptId,
        recordingId,
        args.status,
        args.withConfirmedSource ? `local://confirmed/${transcriptId}.txt` : null,
        args.withConfirmedSource ? 'a'.repeat(64) : null,
      ],
    );
  });
  return lessonMemoryId;
}

async function insertStoredSnapshot(args: {
  id?: string;
  studentId: string;
  status?: 'pending' | 'ready';
  generatedAt: string;
  lessonMemoryEntryIds: string[];
}) {
  const id = args.id ?? randomUUID();
  await withPgClient((client) =>
    client.query(
      `INSERT INTO student_memory_snapshots
         (id, student_id, schema_version, generated_at, provider, model, status,
          lesson_memory_entry_ids)
       VALUES ($1, $2, 'student-memory-snapshot.v1', $3, 'openai', 'gpt-5.2', $4, $5)`,
      [
        id,
        args.studentId,
        new Date(args.generatedAt),
        args.status ?? 'ready',
        args.lessonMemoryEntryIds,
      ],
    ),
  );
  return id;
}

async function insertReadySnapshot(args: {
  studentId: string;
  id?: string;
  generatedAt: string;
  expectedLatestReadySnapshotId?: string | null;
}) {
  return insertCanonicalReadyStudentMemorySnapshot({
    id: args.id ?? randomUUID(),
    studentId: args.studentId,
    schemaVersion: 'student-memory-snapshot.v1',
    generatedAt: new Date(args.generatedAt),
    provider: 'openai',
    model: 'gpt-5.2',
    lessonMemoryEntryIds: [],
    homeworkMemoryEntryIds: [],
    contentHash: null,
    generationNotes: null,
    stableStrengths: [],
    recurringIssues: [],
    activeReviewBacklog: [],
    recentProgress: [],
    personalFacts: [],
    recommendedAssignmentDirections: [],
    unresolvedIssues: [],
    snapshotSummary: 'Snapshot summary',
    expectedLatestReadySnapshotId: args.expectedLatestReadySnapshotId,
  });
}

describeIfPg('domain/student-memory-snapshot-repository', () => {
  beforeAll(async () => {
    await truncateStudentMemorySnapshotTables();
  });

  beforeEach(async () => {
    await truncateStudentMemorySnapshotTables();
  });

  afterAll(async () => {
    await truncateStudentMemorySnapshotTables();
    await closePgPool();
  });

  it('inserts a guarded ready snapshot when the expected parent is still latest', async () => {
    const studentId = await insertStudent();
    const parentId = randomUUID();
    const childId = randomUUID();
    const parent = await insertReadySnapshot({
      studentId,
      id: parentId,
      generatedAt: '2026-07-01T10:00:00.000Z',
    });

    const child = await insertReadySnapshot({
      studentId,
      id: childId,
      generatedAt: '2026-07-01T11:00:00.000Z',
      expectedLatestReadySnapshotId: parent.id,
    });

    await expect(getLatestReadyStudentMemorySnapshotByStudentId(studentId)).resolves.toMatchObject({
      id: child.id,
    });
  });

  it('rejects a guarded ready snapshot when the expected parent is stale', async () => {
    const studentId = await insertStudent();
    const staleParentId = randomUUID();
    const actualParentId = randomUUID();
    const staleChildId = randomUUID();
    const staleParent = await insertReadySnapshot({
      studentId,
      id: staleParentId,
      generatedAt: '2026-07-01T10:00:00.000Z',
    });
    const actualParent = await insertReadySnapshot({
      studentId,
      id: actualParentId,
      generatedAt: '2026-07-01T11:00:00.000Z',
    });

    await expect(
      insertReadySnapshot({
        studentId,
        id: staleChildId,
        generatedAt: '2026-07-01T12:00:00.000Z',
        expectedLatestReadySnapshotId: staleParent.id,
      }),
    ).rejects.toMatchObject({
      name: 'StudentMemorySnapshotParentChangedError',
      studentId,
      expectedLatestReadySnapshotId: staleParent.id,
      actualLatestReadySnapshotId: actualParent.id,
    } satisfies Partial<StudentMemorySnapshotParentChangedError>);

    const snapshots = await listStudentMemorySnapshots({ studentId, limit: 10, offset: 0 });
    expect(snapshots.map((snapshot) => snapshot.id)).not.toContain(staleChildId);
    await expect(getLatestReadyStudentMemorySnapshotByStudentId(studentId)).resolves.toMatchObject({
      id: actualParent.id,
    });
  });

  it('allows a guarded bootstrap insert only while no ready snapshot exists', async () => {
    const studentId = await insertStudent();
    const bootstrapId = randomUUID();

    const bootstrap = await insertReadySnapshot({
      studentId,
      id: bootstrapId,
      generatedAt: '2026-07-01T10:00:00.000Z',
      expectedLatestReadySnapshotId: null,
    });

    await expect(getLatestReadyStudentMemorySnapshotByStudentId(studentId)).resolves.toMatchObject({
      id: bootstrap.id,
    });
  });

  it('rejects a guarded bootstrap insert after a ready snapshot appears', async () => {
    const studentId = await insertStudent();
    const actualParentId = randomUUID();
    const staleBootstrapId = randomUUID();
    const actualParent = await insertReadySnapshot({
      studentId,
      id: actualParentId,
      generatedAt: '2026-07-01T10:00:00.000Z',
    });

    await expect(
      insertReadySnapshot({
        studentId,
        id: staleBootstrapId,
        generatedAt: '2026-07-01T11:00:00.000Z',
        expectedLatestReadySnapshotId: null,
      }),
    ).rejects.toMatchObject({
      name: 'StudentMemorySnapshotParentChangedError',
      studentId,
      expectedLatestReadySnapshotId: null,
      actualLatestReadySnapshotId: actualParent.id,
    } satisfies Partial<StudentMemorySnapshotParentChangedError>);

    const snapshots = await listStudentMemorySnapshots({ studentId, limit: 10, offset: 0 });
    expect(snapshots.map((snapshot) => snapshot.id)).not.toContain(staleBootstrapId);
  });

  it('keeps unguarded ready inserts authoritative', async () => {
    const studentId = await insertStudent();
    const parentId = randomUUID();
    const authoritativeId = randomUUID();
    await insertReadySnapshot({
      studentId,
      id: parentId,
      generatedAt: '2026-07-01T10:00:00.000Z',
    });

    const authoritative = await insertReadySnapshot({
      studentId,
      id: authoritativeId,
      generatedAt: '2026-07-01T11:00:00.000Z',
    });

    await expect(getLatestReadyStudentMemorySnapshotByStudentId(studentId)).resolves.toMatchObject({
      id: authoritative.id,
    });
  });

  it('uses only eligible ready snapshots as canonical parents and inspection rows', async () => {
    const studentId = await insertStudent();
    const otherStudentId = await insertStudent();
    const validLessonId = await insertLessonMemory({
      studentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    const crossStudentLessonId = await insertLessonMemory({
      studentId: otherStudentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    const nonReadyLessonId = await insertLessonMemory({
      studentId,
      status: 'superseded',
      withConfirmedSource: true,
    });
    const provenanceFreeLessonId = await insertLessonMemory({
      studentId,
      status: 'ready',
      withConfirmedSource: false,
    });
    const validSnapshotId = await insertStoredSnapshot({
      studentId,
      generatedAt: '2026-07-01T10:00:00.000Z',
      lessonMemoryEntryIds: [validLessonId],
    });
    const invalidSnapshotIds = await Promise.all(
      [[randomUUID()], [crossStudentLessonId], [nonReadyLessonId], [provenanceFreeLessonId]].map(
        (lessonMemoryEntryIds, index) =>
          insertStoredSnapshot({
            studentId,
            generatedAt: `2026-07-01T1${index + 1}:00:00.000Z`,
            lessonMemoryEntryIds,
          }),
      ),
    );
    const pendingInvalidId = await insertStoredSnapshot({
      studentId,
      status: 'pending',
      generatedAt: '2026-07-01T15:00:00.000Z',
      lessonMemoryEntryIds: [randomUUID()],
    });

    await expect(getLatestReadyStudentMemorySnapshotByStudentId(studentId)).resolves.toMatchObject({
      id: validSnapshotId,
    });
    for (const invalidSnapshotId of invalidSnapshotIds) {
      await expect(
        getEligibleReadyStudentMemorySnapshotById(invalidSnapshotId),
      ).resolves.toBeNull();
    }
    await expect(getEligibleReadyStudentMemorySnapshotById(validSnapshotId)).resolves.toMatchObject(
      {
        id: validSnapshotId,
      },
    );

    const readySnapshots = await listStudentMemorySnapshots({
      studentId,
      statuses: ['ready'],
      limit: 20,
      offset: 0,
    });
    expect(readySnapshots.map((snapshot) => snapshot.id)).toEqual([validSnapshotId]);

    const readyAndPendingSnapshots = await listStudentMemorySnapshots({
      studentId,
      statuses: ['ready', 'pending'],
      limit: 20,
      offset: 0,
    });
    expect(readyAndPendingSnapshots.map((snapshot) => snapshot.id)).toEqual([
      pendingInvalidId,
      validSnapshotId,
    ]);

    const child = await insertReadySnapshot({
      studentId,
      generatedAt: '2026-07-01T16:00:00.000Z',
      expectedLatestReadySnapshotId: validSnapshotId,
    });
    expect(child.status).toBe('ready');
  });

  it('rejects a stale bootstrap result after its confirmed lesson source is superseded', async () => {
    const studentId = await insertStudent();
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const lessonMemoryId = randomUUID();
    await withPgClient(async (client) => {
      await client.query(
        `INSERT INTO recordings
           (id, source, student_id, source_path, storage_uri, bytes, status, created_at, updated_at)
         VALUES ($1, 'upload', $2, 'lesson.wav', 'local://recordings/lesson.wav', 100,
                 'ingested', NOW(), NOW())`,
        [recordingId, studentId],
      );
      await client.query(
        `INSERT INTO transcripts
           (id, recording_id, storage_uri, mode, model, language, stt_provider,
            fallback_used, created_at, updated_at)
         VALUES ($1, $2, 'local://transcripts/a.txt', 'timeline', 'nova-3', 'multi',
                 'deepgram', FALSE, NOW(), NOW())`,
        [transcriptId, recordingId],
      );
      await client.query(
        `INSERT INTO lesson_memory_entries
           (id, student_id, transcript_id, recording_id, schema_version, generated_at,
            provider, model, status, source_kind, source_storage_uri, source_content_hash)
         VALUES ($1, $2, $3, $4, 'lesson-memory.v1', NOW(), 'openai', 'gpt-5.2',
                 'superseded', 'lesson_transcript', 'local://confirmed/a.txt', $5)`,
        [lessonMemoryId, studentId, transcriptId, recordingId, 'a'.repeat(64)],
      );
    });

    await expect(
      insertCanonicalReadyStudentMemorySnapshot({
        studentId,
        schemaVersion: 'student-memory-snapshot.v1',
        provider: 'openai',
        model: 'gpt-5.2',
        lessonMemoryEntryIds: [lessonMemoryId],
        homeworkMemoryEntryIds: [],
        expectedLatestReadySnapshotId: null,
      }),
    ).rejects.toMatchObject({
      name: 'StudentMemorySnapshotSourcesChangedError',
      unavailableLessonMemoryEntryIds: [lessonMemoryId],
    } satisfies Partial<StudentMemorySnapshotSourcesChangedError>);

    await expect(getLatestReadyStudentMemorySnapshotByStudentId(studentId)).resolves.toBeNull();
  });
});
