import { describe, expect, it } from 'vitest';

import {
  activateProfileRevisionForProfile,
  deleteProfileContent,
  getProfileContent,
  getProfileRevisionForProfile,
  listProfileContents,
  listProfileRevisionsForProfile,
  restoreProfileRevision,
  saveProfileRevisionContent,
  upsertProfileContent,
} from '../src/application/profile-content.js';
import type { FoundationalProfile } from '../src/application/foundational-profile.js';
import { renderStarterProfileContent } from '../src/application/starter-profile-content.js';
import type { ProfileRecord } from '../src/domain/profile-model.js';
import type { ProfileRevisionRecord } from '../src/domain/profile-revision-model.js';

function createInMemoryDependencies(seed?: {
  profiles?: { id: string; label: string; content: string }[];
}) {
  const profiles = new Map<string, ProfileRecord>();
  const revisions: ProfileRevisionRecord[] = [];

  const createRevision = (params: {
    profileId: string;
    content: string;
    structuredContent?: ProfileRevisionRecord['structuredContent'];
    contentHash: string;
    source:
      | 'create'
      | 'update'
      | 'restore'
      | 'starter_profile_form'
      | 'candidate_promotion'
      | 'legacy_normalization';
    status?: 'draft' | 'active' | 'deprecated';
    createdBy?: string | null;
    restoredFromRevisionId?: string | null;
  }): ProfileRevisionRecord => {
    const versionNumber =
      revisions.filter((revision) => revision.profileId === params.profileId).length + 1;
    return {
      id: `revision-${params.profileId}-${versionNumber}`,
      profileId: params.profileId,
      content: params.content,
      structuredContent: params.structuredContent ?? null,
      contentHash: params.contentHash,
      source: params.source,
      status: params.status ?? 'active',
      versionNumber,
      versionLabel: `v${versionNumber}`,
      activatedAt:
        (params.status ?? 'active') === 'active' ? new Date('2026-01-01T00:00:00.000Z') : null,
      deprecatedAt:
        (params.status ?? 'active') === 'deprecated' ? new Date('2026-01-01T00:00:00.000Z') : null,
      createdAt: new Date(`2026-01-01T00:00:0${Math.min(versionNumber, 9)}.000Z`),
      createdBy: params.createdBy ?? null,
      restoredFromRevisionId: params.restoredFromRevisionId ?? null,
    };
  };

  if (seed?.profiles) {
    for (const profile of seed.profiles) {
      const contentHash = `hash-${profile.id}`;
      const revision = createRevision({
        profileId: profile.id,
        content: profile.content,
        contentHash,
        source: 'create',
      });
      revisions.push(revision);
      profiles.set(profile.id, {
        id: profile.id,
        label: profile.label,
        activeRevisionId: revision.id,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    }
  }

  const getLatestRevisionByHash = (
    profileId: string,
    contentHash: string,
  ): ProfileRevisionRecord | null => {
    for (let index = revisions.length - 1; index >= 0; index -= 1) {
      const revision = revisions[index];
      if (revision && revision.profileId === profileId && revision.contentHash === contentHash) {
        return revision;
      }
    }
    return null;
  };

  return {
    profiles: {
      list: async (
        params: { search?: string; limit?: number; offset?: number; order?: 'asc' | 'desc' } = {},
      ) => {
        const { limit = 500, offset = 0, order = 'asc' } = params;
        const sorted = [...profiles.values()].sort((a, b) =>
          order === 'asc' ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label),
        );
        return {
          items: sorted.slice(offset, offset + limit),
          total: sorted.length,
          limit,
          offset,
          order,
        };
      },
      getById: async (id: string) => profiles.get(id) ?? null,
      upsert: async ({
        id,
        label,
        activeRevisionId,
      }: {
        id: string;
        label: string;
        activeRevisionId?: string | null;
      }): Promise<ProfileRecord> => {
        const existing = profiles.get(id);
        const next: ProfileRecord = {
          id,
          label,
          activeRevisionId: activeRevisionId ?? existing?.activeRevisionId ?? null,
          createdAt: existing?.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        profiles.set(id, next);
        return next;
      },
      setActive: async (
        profileId: string,
        revisionId: string | null,
      ): Promise<ProfileRecord | null> => {
        const existing = profiles.get(profileId);
        if (!existing) return null;
        const next = {
          ...existing,
          activeRevisionId: revisionId,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        profiles.set(profileId, next);
        return next;
      },
    },
    candidates: {
      markPromotedByRevision: async (_revisionId: string) => {},
    },
    revisions: {
      getLatestByHash: async (profileId: string, contentHash: string) =>
        getLatestRevisionByHash(profileId, contentHash),
      insert: async ({
        profileId,
        content,
        structuredContent,
        contentHash,
        source,
        status,
        createdBy,
        restoredFromRevisionId,
      }: {
        profileId: string;
        content: string;
        structuredContent?: ProfileRevisionRecord['structuredContent'];
        contentHash: string;
        source?:
          | 'create'
          | 'update'
          | 'restore'
          | 'starter_profile_form'
          | 'candidate_promotion'
          | 'legacy_normalization';
        status?: 'draft' | 'active' | 'deprecated';
        createdBy?: string | null;
        restoredFromRevisionId?: string | null;
      }) => {
        const revision = createRevision({
          profileId,
          content,
          structuredContent,
          contentHash,
          source: source ?? 'update',
          status,
          createdBy,
          restoredFromRevisionId,
        });
        if ((status ?? 'active') === 'active') {
          for (const current of revisions) {
            if (current.profileId === profileId && current.status === 'active') {
              current.status = 'deprecated';
              current.activatedAt = null;
              current.deprecatedAt = new Date('2026-01-01T00:00:00.000Z');
            }
          }
        }
        revisions.push(revision);
        return revision;
      },
      activate: async (profileId: string, revisionId: string) => {
        const target = revisions.find(
          (revision) => revision.profileId === profileId && revision.id === revisionId,
        );
        if (!target) return null;
        for (const current of revisions) {
          if (current.profileId !== profileId) continue;
          if (current.id === revisionId) {
            current.status = 'active';
            current.activatedAt = new Date('2026-01-01T00:00:00.000Z');
            current.deprecatedAt = null;
          } else if (current.status === 'active') {
            current.status = 'deprecated';
            current.activatedAt = null;
            current.deprecatedAt = new Date('2026-01-01T00:00:00.000Z');
          }
        }
        return target;
      },
      deprecateActive: async (profileId: string) => {
        let count = 0;
        for (const current of revisions) {
          if (current.profileId !== profileId || current.status !== 'active') continue;
          current.status = 'deprecated';
          current.activatedAt = null;
          current.deprecatedAt = new Date('2026-01-01T00:00:00.000Z');
          count += 1;
        }
        return count;
      },
      list: async ({
        profileId,
        limit = 50,
        offset = 0,
        order = 'desc',
      }: {
        profileId: string;
        limit?: number;
        offset?: number;
        order?: 'asc' | 'desc';
      }) => {
        const filtered = revisions.filter((revision) => revision.profileId === profileId);
        const sorted = [...filtered].sort((a, b) =>
          order === 'asc'
            ? a.createdAt.getTime() - b.createdAt.getTime()
            : b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return {
          items: sorted.slice(offset, offset + limit),
          total: filtered.length,
          limit,
          offset,
          order,
        };
      },
      getById: async (profileId: string, revisionId: string) =>
        revisions.find(
          (revision) => revision.profileId === profileId && revision.id === revisionId,
        ) ?? null,
    },
  };
}

describe('application/profile-content (DB-only)', () => {
  it('lists active profiles and reads active revision content', async () => {
    const deps = createInMemoryDependencies({
      profiles: [
        { id: 'default.md', label: 'Default Profile', content: 'Default profile content' },
      ],
    });

    const list = await listProfileContents(deps);
    expect(list.profiles).toEqual([{ id: 'default.md', label: 'Default Profile' }]);

    const content = await getProfileContent('default.md', deps);
    expect(content?.content).toBe('Default profile content');
    expect(content?.currentRevisionId).toBeTruthy();
  });

  it('paginates profile option listing beyond 500 active records', async () => {
    const deps = createInMemoryDependencies({
      profiles: Array.from({ length: 550 }, (_, index) => ({
        id: `profile-${index}.md`,
        label: `Profile ${index}`,
        content: `Profile content ${index}`,
      })),
    });

    const listCalls: { limit?: number; offset?: number; order?: 'asc' | 'desc' }[] = [];
    const originalList = deps.profiles.list;
    deps.profiles.list = async (
      params: { search?: string; limit?: number; offset?: number; order?: 'asc' | 'desc' } = {},
    ) => {
      listCalls.push(params);
      return originalList(params);
    };

    const list = await listProfileContents(deps);
    expect(list.profiles).toHaveLength(550);
    expect(list.profiles.some((profile) => profile.id === 'profile-549.md')).toBe(true);
    expect(listCalls.length).toBeGreaterThan(1);
    expect(listCalls[0]).toMatchObject({ limit: 500, offset: 0, order: 'asc' });
    expect(listCalls[1]).toMatchObject({ limit: 500, offset: 500, order: 'asc' });
  });

  it('archives profiles on delete and preserves revisions', async () => {
    const deps = createInMemoryDependencies();

    const created = await upsertProfileContent('custom.md', 'Custom profile', deps);
    expect(created.currentRevisionId).toBeTruthy();

    const removed = await deleteProfileContent('custom.md', deps);
    expect(removed).toBe(true);

    const archived = await getProfileContent('custom.md', deps);
    expect(archived).toBeNull();

    const revisions = await listProfileRevisionsForProfile('custom.md', { order: 'desc' }, deps);
    expect(revisions?.total).toBe(1);
    expect(revisions?.items[0]?.status).toBe('deprecated');
  });

  it('restores previous revisions and updates active content', async () => {
    const deps = createInMemoryDependencies({
      profiles: [{ id: 'default.md', label: 'Default Profile', content: 'Version 1' }],
    });

    await upsertProfileContent('default.md', 'Version 2', deps);

    const revisions = await listProfileRevisionsForProfile('default.md', { order: 'asc' }, deps);
    const firstRevisionId = revisions?.items[0]?.id;
    expect(firstRevisionId).toBeTruthy();
    if (!firstRevisionId) throw new Error('Expected a first revision id');

    const detail = await getProfileRevisionForProfile('default.md', firstRevisionId, deps);
    expect(detail?.content).toBe('Version 1');

    const restored = await restoreProfileRevision('default.md', firstRevisionId, deps);
    expect(restored?.content).toBe('Version 1');

    const latest = await getProfileContent('default.md', deps);
    expect(latest?.content).toBe('Version 1');
  });

  it('creates draft revisions without changing the active revision', async () => {
    const deps = createInMemoryDependencies({
      profiles: [{ id: 'default.md', label: 'Default Profile', content: 'Version 1' }],
    });

    const draft = await saveProfileRevisionContent(
      'default.md',
      'Version 2 draft',
      {
        source: 'candidate_promotion',
        status: 'draft',
        createdBy: 'teacher-1',
      },
      deps,
    );

    expect(draft.status).toBe('draft');
    expect(draft.source).toBe('candidate_promotion');

    const active = await getProfileContent('default.md', deps);
    expect(active?.content).toBe('Version 1');

    const revisions = await listProfileRevisionsForProfile('default.md', { order: 'desc' }, deps);
    expect(revisions?.items[0]?.status).toBe('draft');
    expect(revisions?.items[1]?.status).toBe('active');
  });

  it('persists structured profile content alongside rendered profile text', async () => {
    const deps = createInMemoryDependencies({
      profiles: [{ id: 'default.md', label: 'Default Profile', content: 'Version 1' }],
    });
    const structuredContent: FoundationalProfile = {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Speak more confidently in meetings.'],
      communicationContexts: ['Client calls and internal status updates.'],
      interestsAndUsefulThemes: ['Travel'],
      stableStrengths: ['High motivation'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Prefers structured explanations'],
      durableConstraints: ['Short homework windows'],
      teacherNotes: 'Responds well to practical business scenarios.',
    };

    const draft = await saveProfileRevisionContent(
      'default.md',
      'Rendered profile text',
      {
        source: 'starter_profile_form',
        status: 'draft',
        structuredContent,
      },
      deps,
    );

    expect(draft.content).toBe('Rendered profile text');
    expect(draft.structuredContent).toEqual(structuredContent);

    const detail = await getProfileRevisionForProfile('default.md', draft.id, deps);
    expect(detail?.structuredContent).toEqual(structuredContent);

    await activateProfileRevisionForProfile('default.md', draft.id, deps);
    const active = await getProfileContent('default.md', deps);
    expect(active?.structuredContent).toEqual(structuredContent);
  });

  it('derives structured content from legacy starter-profile markdown when stored JSON is missing', async () => {
    const deps = createInMemoryDependencies({
      profiles: [
        {
          id: 'legacy.md',
          label: 'Legacy Profile',
          content: renderStarterProfileContent({
            studentName: 'Anna',
            starterProfile: {
              level: 'B1',
              goals: 'Speak more confidently in meetings.\nHandle follow-up questions clearly.',
              professionOrContext: 'Client calls\nInternal updates',
              interests: 'Travel\nFilms',
              longRunningChallenges: 'Article usage\nVerb tense control',
              studyPreferencesOrConstraints:
                'Prefers structured explanations\nShort homework windows',
              teacherNotes: 'Responds well to practical scenarios.',
            },
          }),
        },
      ],
    });

    const active = await getProfileContent('legacy.md', deps);
    expect(active?.structuredContent).toEqual({
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Speak more confidently in meetings.', 'Handle follow-up questions clearly.'],
      communicationContexts: ['Client calls', 'Internal updates'],
      interestsAndUsefulThemes: ['Travel', 'Films'],
      stableStrengths: [],
      persistentChallenges: ['Article usage', 'Verb tense control'],
      studyPreferences: ['Prefers structured explanations', 'Short homework windows'],
      durableConstraints: [],
      teacherNotes: 'Responds well to practical scenarios.',
    });

    const revisions = await listProfileRevisionsForProfile('legacy.md', { order: 'desc' }, deps);
    const revisionId = revisions?.items[0]?.id;
    expect(revisionId).toBeTruthy();
    if (!revisionId) throw new Error('Expected a legacy revision id');

    const detail = await getProfileRevisionForProfile('legacy.md', revisionId, deps);
    expect(detail?.structuredContent?.communicationContexts).toEqual([
      'Client calls',
      'Internal updates',
    ]);
  });

  it('marks linked approved candidates as promoted when a candidate-promotion revision is activated', async () => {
    const deps = createInMemoryDependencies({
      profiles: [{ id: 'default.md', label: 'Default Profile', content: 'Version 1' }],
    });
    const markPromotedByRevision = async (revisionId: string) => {
      promotions.push(revisionId);
    };
    const promotions: string[] = [];
    deps.candidates.markPromotedByRevision = markPromotedByRevision;

    const draft = await saveProfileRevisionContent(
      'default.md',
      'Version 2 draft',
      {
        source: 'candidate_promotion',
        status: 'draft',
        createdBy: 'teacher-1',
      },
      deps,
    );

    const activated = await activateProfileRevisionForProfile('default.md', draft.id, deps);

    expect(activated?.status).toBe('active');
    expect(promotions).toEqual([draft.id]);
  });
});
