import { describe, expect, it, vi } from 'vitest';

import {
  approveStudentProfileCandidate,
  deferStudentProfileCandidate,
  refreshStudentProfileCandidatesFromCanonicalMemory,
  rejectStudentProfileCandidate,
} from '../src/application/student-profile-candidates.js';

describe('application/student-profile-candidates', () => {
  it('returns null when refreshing candidates for a missing student', async () => {
    const result = await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-missing',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue(null),
        },
      },
    });

    expect(result).toBeNull();
  });

  it('builds latest-lesson candidates with provenance and inserts them once', async () => {
    const insert = vi.fn().mockImplementation(async (params) => ({
      id: 'candidate-1',
      approvedFact: null,
      status: 'pending_review',
      reviewState: 'unreviewed',
      reviewerId: null,
      reviewerNote: null,
      reviewedAt: null,
      promotedRevisionId: null,
      promotedAt: null,
      supersededById: null,
      supersededAt: null,
      createdAt: new Date('2026-03-22T00:00:00.000Z'),
      updatedAt: new Date('2026-03-22T00:00:00.000Z'),
      ...params,
    }));
    const supersedePending = vi.fn().mockImplementation(async () => {});

    const result = await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-1',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue({ id: 'student-1' }),
        },
        snapshots: {
          getLatestReadyByStudentId: vi.fn().mockResolvedValue({
            id: 'snapshot-1',
            personalFacts: [
              {
                fact: 'Prefers structured homework checklists.',
                category: 'goal',
                authority: 'student_stated',
                confidence: 'high',
                reviewNeeded: false,
                evidence: [{ quote: 'I want to feel more confident in meetings.' }],
              },
            ],
          }),
        },
        lessonMemory: {
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([
            {
              id: 'lesson-1',
              generatedAt: new Date('2026-03-21T10:00:00.000Z'),
              createdAt: new Date('2026-03-21T10:00:00.000Z'),
              topicsDiscussed: [{ topic: 'Client updates', note: 'Practiced concise updates.' }],
              studentFacts: [
                {
                  fact: 'Uses English with clients at work.',
                  category: 'work',
                  authority: 'teacher_confirmed',
                  confidence: 'medium',
                  reviewNeeded: false,
                  evidence: [{ quote: 'Student mentioned wanting more confidence at work.' }],
                },
              ],
            },
          ]),
        },
        candidates: {
          getById: vi.fn(),
          insert,
          listLatestByKeys: vi.fn().mockResolvedValue(new Map()),
          supersedePending,
          updateReview: vi.fn(),
        },
      },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        targetSection: 'work_communication_context',
        authority: 'teacher_confirmed',
        confidence: 'medium',
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-1'],
        sourceMemoryIds: ['lesson-1'],
        sourceLessonTitle: 'Client updates',
        provenance: expect.objectContaining({
          sourceKind: 'latest_lesson_memory',
          sourceLessonMemoryId: 'lesson-1',
          dedupModel: 'gemini-3.1-flash-lite',
        }),
        dedupDecision: expect.objectContaining({
          decision: 'created',
        }),
      }),
    );
    expect(supersedePending).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        candidateKey: 'work_communication_context:uses english with clients at work',
        supersededById: 'candidate-1',
      }),
    );
    expect(result).toMatchObject({
      studentId: 'student-1',
      sourceSnapshotId: 'snapshot-1',
      created: [{ id: 'candidate-1' }],
    });
  });

  it('does not reinsert a matching pending candidate', async () => {
    const insert = vi.fn();

    const result = await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-1',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue({ id: 'student-1' }),
        },
        snapshots: {
          getLatestReadyByStudentId: vi.fn().mockResolvedValue(null),
        },
        lessonMemory: {
          listRecentReadyByStudentId: vi.fn().mockResolvedValue([
            {
              id: 'lesson-1',
              generatedAt: new Date('2026-03-21T10:00:00.000Z'),
              createdAt: new Date('2026-03-21T10:00:00.000Z'),
              topicsDiscussed: [],
              studentFacts: [
                {
                  fact: 'Wants to speak English more confidently at work.',
                  category: 'goal',
                  authority: 'student_stated',
                  confidence: 'high',
                  reviewNeeded: false,
                  evidence: [],
                },
              ],
            },
          ]),
        },
        candidates: {
          getById: vi.fn(),
          insert,
          listLatestByKeys: vi.fn().mockResolvedValue(
            new Map([
              [
                'goals_motivation:wants to speak english more confidently at work',
                {
                  id: 'candidate-existing',
                  status: 'pending_review',
                },
              ],
            ]),
          ),
          supersedePending: vi.fn(),
          updateReview: vi.fn(),
        },
      },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'rejected',
        reviewState: 'rejected',
        dedupDecision: expect.objectContaining({
          decision: 'duplicate',
          model: 'gemini-3.1-flash-lite',
        }),
      }),
    );
    expect(result?.skippedCandidateKeys).toEqual([
      'goals_motivation:wants to speak english more confidently at work',
    ]);
  });

  it('allows approved candidates to store edited fact text', async () => {
    const updateReview = vi.fn().mockResolvedValue({
      id: 'candidate-1',
      status: 'approved',
      reviewState: 'approved',
      approvedFact: 'Uses English in client meetings and wants more confidence there.',
    });

    const result = await approveStudentProfileCandidate({
      studentId: 'student-1',
      candidateId: 'candidate-1',
      reviewerId: 'user-1',
      approvedFact: 'Uses English in client meetings and wants more confidence there.',
      overrides: {
        candidates: {
          getById: vi.fn().mockResolvedValue({
            id: 'candidate-1',
            studentId: 'student-1',
            status: 'pending_review',
          }),
          insert: vi.fn(),
          listLatestByKeys: vi.fn(),
          supersedePending: vi.fn(),
          updateReview,
        },
      },
    });

    expect(updateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'approved',
        reviewState: 'approved',
        approvedFact: 'Uses English in client meetings and wants more confidence there.',
      }),
    );
    expect(result.approvedFact).toBe(
      'Uses English in client meetings and wants more confidence there.',
    );
  });

  it('marks deferred candidates with deferred review state while keeping pending lifecycle', async () => {
    const updateReview = vi.fn().mockResolvedValue({
      id: 'candidate-1',
      status: 'pending_review',
      reviewState: 'deferred',
      approvedFact: null,
    });

    const result = await deferStudentProfileCandidate({
      studentId: 'student-1',
      candidateId: 'candidate-1',
      reviewerId: 'user-1',
      reviewerNote: 'Need one more lesson before deciding.',
      overrides: {
        candidates: {
          getById: vi.fn().mockResolvedValue({
            id: 'candidate-1',
            studentId: 'student-1',
            status: 'pending_review',
          }),
          insert: vi.fn(),
          listLatestByKeys: vi.fn(),
          supersedePending: vi.fn(),
          updateReview,
        },
      },
    });

    expect(updateReview).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'pending_review',
        reviewState: 'deferred',
      }),
    );
    expect(result.reviewState).toBe('deferred');
  });

  it('rejects review changes for superseded candidates', async () => {
    await expect(
      rejectStudentProfileCandidate({
        studentId: 'student-1',
        candidateId: 'candidate-1',
        overrides: {
          candidates: {
            getById: vi.fn().mockResolvedValue({
              id: 'candidate-1',
              studentId: 'student-1',
              status: 'superseded',
            }),
            insert: vi.fn(),
            listLatestByKeys: vi.fn(),
            supersedePending: vi.fn(),
            updateReview: vi.fn(),
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_candidate_state',
      status: 409,
    });
  });
});
