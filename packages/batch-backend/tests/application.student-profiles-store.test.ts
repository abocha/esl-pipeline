import { describe, expect, it, vi } from 'vitest';

import {
  archiveStudentProfile,
  createStudentProfile,
  getStudentProfileById,
  listStudentProfiles,
  restoreStudentProfile,
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
    archivedAt: overrides.archivedAt ?? null,
    archivedBy: overrides.archivedBy ?? null,
    archiveReason: overrides.archiveReason ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

function createInMemoryDeps(initial: StudentRecord[] = []) {
  const store = new Map<string, StudentRecord>(initial.map((record) => [record.id, record]));

  return {
    students: {
      list: async (params?: {
        limit?: number;
        offset?: number;
        order?: 'asc' | 'desc';
        status?: 'active' | 'archived' | 'all';
      }) => {
        const order = params?.order ?? 'asc';
        const status = params?.status ?? 'active';
        const filtered = [...store.values()].filter((record) => {
          if (status === 'all') return true;
          if (status === 'archived') return Boolean(record.archivedAt);
          return !record.archivedAt;
        });
        const sorted = filtered.sort((a, b) =>
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
      getById: async (id: string, params?: { includeArchived?: boolean }) => {
        const record = store.get(id) ?? null;
        if (!record) return null;
        if (!params?.includeArchived && record.archivedAt) return null;
        return record;
      },
      insert: async (params: {
        id?: string;
        student: string;
        dbId?: string | null;
        pageParentId?: string | null;
        colorPreset?: string | null;
        voices?: Record<string, string>;
        manifestPreset?: string | null;
        accentPreference?: string | null;
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
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        store.set(id, record);
        return record;
      },
      remove: async (id: string) => store.delete(id),
      archive: async ({
        id,
        archivedBy,
        archiveReason,
      }: {
        id: string;
        archivedBy?: string | null;
        archiveReason?: string | null;
      }) => {
        const existing = store.get(id);
        if (!existing) return null;
        const archived = makeRecord({
          ...existing,
          archivedAt: existing.archivedAt ?? new Date('2026-01-03T00:00:00.000Z'),
          archivedBy: archivedBy ?? null,
          archiveReason: archiveReason ?? null,
          updatedAt: new Date('2026-01-03T00:00:00.000Z'),
        });
        store.set(id, archived);
        return archived;
      },
      restore: async (id: string) => {
        const existing = store.get(id);
        if (!existing) return null;
        const restored = makeRecord({
          ...existing,
          archivedAt: null,
          archivedBy: null,
          archiveReason: null,
          updatedAt: new Date('2026-01-04T00:00:00.000Z'),
        });
        store.set(id, restored);
        return restored;
      },
    },
    revisions: {
      saveRevision: async (
        studentId: string,
        content: string,
        options?: {
          source?: string;
          status?: 'draft' | 'active' | 'deprecated';
          createdBy?: string | null;
        },
      ) => {
        return {
          id: `${studentId}-revision-1`,
          studentId,
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

    expect(created).not.toHaveProperty('profileId');

    const listed = await listStudentProfiles({ limit: 50 }, { deps });
    expect(listed.items.some((item) => item.id === created.id)).toBe(true);
  });

  it('creates student-owned structured starter history', async () => {
    const deps = createInMemoryDeps();
    const saveRevisionCalls: {
      studentId: string;
      content: string;
      options?: {
        source?: string;
        status?: 'draft' | 'active' | 'deprecated';
        createdBy?: string | null;
        structuredContent?: unknown;
      };
    }[] = [];
    const originalSaveRevision = deps.revisions.saveRevision;
    deps.revisions.saveRevision = async (studentId, content, options) => {
      saveRevisionCalls.push({ studentId, content, options });
      return originalSaveRevision(studentId, content, options);
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

    expect(created).not.toHaveProperty('profileId');

    const loaded = await getStudentProfileById(created.id, { deps });
    expect(loaded).not.toHaveProperty('profileId');
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

  it('creates a starter profile revision from partial canonical foundational fields', async () => {
    const deps = createInMemoryDeps();
    const saveRevisionCalls: {
      studentId: string;
      content: string;
      options?: {
        source?: string;
        status?: 'draft' | 'active' | 'deprecated';
        createdBy?: string | null;
        structuredContent?: unknown;
      };
    }[] = [];
    const originalSaveRevision = deps.revisions.saveRevision;
    deps.revisions.saveRevision = async (studentId, content, options) => {
      saveRevisionCalls.push({ studentId, content, options });
      return originalSaveRevision(studentId, content, options);
    };

    const created = await createStudentProfile(
      {
        student: 'Canonical Starter',
        starterProfile: {
          overallLevel: 'B1',
          stableStrengths: 'Prepared and curious.',
          durableConstraints: 'Mostly studies on mobile.',
        },
      },
      { deps },
    );

    expect(created).not.toHaveProperty('profileId');
    expect(saveRevisionCalls).toHaveLength(1);
    expect(saveRevisionCalls[0]?.options?.structuredContent).toEqual({
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: [],
      communicationContexts: [],
      interestsAndUsefulThemes: [],
      stableStrengths: ['Prepared and curious.'],
      persistentChallenges: [],
      studyPreferences: [],
      durableConstraints: ['Mostly studies on mobile.'],
      teacherNotes: null,
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
      },
      { config, deps },
    );

    expect(created.id).toBe(deriveStudentId('Remote Mode Write'));
    const listed = await listStudentProfiles({ limit: 50 }, { config, deps });
    expect(listed.items.some((item) => item.id === created.id)).toBe(true);
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

  it('rolls back student creation when its starter revision cannot be persisted', async () => {
    const deps = createInMemoryDeps();
    deps.revisions.saveRevision = async () => {
      throw new Error('revision write failed');
    };
    await expect(
      createStudentProfile(
        { student: 'Rollback Student', starterProfile: { goals: 'Goal' } },
        { deps },
      ),
    ).rejects.toThrow('revision write failed');
    expect(await getStudentProfileById(deriveStudentId('Rollback Student'), { deps })).toBeNull();
  });

  it('preserves student-owned history across archive and restore and records the starter creator', async () => {
    const deps = createInMemoryDeps();
    const saveRevision = vi.spyOn(deps.revisions, 'saveRevision');
    const created = await createStudentProfile(
      { student: 'Archive Student', starterProfile: { goals: 'Goal' } },
      { deps, audit: { changedBy: 'tutor' } },
    );
    expect(saveRevision).toHaveBeenCalledWith(
      created.id,
      expect.any(String),
      expect.objectContaining({
        createdBy: 'tutor',
        status: 'active',
        source: 'starter_profile_form',
      }),
    );
    await archiveStudentProfile(
      created.id,
      { archivedBy: 'tutor', archiveReason: 'Paused lessons' },
      { deps },
    );
    expect(await getStudentProfileById(created.id, { deps })).toBeNull();
    const archived = await listStudentProfiles({ status: 'archived' }, { deps });
    expect(archived.items[0]).toMatchObject({
      id: created.id,
      archivedBy: 'tutor',
      archiveReason: 'Paused lessons',
    });
    expect(await restoreStudentProfile(created.id, {}, { deps })).toMatchObject({
      id: created.id,
      archivedAt: null,
    });
    expect(await getStudentProfileById(created.id, { deps })).toMatchObject({ id: created.id });
    expect(saveRevision).toHaveBeenCalledTimes(1);
  });
});
