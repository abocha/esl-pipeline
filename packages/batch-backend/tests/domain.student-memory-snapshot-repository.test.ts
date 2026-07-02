import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  getLatestReadyStudentMemorySnapshotByStudentId,
  insertCanonicalReadyStudentMemorySnapshot,
  listStudentMemorySnapshots,
  StudentMemorySnapshotParentChangedError,
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
});
