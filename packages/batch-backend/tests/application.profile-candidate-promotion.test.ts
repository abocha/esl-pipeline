import { describe, expect, it, vi } from 'vitest';

import {
  ProfileCandidatePromotionError,
  promoteStudentProfileCandidates,
} from '../src/application/profile-candidate-promotion.js';
import { loadConfig } from '../src/config/env.js';
import type { StudentProfileCandidateRecord } from '../src/domain/student-profile-candidate-model.js';

function makeCandidate(
  overrides: Partial<StudentProfileCandidateRecord> & Pick<StudentProfileCandidateRecord, 'id'>,
): StudentProfileCandidateRecord {
  const now = new Date('2026-03-22T00:00:00.000Z');
  return {
    id: overrides.id,
    studentId: overrides.studentId ?? 'tolik',
    targetSection: overrides.targetSection ?? 'interests_personal_context',
    candidateKey: overrides.candidateKey ?? `${overrides.id}-key`,
    fact: overrides.fact ?? 'Fact',
    approvedFact: overrides.approvedFact ?? null,
    category: overrides.category ?? 'interest',
    authority: overrides.authority ?? 'student_stated',
    confidence: overrides.confidence ?? 'high',
    reviewNeeded: overrides.reviewNeeded ?? false,
    sourceSnapshotId: overrides.sourceSnapshotId ?? 'snapshot-1',
    sourceLessonMemoryIds: overrides.sourceLessonMemoryIds ?? ['lesson-1'],
    evidence: overrides.evidence ?? [],
    status: overrides.status ?? 'approved',
    reviewState: overrides.reviewState ?? 'approved',
    reviewerId: overrides.reviewerId ?? 'teacher-1',
    reviewerNote: overrides.reviewerNote ?? null,
    reviewedAt: overrides.reviewedAt ?? now,
    promotedRevisionId: overrides.promotedRevisionId ?? null,
    promotedAt: overrides.promotedAt ?? null,
    supersededById: overrides.supersededById ?? null,
    supersededAt: overrides.supersededAt ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
  };
}

