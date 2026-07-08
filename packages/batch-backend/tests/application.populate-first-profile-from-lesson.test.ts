import { describe, expect, it, vi } from 'vitest';

import {
  PopulateFirstProfileFromLessonError,
  populateFirstProfileFromLesson,
} from '../src/application/populate-first-profile-from-lesson.js';
import { loadConfig } from '../src/config/env.js';

function makeReadyLessonMemory() {
  return {
    id: 'lesson-1',
    studentId: 'tolik',
    transcriptId: 'transcript-1',
    recordingId: 'recording-1',
    schemaVersion: 'lesson-memory.v1',
    generatedAt: new Date('2026-03-20T00:00:00.000Z'),
    provider: 'openai',
    model: 'gpt-5.4-mini',
    status: 'ready' as const,
    sourceKind: 'lesson_transcript' as const,
    generationNotes: null,
    lessonSummary: 'Tolik practiced concise product updates.',
    topicsDiscussed: [],
    mistakePatterns: [],
    grammarReviewed: [],
    grammarWatchlist: [],
    vocabularyFocus: [],
    pronunciationFocus: [],
    studentFacts: [],
    progressSignals: [],
    followUpRecommendations: [],
    supersededById: null,
    supersededAt: null,
    createdAt: new Date('2026-03-20T00:00:00.000Z'),
    updatedAt: new Date('2026-03-20T00:00:00.000Z'),
  };
}

