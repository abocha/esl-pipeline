import { describe, expect, it, vi } from 'vitest';

import {
  LegacyProfileNormalizationError,
  normalizeLegacyStudentProfile,
} from '../src/application/legacy-profile-normalization.js';
import { loadConfig } from '../src/config/env.js';

describe('application/legacy-profile-normalization', () => {
  it('creates a draft revision from active profile content and canonical memory', async () => {
    const saveRevision = vi.fn(async () => ({
      id: 'revision-draft-1',
      profileId: 'profiles/students/tolik.md',
      contentHash: 'hash',
      source: 'legacy_normalization' as const,
      status: 'draft' as const,
      versionNumber: 4,
      versionLabel: 'v4',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: '2026-03-22T00:00:00.000Z',
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Normalized profile',
    }));

    const result = await normalizeLegacyStudentProfile({
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
        },
        profiles: {
          getById: async () => ({
            id: 'profiles/students/tolik.md',
            label: 'Tolik',
            activeRevisionId: 'revision-active-1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        },
        revisions: {
          getActive: async () => ({
            id: 'revision-active-1',
            profileId: 'profiles/students/tolik.md',
            content: '# Legacy profile',
            contentHash: 'hash-1',
            source: 'update',
            status: 'active',
            versionNumber: 3,
            versionLabel: 'v3',
            activatedAt: new Date('2026-02-01T00:00:00.000Z'),
            deprecatedAt: null,
            createdAt: new Date('2026-02-01T00:00:00.000Z'),
            createdBy: 'teacher-1',
            restoredFromRevisionId: null,
          }),
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
              homeworkMemoryEntryIds: ['homework-1'],
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
            recentReadyLessonMemory: [],
            recentReadyHomeworkMemory: [],
            unresolvedIssues: [],
          }),
        },
        drafting: {
          generate: async () => ({
            structuredProfile: {
              schemaVersion: 'foundational_profile_v1',
              overallLevel: 'B1',
              primaryGoals: ['Lead updates more confidently.'],
              communicationContexts: ['Weekly work meetings'],
              interestsAndUsefulThemes: ['Travel examples'],
              stableStrengths: ['Strong listening'],
              persistentChallenges: ['Verb tense stability'],
              studyPreferences: ['Structured explanations'],
              durableConstraints: [],
              teacherNotes: 'Keep the profile practical and durable.',
            },
            rawOutput: {},
            rawText: '# Normalized profile',
            provider: 'google_ai_studio',
            model: 'gemini-3-flash-preview',
          }),
        },
        profileContent: {
          saveRevision,
        },
      },
    });

    expect(result.sourceRevisionId).toBe('revision-active-1');
    expect(result.snapshotId).toBe('snapshot-1');
    expect(result.draftRevision.status).toBe('draft');
    expect(saveRevision).toHaveBeenCalledWith(
      'profiles/students/tolik.md',
      expect.stringContaining('# Foundational Profile'),
      expect.objectContaining({
        source: 'legacy_normalization',
        status: 'draft',
        createdBy: 'teacher-1',
        structuredContent: expect.objectContaining({
          schemaVersion: 'foundational_profile_v1',
        }),
      }),
    );
  });

  it('requires an active profile revision before normalization', async () => {
    await expect(
      normalizeLegacyStudentProfile({
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
        },
      }),
    ).rejects.toBeInstanceOf(LegacyProfileNormalizationError);
  });
});