describe('application/profile-candidate-promotion', () => {
  it.each([
    { decision: { operation: 'no_change', candidateIds: [] }, code: 'profile_candidate_no_change' },
    {
      decision: { operation: 'apply', candidateIds: ['unselected'] },
      code: 'profile_candidate_patch_invalid',
    },
    {
      decision: { operation: 'apply', candidateIds: ['candidate-1', 'candidate-1'] },
      code: 'profile_candidate_patch_invalid',
    },
  ] as const)('does not save or link a rejected decision ($code)', async ({ decision, code }) => {
    const saveRevision = vi.fn();
    const linkToDraft = vi.fn();
    await expect(
      promoteStudentProfileCandidates({
        request: { studentId: 'tolik', candidateIds: ['candidate-1'] },
        overrides: {
          config: loadConfig(),
          students: { getById: async () => ({ id: 'tolik', student: 'Tolik', voices: {} }) },
          revisions: { getActive: async () => null, getById: async () => null },
          candidates: {
            listByIds: async () => [makeCandidate({ id: 'candidate-1' })],
            linkToDraft,
          },
          drafting: {
            generate: async () => ({
              structuredProfile: { ...decision, candidateIds: [...decision.candidateIds] },
              rawOutput: decision,
              rawText: JSON.stringify(decision),
              provider: 'google_ai_studio',
              model: 'fixture',
            }),
          },
          profileContent: { saveRevision },
        },
      }),
    ).rejects.toMatchObject({ code });
    expect(saveRevision).not.toHaveBeenCalled();
    expect(linkToDraft).not.toHaveBeenCalled();
  });
  it('creates a structured draft revision from an explicit approved candidate subset', async () => {
    const structuredProfile = { operation: 'apply' as const, candidateIds: ['candidate-1'] };
    const linkToDraft = vi.fn().mockResolvedValue(undefined);
    const generate = vi.fn(async () => ({
      structuredProfile,
      rawOutput: structuredProfile,
      rawText: JSON.stringify(structuredProfile),
      provider: 'google_ai_studio' as const,
      model: 'gemini-3-flash-preview',
    }));
    const saveRevision = vi.fn(async () => ({
      id: 'revision-draft-1',
      studentId: 'tolik',
      contentHash: 'hash',
      source: 'candidate_promotion' as const,
      status: 'draft' as const,
      versionNumber: 3,
      versionLabel: 'v3',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: '2026-03-22T00:00:00.000Z',
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Foundational Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1' as const,
        overallLevel: null,
        primaryGoals: [],
        communicationContexts: [],
        interestsAndUsefulThemes: [
          'Plays pickleball regularly and enjoys practical sports examples.',
        ],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: 'Keep examples tied to real product launches.',
      },
    }));

    const result = await promoteStudentProfileCandidates({
      request: {
        studentId: 'tolik',
        reviewerId: 'teacher-1',
        candidateIds: ['candidate-1', 'candidate-2'],
      },
      overrides: {
        config: loadConfig(),
        students: {
          getById: async () => ({
            id: 'tolik',
            student: 'Tolik',
            voices: {},
          }),
        },
        revisions: {
          getActive: async () => ({
            id: 'revision-active-1',
            studentId: 'tolik',
            content: '# Existing profile',
            structuredContent: {
              schemaVersion: 'foundational_profile_v1',
              overallLevel: null,
              primaryGoals: [],
              communicationContexts: [],
              interestsAndUsefulThemes: [],
              stableStrengths: [],
              persistentChallenges: [],
              studyPreferences: [],
              durableConstraints: [],
              teacherNotes: 'Preserved teacher content. '.repeat(100),
            },
            contentHash: 'hash-1',
            source: 'starter_profile_form',
            status: 'active',
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: new Date('2026-01-01T00:00:00.000Z'),
            deprecatedAt: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            createdBy: 'teacher-1',
            restoredFromRevisionId: null,
          }),
          getById: async () => null,
        },
        candidates: {
          listByIds: async () => [
            makeCandidate({
              id: 'candidate-1',
              fact: 'Plays pickleball regularly.',
              approvedFact: 'Plays pickleball regularly and enjoys practical sports examples.',
              evidence: [{ quote: 'I play pickleball every week.', speakerRole: 'student' }],
            }),
            makeCandidate({ id: 'candidate-2', fact: 'Likes hiking.' }),
          ],
          linkToDraft,
        },
        drafting: {
          generate,
        },
        profileContent: {
          saveRevision,
        },
      },
    });

    expect(result.draftRevision.status).toBe('draft');
    expect(result.baseRevisionId).toBe('revision-active-1');
    expect(result.includedCandidateIds).toEqual(['candidate-1']);
    expect(linkToDraft).toHaveBeenCalledWith({
      studentId: 'tolik',
      candidateIds: ['candidate-1'],
      draftRevisionId: 'revision-draft-1',
    });
    expect(saveRevision).toHaveBeenCalledWith(
      'tolik',
      expect.stringContaining('# Foundational Profile'),
      expect.objectContaining({
        source: 'candidate_promotion',
        status: 'draft',
        createdBy: 'teacher-1',
        structuredContent: expect.objectContaining({
          schemaVersion: 'foundational_profile_v1',
          interestsAndUsefulThemes: [
            'Plays pickleball regularly and enjoys practical sports examples.',
          ],
        }),
      }),
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          operation: 'candidate_promotion',
          maxOutputTokens: loadConfig().generation.maxOutputTokensHard,
          responseSchema: expect.objectContaining({
            name: 'profile_candidate_patch_v1',
            strict: true,
          }),
        }),
      }),
    );
  });

  it('rejects empty or non-approved candidate selections', async () => {
    await expect(
      promoteStudentProfileCandidates({
        request: {
          studentId: 'tolik',
          candidateIds: [],
        },
        overrides: {
          config: loadConfig(),
          candidates: {
            listByIds: async () => [],
            linkToDraft: async () => {},
          },
        },
      }),
    ).rejects.toBeInstanceOf(ProfileCandidatePromotionError);

    await expect(
      promoteStudentProfileCandidates({
        request: {
          studentId: 'tolik',
          candidateIds: ['candidate-1'],
        },
        overrides: {
          config: loadConfig(),
          students: {
            getById: async () => ({
              id: 'tolik',
              student: 'Tolik',
              voices: {},
            }),
          },
          revisions: {
            getActive: async () => ({
              id: 'revision-active-1',
              studentId: 'tolik',
              content: '# Existing profile',
              contentHash: 'hash-1',
              source: 'starter_profile_form',
              status: 'active',
              versionNumber: 1,
              versionLabel: 'v1',
              activatedAt: new Date('2026-01-01T00:00:00.000Z'),
              deprecatedAt: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              createdBy: 'teacher-1',
              restoredFromRevisionId: null,
            }),
            getById: async () => null,
          },
          candidates: {
            listByIds: async () => [
              makeCandidate({
                id: 'candidate-1',
                status: 'pending_review',
                reviewState: 'unreviewed',
              }),
            ],
            linkToDraft: async () => {},
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'profile_candidate_not_approved',
    });
  });

  it('rejects incomplete promotion drafts when the provider reports a non-complete finish reason', async () => {
    await expect(
      promoteStudentProfileCandidates({
        request: {
          studentId: 'tolik',
          reviewerId: 'teacher-1',
          candidateIds: ['candidate-1'],
        },
        overrides: {
          config: loadConfig(),
          students: {
            getById: async () => ({
              id: 'tolik',
              student: 'Tolik',
              voices: {},
            }),
          },
          revisions: {
            getActive: async () => ({
              id: 'revision-active-1',
              studentId: 'tolik',
              content: '# Existing profile\n\nLong enough to matter.',
              contentHash: 'hash-1',
              source: 'starter_profile_form',
              status: 'active',
              versionNumber: 1,
              versionLabel: 'v1',
              activatedAt: new Date('2026-01-01T00:00:00.000Z'),
              deprecatedAt: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              createdBy: 'teacher-1',
              restoredFromRevisionId: null,
            }),
            getById: async () => null,
          },
          candidates: {
            listByIds: async () => [makeCandidate({ id: 'candidate-1' })],
            linkToDraft: async () => {},
          },
          drafting: {
            generate: async () => ({
              structuredProfile: {
                schemaVersion: 'foundational_profile_v1',
                overallLevel: 'B1',
                primaryGoals: ['Lead project updates more confidently.'],
                communicationContexts: ['Weekly syncs'],
                interestsAndUsefulThemes: ['Travel'],
                stableStrengths: ['Prepared notes'],
                persistentChallenges: ['Spoken transitions'],
                studyPreferences: ['Short practical tasks'],
                durableConstraints: [],
                teacherNotes: null,
              },
              rawOutput: {},
              rawText: '# Draft profile',
              provider: 'google_ai_studio',
              model: 'gemini-3-flash-preview',
              finishReason: 'MAX_TOKENS',
            }),
          },
          profileContent: {
            saveRevision: vi.fn(),
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'profile_candidate_draft_incomplete',
    });
  });

  it('rejects a full-profile response that does not match the candidate decision schema', async () => {
    const saveRevision = vi.fn();

    await expect(
      promoteStudentProfileCandidates({
        request: {
          studentId: 'tolik',
          reviewerId: 'teacher-1',
          candidateIds: ['candidate-1'],
        },
        overrides: {
          config: loadConfig(),
          students: {
            getById: async () => ({
              id: 'tolik',
              student: 'Tolik',
              voices: {},
            }),
          },
          revisions: {
            getActive: async () => ({
              id: 'revision-active-1',
              studentId: 'tolik',
              content: '# Existing profile\n\n' + 'A'.repeat(2_000),
              contentHash: 'hash-1',
              source: 'starter_profile_form',
              status: 'active',
              versionNumber: 1,
              versionLabel: 'v1',
              activatedAt: new Date('2026-01-01T00:00:00.000Z'),
              deprecatedAt: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              createdBy: 'teacher-1',
              restoredFromRevisionId: null,
            }),
            getById: async () => null,
          },
          candidates: {
            listByIds: async () => [makeCandidate({ id: 'candidate-1' })],
            linkToDraft: async () => {},
          },
          drafting: {
            generate: async () => ({
              structuredProfile: {
                schemaVersion: 'foundational_profile_v1',
                overallLevel: 'B1',
                primaryGoals: ['Lead project updates more confidently.'],
                communicationContexts: ['Weekly syncs'],
                interestsAndUsefulThemes: ['Travel'],
                stableStrengths: ['Prepared notes'],
                persistentChallenges: ['Spoken transitions'],
                studyPreferences: ['Short practical tasks'],
                durableConstraints: [],
                teacherNotes: null,
              },
              rawOutput: {},
              rawText: '# Draft profile\n\nToo short',
              provider: 'google_ai_studio',
              model: 'gemini-3-flash-preview',
            }),
          },
          profileContent: {
            saveRevision,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'profile_candidate_patch_invalid',
    });

    expect(saveRevision).not.toHaveBeenCalled();
  });
});
