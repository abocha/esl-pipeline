import { describe, expect, it } from 'vitest';

import type { FoundationalProfile } from '../src/application/foundational-profile.js';
import {
  activateProfileRevisionForStudent,
  getProfileContent,
  getProfileRevisionForStudent,
  listProfileRevisionsForStudent,
  restoreProfileRevision,
  saveProfileRevisionContent,
  upsertProfileContent,
} from '../src/application/profile-content.js';
import { renderStarterProfileContent } from '../src/application/starter-profile-content.js';
import type {
  ProfileRevisionRecord,
  ProfileRevisionSource,
} from '../src/domain/profile-revision-model.js';

function createInMemoryDependencies(seed?: {
  profiles?: { id: string; label: string; content: string }[];
}) {
  const profiles = new Map<string, { id: string }>();
  const revisions: ProfileRevisionRecord[] = [];

  const createRevision = (params: {
    studentId: string;
    content: string;
    structuredContent?: ProfileRevisionRecord['structuredContent'];
    contentHash: string;
    source: ProfileRevisionSource;
    status?: 'draft' | 'active' | 'deprecated';
    createdBy?: string | null;
    restoredFromRevisionId?: string | null;
  }): ProfileRevisionRecord => {
    const versionNumber =
      revisions.filter((revision) => revision.studentId === params.studentId).length + 1;
    return {
      id: `revision-${params.studentId}-${versionNumber}`,
      studentId: params.studentId,
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
        studentId: profile.id,
        content: profile.content,
        contentHash,
        source: 'create',
      });
      revisions.push(revision);
      profiles.set(profile.id, { id: profile.id });
    }
  }

  const getLatestRevisionByHash = (
    studentId: string,
    contentHash: string,
  ): ProfileRevisionRecord | null => {
    for (let index = revisions.length - 1; index >= 0; index -= 1) {
      const revision = revisions[index];
      if (revision && revision.studentId === studentId && revision.contentHash === contentHash) {
        return revision;
      }
    }
    return null;
  };

  return {
    students: {
      getById: async (id: string) =>
        profiles.has(id)
          ? {
              id,
              student: id,
              dbId: null,
              pageParentId: null,
              colorPreset: null,
              voices: {},
              manifestPreset: null,
              accentPreference: null,
              archivedAt: null,
              archivedBy: null,
              archiveReason: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null,
    },
    candidates: {
      markPromotedByRevision: async (_revisionId: string) => {},
      copyDraftLinks: async (_params: { sourceRevisionId: string; targetRevisionId: string }) => {},
    },
    revisions: {
      getActive: async (studentId: string) =>
        revisions.find((r) => r.studentId === studentId && r.status === 'active') ?? null,
      getLatestByHash: async (studentId: string, contentHash: string) =>
        getLatestRevisionByHash(studentId, contentHash),
      insert: async ({
        studentId,
        content,
        structuredContent,
        contentHash,
        source,
        status,
        createdBy,
        restoredFromRevisionId,
      }: {
        studentId: string;
        content: string;
        structuredContent?: ProfileRevisionRecord['structuredContent'];
        contentHash: string;
        source?: ProfileRevisionSource;
        status?: 'draft' | 'active' | 'deprecated';
        createdBy?: string | null;
        restoredFromRevisionId?: string | null;
      }) => {
        const revision = createRevision({
          studentId,
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
            if (current.studentId === studentId && current.status === 'active') {
              current.status = 'deprecated';
              current.activatedAt = null;
              current.deprecatedAt = new Date('2026-01-01T00:00:00.000Z');
            }
          }
        }
        revisions.push(revision);
        return revision;
      },
      activate: async (studentId: string, revisionId: string) => {
        const target = revisions.find(
          (revision) => revision.studentId === studentId && revision.id === revisionId,
        );
        if (!target) return null;
        for (const current of revisions) {
          if (current.studentId !== studentId) continue;
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
      deprecateActive: async (studentId: string) => {
        let count = 0;
        for (const current of revisions) {
          if (current.studentId !== studentId || current.status !== 'active') continue;
          current.status = 'deprecated';
          current.activatedAt = null;
          current.deprecatedAt = new Date('2026-01-01T00:00:00.000Z');
          count += 1;
        }
        return count;
      },
      list: async ({
        studentId,
        limit = 50,
        offset = 0,
        order = 'desc',
      }: {
        studentId: string;
        limit?: number;
        offset?: number;
        order?: 'asc' | 'desc';
      }) => {
        const filtered = revisions.filter((revision) => revision.studentId === studentId);
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
      getById: async (studentId: string, revisionId: string) =>
        revisions.find(
          (revision) => revision.studentId === studentId && revision.id === revisionId,
        ) ?? null,
    },
  };
}

describe('application/profile-content (DB-only)', () => {
  it('restores previous revisions and updates active content', async () => {
    const deps = createInMemoryDependencies({
      profiles: [{ id: 'default.md', label: 'Default Profile', content: 'Version 1' }],
    });

    await upsertProfileContent('default.md', 'Version 2', deps);

    const revisions = await listProfileRevisionsForStudent('default.md', { order: 'asc' }, deps);
    const firstRevisionId = revisions?.items[0]?.id;
    expect(firstRevisionId).toBeTruthy();
    if (!firstRevisionId) throw new Error('Expected a first revision id');

    const detail = await getProfileRevisionForStudent('default.md', firstRevisionId, deps);
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

    const revisions = await listProfileRevisionsForStudent('default.md', { order: 'desc' }, deps);
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

    const detail = await getProfileRevisionForStudent('default.md', draft.id, deps);
    expect(detail?.structuredContent).toEqual(structuredContent);

    await activateProfileRevisionForStudent('default.md', draft.id, deps);
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

    const revisions = await listProfileRevisionsForStudent('legacy.md', { order: 'desc' }, deps);
    const revisionId = revisions?.items[0]?.id;
    expect(revisionId).toBeTruthy();
    if (!revisionId) throw new Error('Expected a legacy revision id');

    const detail = await getProfileRevisionForStudent('legacy.md', revisionId, deps);
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

    const activated = await activateProfileRevisionForStudent('default.md', draft.id, deps);

    expect(activated?.status).toBe('active');
    expect(promotions).toEqual([draft.id]);
  });

  it('marks linked approved candidates as promoted when a profile-refresh revision is activated', async () => {
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
      'Version 2 refresh draft',
      {
        source: 'profile_revision_refresh',
        status: 'draft',
        createdBy: 'teacher-1',
      },
      deps,
    );

    const activated = await activateProfileRevisionForStudent('default.md', draft.id, deps);

    expect(activated?.status).toBe('active');
    expect(promotions).toEqual([draft.id]);
  });

  it('carries candidate links forward when saving manual edits to a generated draft', async () => {
    const deps = createInMemoryDependencies({
      profiles: [{ id: 'default.md', label: 'Default Profile', content: 'Version 1' }],
    });
    const copiedLinks: { sourceRevisionId: string; targetRevisionId: string }[] = [];
    (
      deps.candidates as typeof deps.candidates & {
        copyDraftLinks: (params: {
          sourceRevisionId: string;
          targetRevisionId: string;
        }) => Promise<void>;
      }
    ).copyDraftLinks = async (params) => {
      copiedLinks.push(params);
    };

    const generatedDraft = await saveProfileRevisionContent(
      'default.md',
      'Generated draft from approved candidates',
      {
        source: 'profile_revision_refresh',
        status: 'draft',
        createdBy: 'teacher-1',
      },
      deps,
    );

    const manualDraft = await saveProfileRevisionContent(
      'default.md',
      'Teacher-edited generated draft',
      {
        source: 'update',
        status: 'draft',
        createdBy: 'teacher-1',
        inheritCandidateLinksFromRevisionId: generatedDraft.id,
      } as never,
      deps as never,
    );

    expect(copiedLinks).toEqual([
      {
        sourceRevisionId: generatedDraft.id,
        targetRevisionId: manualDraft.id,
      },
    ]);
  });
});
