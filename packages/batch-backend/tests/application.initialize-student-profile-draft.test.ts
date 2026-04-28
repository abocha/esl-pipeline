import { describe, expect, it, vi } from 'vitest';

import { initializeStudentProfileDraft } from '../src/application/initialize-student-profile-draft.js';
import { loadConfig } from '../src/config/env.js';

describe('application/initialize-student-profile-draft', () => {
  it('creates and binds a blank canonical draft for an unbound student', async () => {
    const saveRevision = vi.fn(async () => ({
      id: 'revision-draft-1',
      profileId: 'profiles/students/tolik.md',
      contentHash: 'hash-1',
      source: 'create' as const,
      status: 'draft' as const,
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: '2026-04-22T00:00:00.000Z',
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Foundational Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1' as const,
        overallLevel: null,
        primaryGoals: [],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
    }));

    const result = await initializeStudentProfileDraft({
      request: {
        studentId: 'tolik',
        reviewerId: 'teacher-1',
      },
      overrides: {
        config: loadConfig(),
        students: {
          getById: async () => ({
            id: 'tolik',
            student: 'Tolik',
            profileId: null,
            voices: {},
          }),
          ensureCanonicalProfileBinding: async () => ({
            id: 'tolik',
            student: 'Tolik',
            profileId: 'profiles/students/tolik.md',
            voices: {},
          }),
        },
        revisions: {
          getActive: async () => null,
        },
        profileContent: {
          saveRevision,
        },
      },
    });

    expect(result.profileId).toBe('profiles/students/tolik.md');
    expect(result.draftRevision.status).toBe('draft');
    expect(saveRevision).toHaveBeenCalledWith(
      'profiles/students/tolik.md',
      expect.stringContaining('# Foundational Profile'),
      expect.objectContaining({
        source: 'create',
        status: 'draft',
        createdBy: 'teacher-1',
        structuredContent: expect.objectContaining({
          schemaVersion: 'foundational_profile_v1',
        }),
      }),
    );
  });
});
