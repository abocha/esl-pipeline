import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  StudentProfileStoreError,
  createStudentProfile,
  deleteStudentProfile,
  getStudentProfileById,
  listStudentProfiles,
  updateStudentProfile,
} from '../src/application/student-profiles-store.js';
import { loadConfig } from '../src/config/env.js';
import { deriveStudentId } from '../src/domain/student-utils.js';

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
    await writeFile(path.join(studentsDir, 'bob.json'), JSON.stringify({ student: 'Bob' }), 'utf8');

    const id = deriveStudentId('Bob');
    await expect(updateStudentProfile(id, { student: 'Bobby' }, { studentsDir })).rejects.toThrow(
      StudentProfileStoreError,
    );
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

  it('rejects malformed profileId values on create and update', async () => {
    const studentsDir = await createStudentsDir();

    await expect(
      createStudentProfile(
        {
          student: 'Invalid Profile',
          profileId: '../outside.md',
        },
        { studentsDir },
      ),
    ).rejects.toThrow(StudentProfileStoreError);

    const created = await createStudentProfile(
      {
        student: 'Valid Profile',
        profileId: 'profiles/default.md',
      },
      { studentsDir },
    );
    expect(created.profileId).toBe('profiles/default.md');

    await expect(
      updateStudentProfile(
        created.id,
        {
          profileId: 'profile-without-extension',
        },
        { studentsDir },
      ),
    ).rejects.toThrow(StudentProfileStoreError);
  });

  it('threads binding actor and reason metadata on DB-backed create', async () => {
    const dbConfig = {
      ...loadConfig(),
      studentSystem: {
        source: 'db' as const,
        fsFallback: false,
      },
    };
    const changedBy = 'user-123';
    const reason = 'student_create_manual';
    const setActiveCalls: { changedBy?: string | null; reason?: string | null }[] = [];

    const created = await createStudentProfile(
      {
        student: 'Audit Student',
        profileId: 'profiles/audit.md',
      },
      {
        config: dbConfig,
        bindingAudit: {
          changedBy,
          reason,
        },
        deps: {
          students: {
            list: async () => ({ items: [], total: 0, limit: 50, offset: 0, order: 'asc' }),
            getById: async () => null,
            insert: async (params) => ({
              id: params.id ?? deriveStudentId(params.student),
              student: params.student,
              dbId: params.dbId ?? null,
              pageParentId: params.pageParentId ?? null,
              colorPreset: params.colorPreset ?? null,
              voices: params.voices ?? {},
              manifestPreset: params.manifestPreset ?? null,
              accentPreference: params.accentPreference ?? null,
              profileId: params.profileId ?? null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
            upsert: async () => {
              throw new Error('upsert should not be called for create');
            },
            remove: async () => false,
          },
          profiles: {
            upsert: async () => ({
              id: 'profiles/audit.md',
              label: 'audit',
              activeRevisionId: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
          },
          bindings: {
            setActive: async (params) => {
              setActiveCalls.push({ changedBy: params.changedBy, reason: params.reason });
              return {
                id: 'binding-1',
                studentId: params.studentId,
                profileId: params.profileId,
                effectiveFrom: params.effectiveFrom ?? new Date('2026-01-01T00:00:00.000Z'),
                effectiveTo: null,
                reason: params.reason ?? null,
                changedBy: params.changedBy ?? null,
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
              };
            },
            clearActive: async () => {},
          },
        },
      },
    );

    expect(created.id).toBe(deriveStudentId('Audit Student'));
    expect(setActiveCalls).toEqual([{ changedBy, reason }]);
  });

  it('threads binding actor and reason metadata on DB-backed unbind', async () => {
    const dbConfig = {
      ...loadConfig(),
      studentSystem: {
        source: 'db' as const,
        fsFallback: false,
      },
    };
    const studentId = deriveStudentId('Unbind Student');
    const changedBy = 'user-999';
    const reason = 'student_unbind_manual';
    const clearActiveCalls: {
      studentId: string;
      options: {
        reason?: string | null;
        changedBy?: string | null;
      };
    }[] = [];

    const updated = await updateStudentProfile(
      studentId,
      {
        profileId: null,
      },
      {
        config: dbConfig,
        bindingAudit: {
          changedBy,
          reason,
        },
        deps: {
          students: {
            list: async () => ({ items: [], total: 0, limit: 50, offset: 0, order: 'asc' }),
            getById: async () => ({
              id: studentId,
              student: 'Unbind Student',
              dbId: null,
              pageParentId: null,
              colorPreset: null,
              voices: {},
              manifestPreset: null,
              accentPreference: null,
              profileId: 'profiles/original.md',
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
            insert: async () => {
              throw new Error('insert should not be called for update');
            },
            upsert: async (params) => ({
              id: params.id ?? studentId,
              student: params.student ?? 'Unbind Student',
              dbId: params.dbId ?? null,
              pageParentId: params.pageParentId ?? null,
              colorPreset: params.colorPreset ?? null,
              voices: params.voices ?? {},
              manifestPreset: params.manifestPreset ?? null,
              accentPreference: params.accentPreference ?? null,
              profileId: params.profileId ?? null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
            remove: async () => false,
          },
          profiles: {
            upsert: async () => ({
              id: 'profiles/original.md',
              label: 'original',
              activeRevisionId: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
          },
          bindings: {
            setActive: async () => {
              throw new Error('setActive should not be called on unbind');
            },
            clearActive: async (inputStudentId, options) => {
              const normalized =
                options instanceof Date
                  ? { reason: null, changedBy: null }
                  : {
                      reason: options?.reason ?? null,
                      changedBy: options?.changedBy ?? null,
                    };
              clearActiveCalls.push({
                studentId: inputStudentId,
                options: normalized,
              });
            },
          },
        },
      },
    );

    expect(updated?.profileId ?? null).toBeNull();
    expect(clearActiveCalls).toEqual([
      {
        studentId,
        options: {
          reason,
          changedBy,
        },
      },
    ]);
  });
});
