import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import {
  createStudentProfile,
  deleteStudentProfile,
  getStudentProfileById,
  listStudentProfiles,
  StudentProfileStoreError,
  updateStudentProfile,
} from '../src/application/student-profiles-store.js';
import { deriveStudentId } from '../src/domain/student-utils.js';
import { loadConfig } from '../src/config/env.js';

const tempDirs: string[] = [];

async function createStudentsDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'esl-students-'));
  const studentsDir = path.join(root, 'students');
  await mkdir(studentsDir, { recursive: true });
  tempDirs.push(root);
  return studentsDir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('student-profiles-store', () => {
  it('lists student profiles and injects the default profile', async () => {
    const studentsDir = await createStudentsDir();
    await writeFile(
      path.join(studentsDir, 'anna.json'),
      JSON.stringify({ student: 'Anna', dbId: 'db-1' }),
      'utf8',
    );

    const result = await listStudentProfiles({ limit: 10 }, { studentsDir });
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(deriveStudentId('Anna'));
    expect(ids).toContain(deriveStudentId('Default'));
  });

  it('creates, updates, and deletes a student profile', async () => {
    const studentsDir = await createStudentsDir();

    const created = await createStudentProfile(
      {
        student: 'New Student',
        colorPreset: 'b1-default',
        profileId: 'profile.md',
        voices: {},
      },
      { studentsDir },
    );
    expect(created.student).toBe('New Student');

    const updated = await updateStudentProfile(
      created.id,
      { colorPreset: 'b2-default' },
      { studentsDir },
    );
    expect(updated?.colorPreset).toBe('b2-default');

    const files = await readdir(studentsDir);
    const fileName = files.find((name) => name.endsWith('.json'));
    expect(fileName).toBeTruthy();
    const fileContent = await readFile(path.join(studentsDir, fileName!), 'utf8');
    expect(fileContent).toContain('"student"');

    const deleted = await deleteStudentProfile(created.id, { studentsDir });
    expect(deleted).toBe(true);

    const loaded = await getStudentProfileById(created.id, { studentsDir });
    expect(loaded).toBeNull();
  });

  it('rejects student name changes that would alter the derived ID', async () => {
    const studentsDir = await createStudentsDir();
    await writeFile(
      path.join(studentsDir, 'bob.json'),
      JSON.stringify({ student: 'Bob' }),
      'utf8',
    );

    const id = deriveStudentId('Bob');
    await expect(
      updateStudentProfile(id, { student: 'Bobby' }, { studentsDir }),
    ).rejects.toThrow(StudentProfileStoreError);
  });

  it('treats remote config providers as read-only', async () => {
    const studentsDir = await createStudentsDir();
    const config = loadConfig();
    const readOnlyConfig = {
      ...config,
      orchestrator: { ...config.orchestrator, configProvider: 'http' as const },
    };

    await expect(
      createStudentProfile({ student: 'Read Only' }, { studentsDir, config: readOnlyConfig }),
    ).rejects.toThrow(StudentProfileStoreError);
  });
});
