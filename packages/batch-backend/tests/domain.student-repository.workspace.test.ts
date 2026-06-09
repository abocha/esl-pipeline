import './support/bootstrap-pg-test-env.js';

import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveStudent,
  getStudentById,
  insertStudent,
  listStudents,
  restoreStudent,
} from '../src/domain/student-repository.js';
import { closePgPool, withPgClientSessionContext } from '../src/infrastructure/db.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

async function resetStudentWorkspaceTables(): Promise<void> {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      'TRUNCATE TABLE workspace_business_settings, workspace_memberships, workspaces, students, users RESTART IDENTITY CASCADE',
    );
  });
}

async function seedWorkspace(workspaceId: string): Promise<void> {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
      workspaceId,
      `Workspace ${workspaceId.slice(0, 8)}`,
    ]);
  });
}

describe('domain/student-repository workspace scoping', () => {
  beforeEach(async () => {
    await resetStudentWorkspaceTables();
  });

  afterAll(async () => {
    await resetStudentWorkspaceTables();
    await closePgPool();
  });

  it('allows the same student name in different workspaces', async () => {
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    await seedWorkspace(workspaceA);
    await seedWorkspace(workspaceB);

    await insertStudent({ id: randomUUID(), student: 'Anna', workspaceId: workspaceA });
    await insertStudent({ id: randomUUID(), student: 'Anna', workspaceId: workspaceB });

    const first = await listStudents({ workspaceId: workspaceA });
    const second = await listStudents({ workspaceId: workspaceB });

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]?.workspaceId).toBe(workspaceA);
    expect(second.items[0]?.workspaceId).toBe(workspaceB);
  });

  it('does not read or mutate students outside the requested workspace', async () => {
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const studentId = randomUUID();
    await seedWorkspace(workspaceA);
    await seedWorkspace(workspaceB);
    await insertStudent({ id: studentId, student: 'Bea', workspaceId: workspaceA });

    expect(await getStudentById(studentId, { workspaceId: workspaceB })).toBeNull();
    expect(await archiveStudent({ id: studentId, workspaceId: workspaceB })).toBeNull();
    expect(await restoreStudent(studentId, { workspaceId: workspaceB })).toBeNull();

    const stillVisible = await getStudentById(studentId, { workspaceId: workspaceA });
    expect(stillVisible?.archivedAt).toBeNull();
  });
});
