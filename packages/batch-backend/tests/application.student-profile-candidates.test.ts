import { describe, expect, it, vi } from 'vitest';

import {
  approveStudentProfileCandidate,
  deferStudentProfileCandidate,
  refreshStudentProfileCandidatesFromCanonicalMemory,
  rejectStudentProfileCandidate,
} from '../src/application/student-profile-candidates.js';
import type { LessonMemoryRecord } from '../src/domain/lesson-memory-model.js';
import type { StudentMemorySnapshotRecord } from '../src/domain/student-memory-snapshot-model.js';

const fact = {
  fact: 'Prefers structured homework checklists.',
  category: 'study preference',
  authority: 'student_stated' as const,
  confidence: 'high' as const,
  reviewNeeded: false,
  evidence: [{ quote: 'A checklist helps me study.' }],
};
const now = new Date('2026-10-09T00:00:00Z');

function lesson(id = 'lesson-a', overrides: Partial<LessonMemoryRecord> = {}): LessonMemoryRecord {
  return {
    id,
    studentId: 'student-1',
    transcriptId: 'transcript-a',
    recordingId: 'recording-a',
    schemaVersion: 'lesson-memory.v1',
    generatedAt: now,
    createdAt: now,
    updatedAt: now,
    provider: 'fixture',
    model: 'fixture',
    status: 'ready',
    sourceKind: 'lesson_transcript',
    topicsDiscussed: [{ topic: 'Study habits', note: '' }],
    mistakePatterns: [],
    grammarReviewed: [],
    grammarWatchlist: [],
    vocabularyFocus: [],
    pronunciationFocus: [],
    studentFacts: [fact],
    progressSignals: [],
    followUpRecommendations: [],
    ...overrides,
  };
}
function snapshot(
  overrides: Partial<StudentMemorySnapshotRecord> = {},
): StudentMemorySnapshotRecord {
  return {
    id: 'snapshot-a',
    studentId: 'student-1',
    schemaVersion: 'student-memory.v1',
    generatedAt: now,
    provider: 'fixture',
    model: 'fixture',
    status: 'ready',
    sourceKind: 'student_memory_rollup',
    lessonMemoryEntryIds: ['lesson-a'],
    homeworkMemoryEntryIds: [],
    generationNotes: {
      triggerSourceKind: 'lesson_memory',
      triggerSourceEntryId: 'lesson-a',
      includedLessonMemoryEntryIds: ['lesson-a'],
    },
    personalFacts: [fact],
    stableStrengths: [],
    recurringIssues: [],
    activeReviewBacklog: [],
    recentProgress: [],
    recommendedAssignmentDirections: [],
    unresolvedIssues: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
function dependencies(source = snapshot(), lessons = [lesson()]) {
  return {
    students: { getById: vi.fn().mockResolvedValue({ id: 'student-1' }) },
    snapshots: { getCandidateSourceById: vi.fn().mockResolvedValue(source) },
    lessonMemory: { listVerifiedReadyByIds: vi.fn().mockResolvedValue(lessons) },
    revisions: { getActive: vi.fn().mockResolvedValue(null) },
    candidates: {
      getById: vi.fn(),
      updateReview: vi.fn(),
      persistRefresh: vi.fn().mockResolvedValue({
        outcome: 'persisted',
        created: [],
        skippedCandidateKeys: [],
        skippedDuplicateCandidateKeys: [],
        skippedStaleCandidateKeys: [],
      }),
    },
  };
}

describe('application/student-profile-candidates', () => {
  it('skips old source-less work before reading current memory', async () => {
    const overrides = dependencies();
    const result = await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-1',
      overrides,
    });
    expect(result).toMatchObject({ outcome: 'skipped', skipReason: 'source_snapshot_id_missing' });
    expect(overrides.snapshots.getCandidateSourceById).not.toHaveBeenCalled();
    expect(overrides.candidates.persistRefresh).not.toHaveBeenCalled();
  });

  it('returns null for a missing student after validating source ownership', async () => {
    const overrides = dependencies();
    overrides.students.getById.mockResolvedValue(null);
    expect(
      await refreshStudentProfileCandidatesFromCanonicalMemory({
        studentId: 'student-1',
        sourceSnapshotId: 'snapshot-a',
        overrides,
      }),
    ).toBeNull();
    expect(overrides.lessonMemory.listVerifiedReadyByIds).not.toHaveBeenCalled();
  });

  it('examines delayed lesson A and proposes its fact even though snapshot A already contains it', async () => {
    const overrides = dependencies();
    await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-1',
      sourceSnapshotId: 'snapshot-a',
      overrides,
    });
    expect(overrides.snapshots.getCandidateSourceById).toHaveBeenCalledWith('snapshot-a');
    expect(overrides.lessonMemory.listVerifiedReadyByIds).toHaveBeenCalledWith('student-1', [
      'lesson-a',
    ]);
    expect(overrides.candidates.persistRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSnapshotId: 'snapshot-a',
        sourceLessonMemoryIds: ['lesson-a'],
        proposals: [
          expect.objectContaining({
            fact: fact.fact,
            sourceSnapshotId: 'snapshot-a',
            sourceLessonMemoryIds: ['lesson-a'],
            sourceLessonStartedAt: null,
            provenance: expect.objectContaining({
              sourceLessonChronology: 'memory_generated_at_fallback',
            }),
            dedupDecision: {
              decision: 'created',
              reason: 'A pinned eligible lesson source contains this review opportunity.',
            },
          }),
        ],
      }),
    );
    const proposal = overrides.candidates.persistRefresh.mock.calls[0]?.[0].proposals[0];
    expect(proposal.provenance).not.toHaveProperty('dedupModel');
    expect(proposal.dedupDecision).not.toHaveProperty('model');
  });

  it('uses actual completed lesson time while retaining extraction time', async () => {
    const startedAt = new Date('2026-10-01T10:00:00Z');
    const overrides = dependencies(snapshot(), [
      lesson('lesson-a', {
        sourceLessonId: 'scheduled-lesson-a',
        sourceLessonStartedAt: startedAt,
      }),
    ]);
    await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-1',
      sourceSnapshotId: 'snapshot-a',
      overrides,
    });
    expect(overrides.candidates.persistRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        proposals: [
          expect.objectContaining({
            sourceLessonId: 'scheduled-lesson-a',
            sourceLessonStartedAt: startedAt,
            provenance: expect.objectContaining({
              sourceLessonGeneratedAt: now.toISOString(),
              sourceLessonChronology: 'completed_lesson_started_at',
            }),
          }),
        ],
      }),
    );
  });

  it.each([
    ['wrong student', snapshot({ studentId: 'other-student' }), 'source_snapshot_student_mismatch'],
    [
      'unrecorded source',
      snapshot({ lessonMemoryEntryIds: ['lesson-b'] }),
      'source_lesson_context_not_in_snapshot',
    ],
    [
      'manual rebuild without a selected lesson',
      snapshot({
        generationNotes: {
          triggerSourceKind: 'manual',
          includedLessonMemoryEntryIds: ['lesson-a'],
        },
      }),
      'source_lesson_context_unavailable',
    ],
  ])('rejects %s before candidate access', async (_title, source, reason) => {
    const overrides = dependencies(source as StudentMemorySnapshotRecord);
    const result = await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-1',
      sourceSnapshotId: 'snapshot-a',
      overrides,
    });
    expect(result).toMatchObject({ outcome: 'skipped', skipReason: reason });
    expect(overrides.lessonMemory.listVerifiedReadyByIds).not.toHaveBeenCalled();
    expect(overrides.candidates.persistRefresh).not.toHaveBeenCalled();
  });

  it.each(['snapshot', 'lesson'] as const)(
    'skips replaced %s evidence without unrelated fallback',
    async (unavailable) => {
      const overrides = dependencies();
      if (unavailable === 'snapshot')
        overrides.snapshots.getCandidateSourceById.mockResolvedValue(null);
      else overrides.lessonMemory.listVerifiedReadyByIds.mockResolvedValue([]);
      expect(
        await refreshStudentProfileCandidatesFromCanonicalMemory({
          studentId: 'student-1',
          sourceSnapshotId: 'snapshot-a',
          overrides,
        }),
      ).toMatchObject({ outcome: 'skipped' });
      expect(overrides.candidates.persistRefresh).not.toHaveBeenCalled();
    },
  );

  it('uses only pinned selected lesson context for homework-triggered snapshots', async () => {
    const overrides = dependencies(
      snapshot({
        generationNotes: {
          triggerSourceKind: 'homework_memory',
          triggerSourceEntryId: 'homework-a',
          includedLessonMemoryEntryIds: ['lesson-a'],
        },
      }),
    );
    await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-1',
      sourceSnapshotId: 'snapshot-a',
      overrides,
    });
    expect(overrides.lessonMemory.listVerifiedReadyByIds).toHaveBeenCalledWith('student-1', [
      'lesson-a',
    ]);
    expect(
      overrides.candidates.persistRefresh.mock.calls[0]?.[0].proposals[0].sourceMemoryIds,
    ).toEqual(['lesson-a']);
  });

  it('deduplicates only exact field representation in the active profile', async () => {
    const overrides = dependencies();
    overrides.revisions.getActive.mockResolvedValue({
      id: 'active-a',
      content: '',
      structuredContent: { studyPreferences: ['  PREFERS STRUCTURED HOMEWORK CHECKLISTS.  '] },
    });
    await refreshStudentProfileCandidatesFromCanonicalMemory({
      studentId: 'student-1',
      sourceSnapshotId: 'snapshot-a',
      overrides,
    });
    expect(overrides.candidates.persistRefresh).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedActiveRevisionId: 'active-a',
        proposals: [],
      }),
    );
  });

  it('retries the same source if the active profile changes before persistence', async () => {
    const overrides = dependencies();
    overrides.candidates.persistRefresh.mockResolvedValue({ outcome: 'active_profile_changed' });
    await expect(
      refreshStudentProfileCandidatesFromCanonicalMemory({
        studentId: 'student-1',
        sourceSnapshotId: 'snapshot-a',
        overrides,
      }),
    ).rejects.toThrow('retry the same snapshot');
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
          persistRefresh: vi.fn(),
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
          persistRefresh: vi.fn(),
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
            persistRefresh: vi.fn(),
            updateReview: vi.fn(),
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_candidate_state',
      status: 409,
    });
  });

  it('returns a conflict when activation wins between the review read and update', async () => {
    await expect(
      approveStudentProfileCandidate({
        studentId: 'student-1',
        candidateId: 'candidate-1',
        overrides: {
          candidates: {
            getById: vi.fn().mockResolvedValue({ status: 'approved', fact: 'Old wording' }),
            persistRefresh: vi.fn(),
            updateReview: vi.fn().mockResolvedValue(null),
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'invalid_candidate_state', status: 409 });
  });
});
