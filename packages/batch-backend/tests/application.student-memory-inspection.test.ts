import { describe, expect, it, vi } from 'vitest';

import {
  getStudentMemoryOverview,
  listStudentMemorySnapshotsForStudent,
  listStudentProfileCandidatesForStudent,
} from '../src/application/student-memory-inspection.js';

describe('application/student-memory-inspection', () => {
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
    const getLatestReadyByStudentId = vi.fn().mockResolvedValue({
      id: 'snapshot-1',
      unresolvedIssues: [{ label: 'Articles', note: 'Still unstable.', priority: 'medium' }],
    });
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
          getLatestReadyByStudentId,
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
    const list = vi.fn().mockResolvedValue([{ id: 'snapshot-1', status: 'ready' }]);

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
          getLatestReadyByStudentId: vi.fn(),
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
      items: [{ id: 'snapshot-1', status: 'ready' }],
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
});
