import { describe, expect, it } from 'vitest';

import {
  createStudentProfile,
  deleteStudentProfile,
  getStudentProfileById,
  listStudentProfiles,
  StudentProfileStoreError,
  updateStudentProfile,
} from '../src/application/student-profiles-store.js';
import { loadConfig } from '../src/config/env.js';
import type { StudentRecord } from '../src/domain/student-model.js';
import { deriveStudentId } from '../src/domain/student-utils.js';

function makeRecord(
  overrides: Partial<StudentRecord> & Pick<StudentRecord, 'id' | 'student'>,
): StudentRecord {
  const now = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: overrides.id,
    student: overrides.student,
    dbId: overrides.dbId ?? null,
    pageParentId: overrides.pageParentId ?? null,
    colorPreset: overrides.colorPreset ?? null,
    voices: overrides.voices ?? {},
    manifestPreset: overrides.manifestPreset ?? null,
    accentPreference: overrides.accentPreference ?? null,
    profileId: overrides.profileId ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function createInMemoryDeps(initial: StudentRecord[] = []) {
  const store = new Map<string, StudentRecord>(initial.map((record) => [record.id, record]));
  const profiles = new Map<
    string,
    {
      id: string;
      label: string;
      activeRevisionId: string | null;
    }
  >();

  return {
    students: {
      list: async (params?: { limit?: number; offset?: number; order?: 'asc' | 'desc' }) => {
        const order = params?.order ?? 'asc';
        const sorted = [...store.values()].sort((a, b) =>
          order === 'asc' ? a.student.localeCompare(b.student) : b.student.localeCompare(a.student),
        );
        const offset = params?.offset ?? 0;
        const limit = params?.limit ?? sorted.length;
        return {
          items: sorted.slice(offset, offset + limit),
          total: sorted.length,
          limit,
          offset,
          order,
        };
      },
      getById: async (id: string) => store.get(id) ?? null,
      insert: async (params: {
        id?: string;
        student: string;
        dbId?: string | null;
        pageParentId?: string | null;
        colorPreset?: string | null;
        voices?: Record<string, string>;
        manifestPreset?: string | null;
        accentPreference?: string | null;
        profileId?: string | null;
      }) => {
        const id = params.id ?? deriveStudentId(params.student);
        if (store.has(id)) {
          const error = new Error('duplicate key value violates unique constraint') as Error & {
            code?: string;
          };
          error.code = '23505';
          throw error;
        }
        const record = makeRecord({
          id,
          student: params.student,
          dbId: params.dbId ?? null,
          pageParentId: params.pageParentId ?? null,
          colorPreset: params.colorPreset ?? null,
          voices: params.voices ?? {},
          manifestPreset: params.manifestPreset ?? null,
          accentPreference: params.accentPreference ?? null,
          profileId: params.profileId ?? null,
        });
        store.set(id, record);
        return record;
      },
      upsert: async (params: {
        id?: string;
        student: string;
        dbId?: string | null;
        pageParentId?: string | null;
        colorPreset?: string | null;
        voices?: Record<string, string>;
        manifestPreset?: string | null;
        accentPreference?: string | null;
        profileId?: string | null;
      }) => {
        const id = params.id ?? deriveStudentId(params.student);
        const existing = store.get(id);
        const now = new Date('2026-01-02T00:00:00.000Z');
        const record = makeRecord({
          id,
          student: params.student,
          dbId: params.dbId ?? null,
          pageParentId: params.pageParentId ?? null,
          colorPreset: params.colorPreset ?? null,
          voices: params.voices ?? {},
          manifestPreset: params.manifestPreset ?? null,
          accentPreference: params.accentPreference ?? null,
          profileId: params.profileId ?? null,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        store.set(id, record);
        return record;
      },
      remove: async (id: string) => store.delete(id),
    },
    profiles: {
      getById: async (id: string) => {
        const profile = profiles.get(id);
        return profile
          ? {
              ...profile,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }
          : null;
      },
      upsert: async ({
        id,
        label,
        activeRevisionId,
      }: {
        id: string;
        label: string;
        activeRevisionId?: string | null;
      }) => {
        const existing = profiles.get(id);
        const next = {
          id,
          label,
          activeRevisionId: activeRevisionId ?? existing?.activeRevisionId ?? null,
        };
        profiles.set(id, next);
        return {
          ...next,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
      },
      saveRevision: async (
        profileId: string,
        content: string,
        options?: {
          source?: string;
          status?: 'draft' | 'active' | 'deprecated';
          createdBy?: string | null;
        },
      ) => {
        const existing = profiles.get(profileId);
        profiles.set(profileId, {
          id: profileId,
          label: existing?.label ?? profileId,
          activeRevisionId:
            options?.status === 'active'
              ? `${profileId}-revision-1`
              : (existing?.activeRevisionId ?? null),
        });
        return {
          id: `${profileId}-revision-1`,
          profileId,
          contentHash: 'hash',
          source: (options?.source as 'create') ?? 'starter_profile_form',
          status: options?.status ?? 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: options?.status === 'active' ? '2026-01-01T00:00:00.000Z' : null,
          deprecatedAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          createdBy: options?.createdBy ?? null,
          restoredFromRevisionId: null,
          content,
        };
      },
    },
    bindings: {
      setActive: async () => ({
        id: 'binding-1',
        studentId: 'student-id',
        profileId: 'profiles/default.md',
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
        reason: null,
        changedBy: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
      clearActive: async () => {},
    },
  };
}

describe('student-profiles-store', () => {
  it('lists only DB-backed student profiles', async () => {
    const deps = createInMemoryDeps([
      makeRecord({ id: deriveStudentId('Anna'), student: 'Anna', dbId: 'db-1' }),
    ]);

    const result = await listStudentProfiles({ limit: 10 }, { deps });

    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(deriveStudentId('Anna'));
    expect(ids).not.toContain(deriveStudentId('Default'));
  });

  it('creates, updates, gets, and deletes a DB-backed student profile', async () => {
    const deps = createInMemoryDeps();

    const created = await createStudentProfile(
      {
        student: 'New Student',
        colorPreset: 'b1-default',
        profileId: 'profile.md',
        voices: {},
      },
      { deps },
    );
    expect(created.student).toBe('New Student');

    const loaded = await getStudentProfileById(created.id, { deps });
    expect(loaded?.student).toBe('New Student');

    const updated = await updateStudentProfile(created.id, { colorPreset: 'b2-default' }, { deps });
    expect(updated?.colorPreset).toBe('b2-default');

    const deleted = await deleteStudentProfile(created.id, { deps });
    expect(deleted).toBe(true);

    const missing = await getStudentProfileById(created.id, { deps });
    expect(missing).toBeNull();
  });

  it('creates an active starter profile revision when starterProfile is provided', async () => {
    const deps = createInMemoryDeps();

    const created = await createStudentProfile(
      {
        student: 'Starter Student',
        starterProfile: {
          goals: 'Speak more confidently in meetings.',
          professionOrContext: 'Works with clients in IT.',
          interests: 'Likes travel and films.',
          longRunningChallenges: 'Needs more tense stability.',
          studyPreferencesOrConstraints: 'Prefers structured explanations.',
        },
      },
      { deps },
    );

    expect(created.profileId).toBe(`profiles/students/${created.id}.md`);

    const listed = await listStudentProfiles({ limit: 50 }, { deps });
    expect(
      listed.items.some((item) => item.id === created.id && item.profileId === created.profileId),
    ).toBe(true);
  });

  it('creates a starter profile revision and derived profile binding when starterProfile is supplied', async () => {
    const deps = createInMemoryDeps();
    const saveRevisionCalls: Array<{
      profileId: string;
      content: string;
      options?: {
        source?: string;
        status?: 'draft' | 'active' | 'deprecated';
        createdBy?: string | null;
        structuredContent?: unknown;
      };
    }> = [];
    const originalSaveRevision = deps.profiles.saveRevision;
    deps.profiles.saveRevision = async (profileId, content, options) => {
      saveRevisionCalls.push({ profileId, content, options });
      return originalSaveRevision(profileId, content, options);
    };

    const created = await createStudentProfile(
      {
        student: 'Starter Student',
        starterProfile: {
          level: null,
          goals: 'Speak more confidently in client calls.',
          professionOrContext: 'Works as a product manager in IT.',
          interests: 'Pickleball and music production.',
          longRunningChallenges: 'Needs clearer tense control under pressure.',
          studyPreferencesOrConstraints: 'Prefers structured explanations and short review loops.',
          teacherNotes: 'Likes practical work scenarios.',
        },
      },
      { deps },
    );

    expect(created.profileId).toBe(`profiles/students/${created.id}.md`);

    const loaded = await getStudentProfileById(created.id, { deps });
    expect(loaded?.profileId).toBe(`profiles/students/${created.id}.md`);
    expect(saveRevisionCalls).toHaveLength(1);
    expect(saveRevisionCalls[0]?.options?.structuredContent).toEqual({
      schemaVersion: 'foundational_profile_v1',
      overallLevel: null,
      primaryGoals: ['Speak more confidently in client calls.'],
      communicationContexts: ['Works as a product manager in IT.'],
      interestsAndUsefulThemes: ['Pickleball and music production.'],
      stableStrengths: [],
      persistentChallenges: ['Needs clearer tense control under pressure.'],
      studyPreferences: ['Prefers structured explanations and short review loops.'],
      durableConstraints: [],
      teacherNotes: 'Likes practical work scenarios.',
    });
  });

  it('rejects starterProfile create requests that point at an already active profile', async () => {
    const deps = createInMemoryDeps();
    await deps.profiles.upsert({
      id: 'profiles/existing.md',
      label: 'Existing',
      activeRevisionId: 'revision-1',
    });

    await expect(
      createStudentProfile(
        {
          student: 'Starter Conflict',
          profileId: 'profiles/existing.md',
          starterProfile: {
            goals: 'Goal',
            professionOrContext: 'Context',
            interests: 'Interests',
            longRunningChallenges: 'Challenges',
            studyPreferencesOrConstraints: 'Preferences',
          },
        },
        { deps },
      ),
    ).rejects.toMatchObject({
      code: 'starter_profile_profile_conflict',
    });
  });

  it('rejects student name changes that would alter the derived ID', async () => {
    const id = deriveStudentId('Bob');
    const deps = createInMemoryDeps([makeRecord({ id, student: 'Bob' })]);

    await expect(updateStudentProfile(id, { student: 'Bobby' }, { deps })).rejects.toThrow(
      StudentProfileStoreError,
    );
  });

  it('allows DB reads/writes when ESL_PIPELINE_CONFIG_PROVIDER=http', async () => {
    const baseConfig = loadConfig();
    const config = {
      ...baseConfig,
      orchestrator: {
        ...baseConfig.orchestrator,
        configProvider: 'http' as const,
      },
    };
    const deps = createInMemoryDeps();

    const created = await createStudentProfile(
      {
        student: 'Remote Mode Write',
        profileId: 'profiles/remote.md',
      },
      { config, deps },
    );

    expect(created.id).toBe(deriveStudentId('Remote Mode Write'));
    const listed = await listStudentProfiles({ limit: 50 }, { config, deps });
    expect(listed.items.some((item) => item.id === created.id)).toBe(true);
  });

  it('rejects malformed profileId values on create and update', async () => {
    const deps = createInMemoryDeps();

    await expect(
      createStudentProfile(
        {
          student: 'Invalid Profile',
          profileId: '../outside.md',
        },
        { deps },
      ),
    ).rejects.toThrow(StudentProfileStoreError);

    const created = await createStudentProfile(
      {
        student: 'Valid Profile',
        profileId: 'profiles/default.md',
      },
      { deps },
    );
    expect(created.profileId).toBe('profiles/default.md');

    await expect(
      updateStudentProfile(
        created.id,
        {
          profileId: 'profile-without-extension',
        },
        { deps },
      ),
    ).rejects.toThrow(StudentProfileStoreError);
  });

  it('returns explicit db-required error when PG is disabled', async () => {
    const config = {
      ...loadConfig(),
      pg: {
        ...loadConfig().pg,
        enabled: false,
      },
    };

    await expect(listStudentProfiles({}, { config })).rejects.toMatchObject({
      code: 'student_profiles_db_required',
      status: 503,
    });
  });

  it('threads binding actor and reason metadata on DB-backed create', async () => {
    const changedBy = 'user-123';
    const reason = 'student_create_manual';
    const setActiveCalls: { changedBy?: string | null; reason?: string | null }[] = [];

    const created = await createStudentProfile(
      {
        student: 'Audit Student',
        profileId: 'profiles/audit.md',
      },
      {
        bindingAudit: {
          changedBy,
          reason,
        },
        deps: {
          students: {
            list: async () => ({ items: [], total: 0, limit: 50, offset: 0, order: 'asc' }),
            getById: async () => null,
            insert: async (params) =>
              makeRecord({
                id: params.id ?? deriveStudentId(params.student),
                student: params.student,
                dbId: params.dbId ?? null,
                pageParentId: params.pageParentId ?? null,
                colorPreset: params.colorPreset ?? null,
                voices: params.voices ?? {},
                manifestPreset: params.manifestPreset ?? null,
                accentPreference: params.accentPreference ?? null,
                profileId: params.profileId ?? null,
              }),
            upsert: async () => {
              throw new Error('upsert should not be called for create');
            },
            remove: async () => false,
          },
          profiles: {
            getById: async () => null,
            upsert: async () => ({
              id: 'profiles/audit.md',
              label: 'audit',
              activeRevisionId: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
            saveRevision: async () => {
              throw new Error('saveRevision should not be called without starterProfile');
            },
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
        bindingAudit: {
          changedBy,
          reason,
        },
        deps: {
          students: {
            list: async () => ({ items: [], total: 0, limit: 50, offset: 0, order: 'asc' }),
            getById: async () =>
              makeRecord({
                id: studentId,
                student: 'Unbind Student',
                profileId: 'profiles/original.md',
              }),
            insert: async () => {
              throw new Error('insert should not be called for update');
            },
            upsert: async (params) =>
              makeRecord({
                id: params.id ?? studentId,
                student: params.student ?? 'Unbind Student',
                dbId: params.dbId ?? null,
                pageParentId: params.pageParentId ?? null,
                colorPreset: params.colorPreset ?? null,
                voices: params.voices ?? {},
                manifestPreset: params.manifestPreset ?? null,
                accentPreference: params.accentPreference ?? null,
                profileId: params.profileId ?? null,
              }),
            remove: async () => false,
          },
          profiles: {
            getById: async () => null,
            upsert: async () => ({
              id: 'profiles/original.md',
              label: 'original',
              activeRevisionId: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
            saveRevision: async () => {
              throw new Error('saveRevision should not be called on unbind');
            },
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
