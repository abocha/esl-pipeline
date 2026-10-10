import { describe, expect, it, vi } from 'vitest';

import type { ProviderStructuredExecutionRequest } from '../src/application/generation-providers.js';
import { refreshProfileDraftFromApprovedCandidates } from '../src/application/profile-draft-refresh.js';
import { loadConfig } from '../src/config/env.js';
import type { StudentProfileCandidateRecord } from '../src/domain/student-profile-candidate-model.js';
import { assertMemoryRequest } from './support/memory-request-capture.js';

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

describe('application/profile-draft-refresh', () => {
  it.each([
    [
      'exact approved wording',
      'Uses product launches as a useful speaking theme.',
      ['candidate-1'],
    ],
    ['a paraphrase', 'Product launches', []],
  ])('links only represented approved facts with %s', async (_label, theme, included) => {
    const linkToDraft = vi.fn().mockResolvedValue(undefined);
    const structuredProfile = {
      schemaVersion: 'foundational_profile_v1' as const,
      overallLevel: 'B1',
      primaryGoals: ['Lead project updates clearly.'],
      communicationContexts: ['Team updates'],
      interestsAndUsefulThemes: [theme as string],
      stableStrengths: ['Prepared notes'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Short practical tasks'],
      durableConstraints: [],
      teacherNotes: 'Use sports examples sparingly.',
    };
    const generate = vi.fn(async () => ({
      structuredProfile,
      rawOutput: structuredProfile,
      rawText: JSON.stringify(structuredProfile),
      provider: 'openai' as const,
      model: 'gpt-5.6-luna',
      finishReason: 'stop',
    }));
    const saveRevision = vi.fn(async () => ({
      id: 'revision-draft-1',
      studentId: 'tolik',
      contentHash: 'hash',
      source: 'profile_revision_refresh' as const,
      status: 'draft' as const,
      versionNumber: 3,
      versionLabel: 'v3',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: '2026-03-22T00:00:00.000Z',
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Foundational Profile',
      structuredContent: structuredProfile,
    }));

    const result = await refreshProfileDraftFromApprovedCandidates({
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
            structuredContent: {
              schemaVersion: 'foundational_profile_v1',
              overallLevel: 'A2',
              primaryGoals: ['Speak more confidently.'],
              communicationContexts: ['Daily work'],
              interestsAndUsefulThemes: [],
              stableStrengths: [],
              persistentChallenges: [],
              studyPreferences: [],
              durableConstraints: [],
              teacherNotes: null,
            },
          }),
          getById: async () => null,
        },
        candidates: {
          listByIds: async () => [
            makeCandidate({
              id: 'candidate-1',
              fact: 'Likes product launches.',
              approvedFact: 'Uses product launches as a useful speaking theme.',
              evidence: [{ quote: 'Launch meetings are hard.', speakerRole: 'student' }],
            }),
            makeCandidate({ id: 'candidate-2', fact: 'Likes hiking.' }),
          ],
          linkToDraft,
        },
        memory: {
          getOverview: async () => ({
            availability: {
              state: 'absent',
              reason: 'no_established_snapshot',
              lessonReferenceCount: 0,
              homeworkReferenceCount: 0,
            },
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
        profileContent: {
          saveRevision,
        },
      },
    });

    const captured = (
      generate.mock.calls as unknown as [{ request: ProviderStructuredExecutionRequest }][]
    )[0]![0].request;
    await assertMemoryRequest('profile-refresh', { ...captured, model: 'fixture' });
    expect(result.draftRevision.status).toBe('draft');
    expect(result.includedCandidateIds).toEqual(included);
    expect(linkToDraft).toHaveBeenCalledWith({
      studentId: 'tolik',
      candidateIds: included,
      draftRevisionId: 'revision-draft-1',
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          operation: 'profile_revision_refresh',
          responseSchema: expect.objectContaining({
            name: 'foundational_profile_v1',
            strict: true,
          }),
          envelope: expect.objectContaining({
            workload: 'profile_revision',
            input: expect.stringContaining('<source_data id="student-name" label="STUDENT_NAME">'),
            sourceManifest: expect.arrayContaining([
              expect.objectContaining({ label: 'STUDENT_NAME' }),
              expect.objectContaining({ label: 'BASE_STRUCTURED_PROFILE' }),
              expect.objectContaining({ label: 'APPROVED_PROFILE_CANDIDATES' }),
            ]),
          }),
        }),
      }),
    );
    expect(saveRevision).toHaveBeenCalledWith(
      'tolik',
      expect.stringContaining('# Foundational Profile'),
      expect.objectContaining({
        source: 'profile_revision_refresh',
        status: 'draft',
        structuredContent: expect.objectContaining({
          schemaVersion: 'foundational_profile_v1',
        }),
      }),
    );
  });
});
