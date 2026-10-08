import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { listStudentMemorySnapshotBackfillTargets } from '../src/application/student-memory-snapshot-backfill.js';
import type { StudentMemoryCurrentness } from '../src/domain/student-memory-currentness.js';
import {
  ensurePendingStudentMemorySnapshot,
  getEligibleReadyStudentMemorySnapshotById,
  getLatestReadyStudentMemorySnapshotByStudentId,
  getStudentMemorySnapshotById,
  getStudentMemorySnapshotSelection,
  insertCanonicalReadyStudentMemorySnapshot,
  listStudentMemorySnapshots,
  markStudentMemorySnapshotRepairRequired,
  StudentMemorySnapshotIntentObsoleteError,
  StudentMemorySnapshotParentChangedError,
  StudentMemorySnapshotSourcesChangedError,
} from '../src/domain/student-memory-snapshot-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import {
  insertLessonMemory,
  makeLessonMemorySourcesHistorical,
} from './support/student-memory-fixture.js';
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
       VALUES ($1, $2, NOW(), NOW())`,
      [studentId, `Ari-${studentId}`],
    ),
  );
  return studentId;
}

async function insertStoredSnapshot(args: {
  id?: string;
  studentId: string;
  status?: 'pending' | 'ready' | 'failed';
  generatedAt: string;
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds?: string[];
}) {
  const id = args.id ?? randomUUID();
  await withPgClient((client) =>
    client.query(
      `INSERT INTO student_memory_snapshots
         (id, student_id, schema_version, generated_at, provider, model, status,
          lesson_memory_entry_ids, homework_memory_entry_ids)
       VALUES ($1, $2, 'student-memory-snapshot.v1', $3, 'openai', 'gpt-5.2', $4, $5, $6)`,
      [
        id,
        args.studentId,
        new Date(args.generatedAt),
        args.status ?? 'ready',
        args.lessonMemoryEntryIds,
        args.homeworkMemoryEntryIds ?? [],
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
  it('retains confirmed immutable evidence when the transcript working copy is autosaved', async () => {
    const studentId = await insertStudent();
    const lessonId = await insertLessonMemory({
      studentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    const snapshotId = await insertStoredSnapshot({
      studentId,
      generatedAt: '2026-10-05T00:00:00Z',
      lessonMemoryEntryIds: [lessonId],
    });
    const frozen = await getStudentMemorySnapshotById(snapshotId);
    await withPgClient((client) =>
      client.query(
        "UPDATE transcripts SET storage_uri = 'local://working/new-copy', content_hash = $2, working_version = working_version + 1 WHERE id = (SELECT transcript_id FROM lesson_memory_entries WHERE id = $1)",
        [lessonId, 'b'.repeat(64)],
      ),
    );
    await expect(getStudentMemorySnapshotSelection(studentId)).resolves.toMatchObject({
      snapshot: { id: snapshotId },
      availability: { state: 'available' },
    });
    expect(await getStudentMemorySnapshotById(snapshotId)).toEqual(frozen);
  });
  it('selects frozen 19-episode lineage including 18 verified historical observations without rewriting evidence', async () => {
    const studentId = await insertStudent();
    const lessons: string[] = [];
    for (let i = 0; i < 19; i++)
      lessons.push(
        await insertLessonMemory({ studentId, status: 'ready', withConfirmedSource: true }),
      );
    await makeLessonMemorySourcesHistorical(lessons.slice(0, 18));
    const snapshotId = await insertStoredSnapshot({
      studentId,
      generatedAt: '2026-10-05T00:00:00Z',
      lessonMemoryEntryIds: lessons,
    });
    const frozen = await withPgClient(
      async (client) =>
        (
          await client.query(
            `SELECT to_jsonb(s) AS bytes FROM student_memory_snapshots s WHERE id = $1
      UNION ALL SELECT to_jsonb(l) FROM lesson_memory_entries l WHERE id = ANY($2::uuid[])`,
            [snapshotId, lessons],
          )
        ).rows,
    );
    await expect(getStudentMemorySnapshotSelection(studentId)).resolves.toMatchObject({
      snapshot: { id: snapshotId },
      availability: { state: 'available', lessonReferenceCount: 19 },
    });
    // Publication uses exactly the same verified-evidence rule as readers.
    await insertCanonicalReadyStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: 'fixture',
      lessonMemoryEntryIds: lessons,
      expectedLatestReadySnapshotId: snapshotId,
    });
    const after = await withPgClient(
      async (client) =>
        (
          await client.query(
            'SELECT to_jsonb(l) AS bytes FROM lesson_memory_entries l WHERE id = ANY($1::uuid[])',
            [lessons],
          )
        ).rows,
    );
    expect(after).toEqual(frozen.slice(1));
    // Reading itself leaves the frozen aggregate untouched; canonical child publication only supersedes its metadata.
    const old = await getStudentMemorySnapshotById(snapshotId);
    expect(old?.lessonMemoryEntryIds).toEqual(lessons);
  });

  it.each(['hash', 'uri', 'identity', 'binding', 'owner', 'workspace', 'superseded'] as const)(
    'rejects genuinely invalid %s evidence in historical lineage',
    async (reason) => {
      const studentId = await insertStudent();
      const lessonId = await insertLessonMemory({
        studentId,
        status: 'ready',
        withConfirmedSource: true,
      });
      await makeLessonMemorySourcesHistorical([lessonId]);
      await insertStoredSnapshot({
        studentId,
        generatedAt: '2026-10-05T00:00:00Z',
        lessonMemoryEntryIds: [lessonId],
      });
      await withPgClient(async (client) => {
        if (reason === 'hash')
          await client.query(
            'UPDATE lesson_memory_entries SET source_content_hash = $2 WHERE id = $1',
            [lessonId, 'b'.repeat(64)],
          );
        if (reason === 'uri')
          await client.query(
            "UPDATE lesson_memory_entries SET source_storage_uri = 'local://changed' WHERE id = $1",
            [lessonId],
          );
        if (reason === 'identity')
          await client.query(
            'UPDATE recordings SET source_fingerprint = $2 WHERE id = (SELECT recording_id FROM lesson_memory_entries WHERE id = $1)',
            [lessonId, 'b'.repeat(64)],
          );
        if (reason === 'binding')
          await client.query(
            'DELETE FROM assignment_source_bindings WHERE assignment_session_id = (SELECT assignment_session_id FROM lesson_memory_entries WHERE id = $1)',
            [lessonId],
          );
        if (reason === 'superseded')
          await client.query(
            "UPDATE lesson_memory_entries SET status = 'superseded' WHERE id = $1",
            [lessonId],
          );
        if (reason === 'owner') {
          const other = await insertStudent();
          await client.query('UPDATE lesson_memory_entries SET student_id = $2 WHERE id = $1', [
            lessonId,
            other,
          ]);
        }
        if (reason === 'workspace') {
          const otherWorkspace = randomUUID();
          await client.query(
            "INSERT INTO workspaces (id, name) VALUES ($1, 'Other fixture workspace')",
            [otherWorkspace],
          );
          await client.query(
            'UPDATE assignment_source_bindings SET workspace_id = $2 WHERE assignment_session_id = (SELECT assignment_session_id FROM lesson_memory_entries WHERE id = $1)',
            [lessonId, otherWorkspace],
          );
        }
      });
      await expect(getStudentMemorySnapshotSelection(studentId)).resolves.toMatchObject({
        snapshot: null,
        availability: { state: 'repair_required' },
      });
    },
  );

  it('persists repair-required across restarts and rejects recent-only publication after source invalidation', async () => {
    const studentId = await insertStudent();
    const lessons: string[] = [];
    for (let i = 0; i < 9; i++)
      lessons.push(
        await insertLessonMemory({ studentId, status: 'ready', withConfirmedSource: true }),
      );
    const aggregateId = await insertCanonicalReadyStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: 'fixture',
      lessonMemoryEntryIds: lessons,
      snapshotSummary: 'Established older teaching history',
    });
    await withPgClient((client) =>
      client.query("UPDATE lesson_memory_entries SET status = 'superseded' WHERE id = $1", [
        lessons[0],
      ]),
    );
    const intent = await ensurePendingStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: 'fixture',
      generationNotes: { trigger: 'lesson-memory-ready' },
    });
    await markStudentMemorySnapshotRepairRequired(studentId, intent.entry.id);
    await closePgPool();
    await expect(getStudentMemorySnapshotSelection(studentId)).resolves.toMatchObject({
      snapshot: null,
      availability: { state: 'repair_required', lessonReferenceCount: 9 },
    });
    await expect(getStudentMemorySnapshotById(intent.entry.id)).resolves.toMatchObject({
      status: 'failed',
      generationNotes: { continuityReason: 'repair_required' },
    });
    await expect(
      insertCanonicalReadyStudentMemorySnapshot({
        studentId,
        schemaVersion: 'student-memory-snapshot.v1',
        provider: 'openai',
        model: 'fixture',
        lessonMemoryEntryIds: lessons.slice(-5),
        expectedLatestReadySnapshotId: null,
      }),
    ).rejects.toMatchObject({ name: 'StudentMemorySnapshotRepairRequiredError' });
    expect((await getStudentMemorySnapshotById(aggregateId.id))?.lessonMemoryEntryIds).toEqual(
      lessons,
    );
  });

  it('does not infer established history from failed or cancelled first intent coverage', async () => {
    const studentId = await insertStudent();
    const intent = await ensurePendingStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: 'fixture',
    });
    await withPgClient((client) =>
      client.query(
        'UPDATE student_memory_snapshots SET status = \'superseded\', lesson_memory_entry_ids = $2, generation_notes = \'{"cancelledAt":"fixture"}\' WHERE id = $1',
        [intent.entry.id, [randomUUID()]],
      ),
    );
    await expect(getStudentMemorySnapshotSelection(studentId)).resolves.toMatchObject({
      availability: { state: 'absent' },
    });
  });
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

  it('supersedes matching pending homework refreshes when eligible ready coverage already exists', async () => {
    const studentId = await insertStudent();
    const homeworkMemoryEntryId = randomUUID();
    const pending = await ensurePendingStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      sourceEntryId: homeworkMemoryEntryId,
      reuseReadyHomeworkSource: true,
      generationNotes: { sourceEntryId: homeworkMemoryEntryId },
    });
    const existing = await insertStoredSnapshot({
      studentId,
      generatedAt: '2026-07-01T10:00:00.000Z',
      lessonMemoryEntryIds: [],
      homeworkMemoryEntryIds: [homeworkMemoryEntryId],
    });

    const reconciled = await ensurePendingStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      sourceEntryId: homeworkMemoryEntryId,
      reuseReadyHomeworkSource: true,
    });
    const snapshots = await listStudentMemorySnapshots({ studentId, limit: 10, offset: 0 });
    const supersededPending = snapshots.find((snapshot) => snapshot.id === pending.entry.id);

    expect(reconciled).toMatchObject({ outcome: 'already_reconciled', entry: { id: existing } });
    expect(supersededPending).toMatchObject({
      status: 'superseded',
      supersededById: existing,
    });
    expect(
      snapshots.filter(
        (snapshot) =>
          snapshot.status === 'pending' &&
          snapshot.generationNotes?.sourceEntryId === homeworkMemoryEntryId,
      ),
    ).toHaveLength(0);
  });

  it('does not reconcile an automatic homework refresh through ineligible ready coverage', async () => {
    const studentId = await insertStudent();
    const homeworkMemoryEntryId = randomUUID();
    const ineligibleLessonMemoryEntryId = await insertLessonMemory({
      studentId,
      status: 'superseded',
      withConfirmedSource: false,
    });
    const historical = await insertStoredSnapshot({
      studentId,
      generatedAt: '2026-07-01T10:00:00.000Z',
      lessonMemoryEntryIds: [ineligibleLessonMemoryEntryId],
      homeworkMemoryEntryIds: [homeworkMemoryEntryId],
    });

    const result = await ensurePendingStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      sourceEntryId: homeworkMemoryEntryId,
      reuseReadyHomeworkSource: true,
    });

    expect(result).toMatchObject({ outcome: 'created' });
    expect(result.entry.id).not.toBe(historical);
    expect(result.entry.status).toBe('pending');
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

  it('guards ordinary manual replay against a newer authoritative snapshot', async () => {
    const studentId = await insertStudent();
    const pending = await ensurePendingStudentMemorySnapshot({
      studentId,
      schemaVersion: 'student-memory-snapshot.v1',
      provider: 'openai',
      model: 'gpt-5.2',
      replayKey: 'manual-replay',
      generationNotes: { trigger: 'manual-replay' },
    });
    const authoritative = await insertReadySnapshot({
      studentId,
      id: randomUUID(),
      generatedAt: '2026-07-01T11:00:00.000Z',
    });
    await expect(
      insertCanonicalReadyStudentMemorySnapshot({
        studentId,
        pendingEntryId: pending.entry.id,
        schemaVersion: pending.entry.schemaVersion,
        provider: pending.entry.provider,
        model: pending.entry.model,
        expectedCurrentness: pending.entry.generationNotes?.currentness as StudentMemoryCurrentness,
      }),
    ).rejects.toBeInstanceOf(StudentMemorySnapshotIntentObsoleteError);
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

    const unfilteredSnapshots = await listStudentMemorySnapshots({
      studentId,
      limit: 20,
      offset: 0,
    });
    expect(unfilteredSnapshots.map((snapshot) => snapshot.id)).toEqual(
      expect.arrayContaining([pendingInvalidId, validSnapshotId, ...invalidSnapshotIds]),
    );

    await expect(
      insertReadySnapshot({
        studentId,
        generatedAt: '2026-07-01T15:30:00.000Z',
        expectedLatestReadySnapshotId: invalidSnapshotIds[0],
      }),
    ).rejects.toMatchObject({
      name: 'StudentMemorySnapshotParentChangedError',
      studentId,
      expectedLatestReadySnapshotId: invalidSnapshotIds[0],
      actualLatestReadySnapshotId: validSnapshotId,
    } satisfies Partial<StudentMemorySnapshotParentChangedError>);

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

  it('treats an ineligible stored-ready snapshot as missing during replay selection', async () => {
    const missingStudentId = await insertStudent();
    const eligibleStudentId = await insertStudent();
    const missingStudentLessonId = await insertLessonMemory({
      studentId: missingStudentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    const eligibleStudentLessonId = await insertLessonMemory({
      studentId: eligibleStudentId,
      status: 'ready',
      withConfirmedSource: true,
    });
    await insertStoredSnapshot({
      studentId: missingStudentId,
      generatedAt: '2099-07-01T10:00:00.000Z',
      lessonMemoryEntryIds: [randomUUID()],
    });
    await insertStoredSnapshot({
      studentId: eligibleStudentId,
      generatedAt: '2099-07-01T10:00:00.000Z',
      lessonMemoryEntryIds: [eligibleStudentLessonId],
    });

    const missingTargets = await listStudentMemorySnapshotBackfillTargets({
      selection: 'missing',
      limit: 10,
    });
    expect(missingTargets.map((target) => target.studentId)).toEqual([missingStudentId]);
    expect(missingTargets[0]).toMatchObject({
      hasReadySnapshot: false,
      latestReadySnapshotAt: null,
    });

    await insertStoredSnapshot({
      studentId: missingStudentId,
      status: 'failed',
      generatedAt: '2099-07-01T11:00:00.000Z',
      lessonMemoryEntryIds: [missingStudentLessonId],
    });
    const failedTargets = await listStudentMemorySnapshotBackfillTargets({
      selection: 'failed',
      limit: 10,
    });
    expect(failedTargets.map((target) => target.studentId)).toEqual([missingStudentId]);
  });
});