describe('application/populate-first-profile-from-lesson', () => {
  it('creates a structured draft revision from canonical lesson memory', async () => {
    const saveRevision = vi.fn(async () => ({
      id: 'revision-draft-1',
      profileId: 'profiles/students/tolik.md',
      contentHash: 'hash',
      source: 'lesson_population' as const,
      status: 'draft' as const,
      versionNumber: 2,
      versionLabel: 'v2',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: '2026-03-22T00:00:00.000Z',
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Foundational Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1' as const,
        overallLevel: 'B1',
        primaryGoals: ['Handle standups with less hesitation.'],
        communicationContexts: ['Daily standups with product and engineering.'],
        interestsAndUsefulThemes: ['Enjoys travel examples.'],
        stableStrengths: ['Strong listening comprehension.'],
        persistentChallenges: ['Needs cleaner past-tense control.'],
        studyPreferences: ['Prefers concise, practical homework.'],
        durableConstraints: [],
        teacherNotes: 'Keep follow-ups short and realistic.',
      },
    }));

    const result = await populateFirstProfileFromLesson({
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
            profileId: 'profiles/students/tolik.md',
            voices: {},
          }),
          ensureCanonicalProfileBinding: async () => {
            throw new Error('should not initialize when profile is already bound');
          },
        },
        profiles: {
          getById: async () => ({
            id: 'profiles/students/tolik.md',
            label: 'Tolik',
            activeRevisionId: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        },
        revisions: {
          getActive: async () => null,
        },
        memory: {
          getOverview: async () => ({
            studentId: 'tolik',
            latestReadyStudentMemorySnapshot: {
              id: 'snapshot-1',
              studentId: 'tolik',
              schemaVersion: 'student-memory-snapshot.v1',
              generatedAt: new Date('2026-03-20T00:00:00.000Z'),
              provider: 'google_ai_studio',
              model: 'gemini-3-flash-preview',
              status: 'ready',
              sourceKind: 'student_memory_rollup',
              lessonMemoryEntryIds: ['lesson-1'],
              homeworkMemoryEntryIds: [],
              stableStrengths: [
                {
                  label: 'Strong listening comprehension.',
                  note: 'Understands the lesson flow even when speaking lags behind.',
                },
              ],
              recurringIssues: [
                {
                  label: 'Needs cleaner past-tense control.',
                  issueType: 'grammar',
                  note: 'Defaults to present tense when recounting recent work updates.',
                  confidence: 'high',
                },
              ],
              activeReviewBacklog: [],
              recentProgress: [
                {
                  label: 'Participated more confidently in standups.',
                  note: 'Volunteered updates without prompting in the latest lesson.',
                },
              ],
              personalFacts: [
                {
                  fact: 'Works in product operations.',
                  category: 'work',
                  authority: 'teacher_confirmed',
                  confidence: 'high',
                  evidence: [],
                  reviewNeeded: false,
                },
              ],
              recommendedAssignmentDirections: [
                {
                  direction: 'Keep homework concise and practical.',
                  rationale: 'Short tasks are more likely to be completed consistently.',
                },
              ],
              unresolvedIssues: [],
              snapshotSummary: 'More confident in speaking, still needs tense stability.',
              createdAt: new Date('2026-03-20T00:00:00.000Z'),
              updatedAt: new Date('2026-03-20T00:00:00.000Z'),
            },
            recentReadyLessonMemory: [makeReadyLessonMemory()],
            recentReadyHomeworkMemory: [],
            unresolvedIssues: [],
          }),
        },
        drafting: {
          generate: async () => ({
            structuredProfile: {
              schemaVersion: 'foundational_profile_v1',
              overallLevel: 'B1',
              primaryGoals: ['Handle standups with less hesitation.'],
              communicationContexts: ['Daily standups with product and engineering.'],
              interestsAndUsefulThemes: ['Enjoys travel examples.'],
              stableStrengths: ['Strong listening comprehension.'],
              persistentChallenges: ['Needs cleaner past-tense control.'],
              studyPreferences: ['Prefers concise, practical homework.'],
              durableConstraints: [],
              teacherNotes: 'Keep follow-ups short and realistic.',
            },
            rawOutput: {},
            rawText: JSON.stringify({
              schemaVersion: 'foundational_profile_v1',
              overallLevel: 'B1',
              primaryGoals: ['Handle standups with less hesitation.'],
              communicationContexts: ['Daily standups with product and engineering.'],
              interestsAndUsefulThemes: ['Enjoys travel examples.'],
              stableStrengths: ['Strong listening comprehension.'],
              persistentChallenges: ['Needs cleaner past-tense control.'],
              studyPreferences: ['Prefers concise, practical homework.'],
              durableConstraints: [],
              teacherNotes: 'Keep follow-ups short and realistic.',
            }),
            provider: 'google_ai_studio',
            model: 'gemini-3-flash-preview',
          }),
        },
        profileContent: {
          saveRevision,
        },
      },
    });

    expect(result.draftRevision.status).toBe('draft');
    expect(result.snapshotId).toBe('snapshot-1');
    expect(saveRevision).toHaveBeenCalledWith(
      'profiles/students/tolik.md',
      expect.stringContaining('# Foundational Profile'),
      expect.objectContaining({
        source: 'lesson_population',
        status: 'draft',
        createdBy: 'teacher-1',
        structuredContent: expect.objectContaining({
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B1',
        }),
      }),
    );
  });

  it('requires ready lesson memory before drafting the first profile', async () => {
    const generate = vi.fn();

    await expect(
      populateFirstProfileFromLesson({
        request: {
          studentId: 'tolik',
        },
        overrides: {
          config: loadConfig(),
          students: {
            getById: async () => ({
              id: 'tolik',
              student: 'Tolik',
              profileId: 'profiles/students/tolik.md',
              voices: {},
            }),
            ensureCanonicalProfileBinding: async () => {
              throw new Error('should not initialize when profile is already bound');
            },
          },
          profiles: {
            getById: async () => ({
              id: 'profiles/students/tolik.md',
              label: 'Tolik',
              activeRevisionId: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
          },
          revisions: {
            getActive: async () => null,
          },
          memory: {
            getOverview: async () => ({
              studentId: 'tolik',
              latestReadyStudentMemorySnapshot: null,
              recentReadyLessonMemory: [],
              recentReadyHomeworkMemory: [],
              unresolvedIssues: [],
            }),
          },
          drafting: {
            generate,
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'lesson_memory_required',
      status: 409,
    });

    expect(generate).not.toHaveBeenCalled();
  });

  it('uses the OpenAI profile-population model without provider fallback', async () => {
    const structuredProfile = {
      schemaVersion: 'foundational_profile_v1' as const,
      overallLevel: 'B1',
      primaryGoals: ['Handle standups with less hesitation.'],
      communicationContexts: ['Daily standups with product and engineering.'],
      interestsAndUsefulThemes: ['Enjoys travel examples.'],
      stableStrengths: ['Strong listening comprehension.'],
      persistentChallenges: ['Needs cleaner past-tense control.'],
      studyPreferences: ['Prefers concise, practical homework.'],
      durableConstraints: [],
      teacherNotes: 'Keep follow-ups short and realistic.',
    };
    const generate = vi.fn(async () => ({
      structuredProfile,
      rawOutput: {},
      rawText: '{}',
      provider: 'openai' as const,
      model: 'gpt-5.4-mini',
    }));

    await populateFirstProfileFromLesson({
      request: {
        studentId: 'tolik',
      },
      overrides: {
        config: {
          ...loadConfig(),
          generation: {
            ...loadConfig().generation,
            defaultProvider: 'openai',
            fallbackProviders: ['google_ai_studio', 'openrouter'],
            models: {
              ...loadConfig().generation.models,
              openai: {
                ...loadConfig().generation.models.openai,
                profileDraftPrimary: 'gpt-5.4-mini',
              },
            },
          },
        },
        students: {
          getById: async () => ({
            id: 'tolik',
            student: 'Tolik',
            profileId: 'profiles/students/tolik.md',
            voices: {},
          }),
          ensureCanonicalProfileBinding: async () => {
            throw new Error('should not initialize when profile is already bound');
          },
        },
        profiles: {
          getById: async () => ({
            id: 'profiles/students/tolik.md',
            label: 'Tolik',
            activeRevisionId: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        },
        revisions: {
          getActive: async () => null,
        },
        memory: {
          getOverview: async () => ({
            studentId: 'tolik',
            latestReadyStudentMemorySnapshot: null,
            recentReadyLessonMemory: [makeReadyLessonMemory()],
            recentReadyHomeworkMemory: [],
            unresolvedIssues: [],
          }),
        },
        drafting: {
          generate,
        },
        profileContent: {
          saveRevision: async () => ({
            id: 'revision-draft-1',
            profileId: 'profiles/students/tolik.md',
            contentHash: 'hash',
            source: 'lesson_population',
            status: 'draft',
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: null,
            deprecatedAt: null,
            createdAt: '2026-03-22T00:00:00.000Z',
            createdBy: null,
            restoredFromRevisionId: null,
            content: '# Foundational Profile',
            structuredContent: structuredProfile,
          }),
        },
      },
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          operation: 'lesson_population',
          providerOverride: 'openai',
          modelOverride: 'gpt-5.4-mini',
          includeProviderFallbacks: false,
        }),
      }),
    );
  });

  it('requires canonical student memory before creating the first draft', async () => {
    await expect(
      populateFirstProfileFromLesson({
        request: {
          studentId: 'tolik',
        },
        overrides: {
          config: loadConfig(),
          students: {
            getById: async () => ({
              id: 'tolik',
              student: 'Tolik',
              profileId: 'profiles/students/tolik.md',
              voices: {},
            }),
            ensureCanonicalProfileBinding: async () => {
              throw new Error('should not initialize when profile is already bound');
            },
          },
          profiles: {
            getById: async () => ({
              id: 'profiles/students/tolik.md',
              label: 'Tolik',
              activeRevisionId: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            }),
          },
          revisions: {
            getActive: async () => null,
          },
          memory: {
            getOverview: async () => null,
          },
        },
      }),
    ).rejects.toBeInstanceOf(PopulateFirstProfileFromLessonError);
  });

  it('auto-binds a canonical profile when lesson population starts from an unbound student', async () => {
    const saveRevision = vi.fn(async () => ({
      id: 'revision-draft-1',
      profileId: 'profiles/students/tolik.md',
      contentHash: 'hash',
      source: 'lesson_population' as const,
      status: 'draft' as const,
      versionNumber: 1,
      versionLabel: 'v1',
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
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
    }));

    const ensureCanonicalProfileBinding = vi.fn(async () => ({
      id: 'tolik',
      student: 'Tolik',
      profileId: 'profiles/students/tolik.md',
      voices: {},
    }));

    await populateFirstProfileFromLesson({
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
          ensureCanonicalProfileBinding,
        },
        profiles: {
          getById: async () => ({
            id: 'profiles/students/tolik.md',
            label: 'Tolik',
            activeRevisionId: null,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        },
        revisions: {
          getActive: async () => null,
        },
        memory: {
          getOverview: async () => ({
            studentId: 'tolik',
            latestReadyStudentMemorySnapshot: {
              id: 'snapshot-1',
              studentId: 'tolik',
              schemaVersion: 'student-memory-snapshot.v1',
              generatedAt: new Date('2026-03-20T00:00:00.000Z'),
              provider: 'google_ai_studio',
              model: 'gemini-3-flash-preview',
              status: 'ready',
              sourceKind: 'student_memory_rollup',
              lessonMemoryEntryIds: ['lesson-1'],
              homeworkMemoryEntryIds: [],
              stableStrengths: [],
              recurringIssues: [],
              activeReviewBacklog: [],
              recentProgress: [],
              personalFacts: [],
              recommendedAssignmentDirections: [],
              unresolvedIssues: [],
              snapshotSummary: 'Snapshot summary',
              createdAt: new Date('2026-03-20T00:00:00.000Z'),
              updatedAt: new Date('2026-03-20T00:00:00.000Z'),
            },
            recentReadyLessonMemory: [makeReadyLessonMemory()],
            recentReadyHomeworkMemory: [],
            unresolvedIssues: [],
          }),
        },
        drafting: {
          generate: async () => ({
            structuredProfile: {
              schemaVersion: 'foundational_profile_v1',
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
            rawOutput: {},
            rawText: JSON.stringify({
              schemaVersion: 'foundational_profile_v1',
              overallLevel: null,
              primaryGoals: [],
              communicationContexts: [],
              interestsAndUsefulThemes: [],
              stableStrengths: [],
              persistentChallenges: [],
              studyPreferences: [],
              durableConstraints: [],
              teacherNotes: null,
            }),
            provider: 'google_ai_studio',
            model: 'gemini-3-flash-preview',
          }),
        },
        profileContent: {
          saveRevision,
        },
      },
    });

    expect(ensureCanonicalProfileBinding).toHaveBeenCalledWith(
      'tolik',
      expect.objectContaining({
        bindingAudit: {
          reason: 'student_area_profile_initialize',
          changedBy: 'teacher-1',
        },
      }),
    );
    expect(saveRevision).toHaveBeenCalledWith(
      'profiles/students/tolik.md',
      expect.any(String),
      expect.objectContaining({
        source: 'lesson_population',
      }),
    );
  });
});
