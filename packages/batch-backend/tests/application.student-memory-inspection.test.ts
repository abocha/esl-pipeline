import { describe, expect, it, vi } from 'vitest';

import {
  getStudentMemoryHealth,
  getStudentMemoryOverview,
  listStudentMemorySnapshotsForStudent,
  listStudentProfileCandidatesForStudent,
} from '../src/application/student-memory-inspection.js';

describe('application/student-memory-inspection', () => {
  it('reports stored-ready separately from repair-required and repository-unavailable using read-only dependencies', async () => {
    const getSelection = vi.fn().mockResolvedValue({
      snapshot: null,
      availability: {
        state: 'repair_required',
        reason: 'established_history_ineligible',
        lessonReferenceCount: 19,
        homeworkReferenceCount: 3,
      },
    });
    const overrides = {
      students: { getById: vi.fn().mockResolvedValue({ id: 'student-1' }) },
      snapshots: {
        getSelection,
        list: vi.fn().mockResolvedValue([{ id: 'stored-ready', status: 'ready' }]),
      },
      lessonMemory: { list: vi.fn().mockResolvedValue([]), listRecentReadyByStudentId: vi.fn() },
      homeworkMemory: { list: vi.fn().mockResolvedValue([]), listRecentReadyByStudentId: vi.fn() },
      profileCandidates: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
    };
    const health = await getStudentMemoryHealth({ studentId: 'student-1', overrides });
    expect(health?.latestSnapshot?.status).toBe('ready');
    expect(health?.availability.state).toBe('repair_required');
    getSelection.mockRejectedValue(new Error('private storage URL'));
    const unavailable = await getStudentMemoryHealth({ studentId: 'student-1', overrides });
    expect(unavailable?.availability.state).toBe('repository_unavailable');
    expect(JSON.stringify(unavailable?.availability)).not.toContain('private');
  });
  it('returns null when the student does not exist', async () => {
    const result = await getStudentMemoryOverview({
      studentId: 'student-missing',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue(null),
        },
      },
    });

    expect(result).toBeNull();
  });

  it('uses overview defaults and bundles the latest ready memory artifacts', async () => {
    const getSelection = vi.fn().mockResolvedValue(
      memorySelection({
        id: 'snapshot-1',
        unresolvedIssues: [{ label: 'Articles', note: 'Still unstable.', priority: 'medium' }],
      }),
    );
    const listRecentReadyLessonMemoryByStudentId = vi.fn().mockResolvedValue([{ id: 'lesson-1' }]);
    const listRecentReadyHomeworkMemoryByStudentId = vi
      .fn()
      .mockResolvedValue([{ id: 'homework-1' }]);

    const result = await getStudentMemoryOverview({
      studentId: 'student-1',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue({ id: 'student-1' }),
        },
        lessonMemory: {
          list: vi.fn(),
          listRecentReadyByStudentId: listRecentReadyLessonMemoryByStudentId,
        },
        homeworkMemory: {
          list: vi.fn(),
          listRecentReadyByStudentId: listRecentReadyHomeworkMemoryByStudentId,
        },
        snapshots: {
          getSelection,
          list: vi.fn(),
        },
      },
    });

    expect(listRecentReadyLessonMemoryByStudentId).toHaveBeenCalledWith('student-1', {
      limit: 3,
    });
    expect(listRecentReadyHomeworkMemoryByStudentId).toHaveBeenCalledWith('student-1', {
      limit: 2,
    });
    expect(result).toMatchObject({
      studentId: 'student-1',
      latestReadyStudentMemorySnapshot: { id: 'snapshot-1' },
      recentReadyLessonMemory: [{ id: 'lesson-1' }],
      recentReadyHomeworkMemory: [{ id: 'homework-1' }],
      unresolvedIssues: [{ label: 'Articles', note: 'Still unstable.', priority: 'medium' }],
    });
  });

  it('returns paginated snapshot inspection for an existing student', async () => {
    const generationNotes = {
      strategy: 'full_rebuild_v1',
      inputTokenEstimate: 1234,
      promptByteLength: 4321,
      includedLessonMemoryCount: 2,
      includedHomeworkMemoryCount: 1,
    };
    const list = vi
      .fn()
      .mockResolvedValue([{ id: 'snapshot-1', status: 'ready', generationNotes }]);

    const result = await listStudentMemorySnapshotsForStudent({
      studentId: 'student-1',
      statuses: ['ready'],
      limit: 10,
      offset: 5,
      order: 'asc',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue({ id: 'student-1' }),
        },
        snapshots: {
          getSelection: vi.fn().mockResolvedValue(memorySelection(null)),
          list,
        },
      },
    });

    expect(list).toHaveBeenCalledWith({
      studentId: 'student-1',
      statuses: ['ready'],
      limit: 10,
      offset: 5,
      order: 'asc',
    });
    expect(result).toMatchObject({
      studentId: 'student-1',
      limit: 10,
      offset: 5,
      order: 'asc',
      statuses: ['ready'],
      items: [{ id: 'snapshot-1', status: 'ready', generationNotes }],
    });
  });

  it('returns paginated profile-candidate inspection with review-state filters', async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'candidate-1',
          status: 'pending_review',
          reviewState: 'deferred',
        },
      ],
      total: 1,
      limit: 10,
      offset: 0,
      order: 'asc',
    });

    const result = await listStudentProfileCandidatesForStudent({
      studentId: 'student-1',
      statuses: ['pending_review'],
      reviewStates: ['deferred'],
      limit: 10,
      offset: 0,
      order: 'asc',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue({ id: 'student-1' }),
        },
        profileCandidates: {
          list,
        },
      },
    });

    expect(list).toHaveBeenCalledWith({
      studentId: 'student-1',
      statuses: ['pending_review'],
      reviewStates: ['deferred'],
      limit: 10,
      offset: 0,
      order: 'asc',
    });
    expect(result).toMatchObject({
      studentId: 'student-1',
      statuses: ['pending_review'],
      reviewStates: ['deferred'],
      items: [{ id: 'candidate-1', reviewState: 'deferred' }],
      total: 1,
    });
  });

  it('builds compact memory health from snapshot notes, memory counts, failures, and candidates', async () => {
    const latestSnapshot = {
      id: 'snapshot-latest',
      status: 'failed',
      contentHash: 'hash-latest',
      generationNotes: {
        strategy: 'incremental_v1_1',
        trigger: 'lesson-memory-ready',
        parentSnapshotId: 'snapshot-parent',
        inputTokenEstimate: 18_500,
        promptByteLength: 74_000,
        includedLessonMemoryCount: 2,
        includedHomeworkMemoryCount: 1,
        coveredLessonMemoryCount: 9,
        coveredHomeworkMemoryCount: 4,
        materialChange: false,
        failureDetails: {
          message: 'Incremental snapshot prompt exceeded the hard input token budget.',
        },
        budgetDecision: {
          action: 'fail_before_provider',
          inputTokenEstimate: 36_200,
          promptByteLength: 144_800,
        },
        candidateRefresh: {
          requested: false,
          enqueueStatus: 'not_requested',
          reasons: [],
          triggerProfileWorthyStudentFactCount: 0,
          skippedNoProfileWorthyDeltaCount: 1,
        },
      },
    };
    const listSnapshots = vi.fn().mockResolvedValue([latestSnapshot]);
    const listLessonMemory = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'lesson-ready' }, { id: 'lesson-ready-2' }])
      .mockResolvedValueOnce([{ id: 'lesson-pending' }])
      .mockResolvedValueOnce([
        {
          id: 'lesson-failed',
          status: 'failed',
          generationNotes: { error: 'Lesson memory provider failed.' },
          generatedAt: new Date('2026-03-23T00:00:00.000Z'),
        },
      ]);
    const listHomeworkMemory = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'homework-ready' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'homework-failed',
          status: 'failed',
          generationNotes: { error: 'Homework memory extraction failed.' },
          generatedAt: new Date('2026-03-22T00:00:00.000Z'),
        },
      ]);
    const listCandidates = vi
      .fn()
      .mockResolvedValueOnce({ items: [], total: 3, limit: 1, offset: 0, order: 'desc' })
      .mockResolvedValueOnce({ items: [], total: 2, limit: 1, offset: 0, order: 'desc' })
      .mockResolvedValueOnce({ items: [], total: 1, limit: 1, offset: 0, order: 'desc' })
      .mockResolvedValueOnce({ items: [], total: 4, limit: 1, offset: 0, order: 'desc' });

    const result = await getStudentMemoryHealth({
      studentId: 'student-1',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue({ id: 'student-1' }),
        },
        lessonMemory: {
          list: listLessonMemory,
          listRecentReadyByStudentId: vi.fn(),
        },
        homeworkMemory: {
          list: listHomeworkMemory,
          listRecentReadyByStudentId: vi.fn(),
        },
        snapshots: {
          getSelection: vi.fn().mockResolvedValue(memorySelection(null)),
          list: listSnapshots,
        },
        profileCandidates: {
          list: listCandidates,
        },
      },
    });

    expect(listSnapshots).toHaveBeenCalledWith({
      studentId: 'student-1',
      limit: 1,
      offset: 0,
      order: 'desc',
    });
    expect(listLessonMemory).toHaveBeenNthCalledWith(1, {
      studentId: 'student-1',
      statuses: ['ready'],
      limit: 500,
      offset: 0,
      order: 'desc',
    });
    expect(listCandidates).toHaveBeenNthCalledWith(4, {
      studentId: 'student-1',
      reviewStates: ['deferred'],
      limit: 1,
      offset: 0,
      order: 'desc',
    });
    expect(result).toMatchObject({
      studentId: 'student-1',
      latestSnapshot: {
        id: 'snapshot-latest',
        status: 'failed',
        strategy: 'incremental_v1_1',
        trigger: 'lesson-memory-ready',
        parentSnapshotId: 'snapshot-parent',
        inputTokenEstimate: 18_500,
        promptByteLength: 74_000,
        includedLessonMemoryCount: 2,
        includedHomeworkMemoryCount: 1,
        coveredLessonMemoryCount: 9,
        coveredHomeworkMemoryCount: 4,
        contentHash: 'hash-latest',
        materialChange: false,
        budgetDecision: {
          action: 'fail_before_provider',
        },
        candidateRefresh: {
          requested: false,
          enqueueStatus: 'not_requested',
          skippedNoProfileWorthyDeltaCount: 1,
        },
      },
      memoryCounts: {
        lesson: {
          ready: { count: 2, capped: false, limit: 500 },
          pending: { count: 1, capped: false, limit: 500 },
          failed: { count: 1, capped: false, limit: 500 },
        },
        homework: {
          ready: { count: 1, capped: false, limit: 500 },
          pending: { count: 0, capped: false, limit: 500 },
          failed: { count: 1, capped: false, limit: 500 },
        },
      },
      latestFailedReason: {
        source: 'snapshot',
        message: 'Incremental snapshot prompt exceeded the hard input token budget.',
      },
      profileCandidateCounts: {
        pending: 3,
        approved: 2,
        rejected: 1,
        deferred: 4,
      },
    });
  });

  it('marks memory health counts as capped when the list limit is reached', async () => {
    const cappedReadyLessonMemory = Array.from({ length: 500 }, (_, index) => ({
      id: `lesson-ready-${index}`,
    }));
    const listCandidates = vi
      .fn()
      .mockResolvedValue({ items: [], total: 0, limit: 1, offset: 0, order: 'desc' });

    const result = await getStudentMemoryHealth({
      studentId: 'student-1',
      overrides: {
        students: {
          getById: vi.fn().mockResolvedValue({ id: 'student-1' }),
        },
        lessonMemory: {
          list: vi
            .fn()
            .mockResolvedValueOnce(cappedReadyLessonMemory)
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]),
          listRecentReadyByStudentId: vi.fn(),
        },
        homeworkMemory: {
          list: vi.fn().mockResolvedValue([]),
          listRecentReadyByStudentId: vi.fn(),
        },
        snapshots: {
          getSelection: vi.fn().mockResolvedValue(memorySelection(null)),
          list: vi.fn().mockResolvedValue([]),
        },
        profileCandidates: {
          list: listCandidates,
        },
      },
    });

    expect(result?.memoryCounts.lesson.ready).toEqual({
      count: 500,
      capped: true,
      limit: 500,
    });
    expect(result?.memoryCounts.lesson.pending).toEqual({
      count: 0,
      capped: false,
      limit: 500,
    });
  });
});

function memorySelection(snapshot: unknown) {
  return {
    snapshot,
    availability: {
      state: snapshot ? 'available' : 'absent',
      reason: snapshot ? 'verified_lineage' : 'no_established_snapshot',
      lessonReferenceCount: 0,
      homeworkReferenceCount: 0,
    },
  };
}
