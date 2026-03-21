import type { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  approveStudentProfileCandidate,
  getStudentMemoryOverview,
  listStudentProfileCandidates,
  listStudentHomeworkMemoryEntries,
  listStudentLessonMemoryEntries,
  listStudentMemorySnapshots,
} from './api';
import apiClient, { buildApiProxyPath, handleApiError, isAuthError } from './api-client';

vi.mock('./api-client', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
  buildApiProxyPath: vi.fn((path: string) => `/api${path}`),
  getApiAuthToken: vi.fn(() => null),
  handleApiError: vi.fn((error: { response?: { status?: number } }) => {
    const status = error.response?.status ?? 0;
    return `HTTP ${status}`;
  }),
  isAuthError: vi.fn(
    (error: { response?: { status?: number } }) =>
      error.response?.status === 401 || error.response?.status === 403,
  ),
}));

function makeAxiosError(args: {
  status?: number;
  data?: unknown;
  message?: string;
}): AxiosError {
  return {
    name: 'AxiosError',
    message: args.message ?? 'request failed',
    isAxiosError: true,
    config: {} as AxiosError['config'],
    response:
      args.status === undefined
        ? undefined
        : ({
            status: args.status,
            statusText: String(args.status),
            headers: {},
            config: {},
            data: args.data,
          } as AxiosError['response']),
    toJSON: () => ({}),
  } as AxiosError;
}

describe('utils/api student memory fetchers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads the student memory overview with query params', async () => {
    const response = { studentId: 'student-1', latestReadyStudentMemorySnapshot: null };
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: response } as never);

    const result = await getStudentMemoryOverview('student-1', {
      lessonLimit: 3,
      homeworkLimit: 2,
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith('/students/student-1/memory');
    expect(apiClient.get).toHaveBeenCalledWith('/api/students/student-1/memory', {
      params: {
        lessonLimit: 3,
        homeworkLimit: 2,
      },
    });
    expect(result).toEqual(response);
  });

  it('builds student lesson-memory list URLs with status filters', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { items: [] } } as never);

    await listStudentLessonMemoryEntries('student-1', {
      status: ['ready', 'failed'],
      limit: 10,
      offset: 5,
      order: 'asc',
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith(
      '/students/student-1/lesson-memory?status=ready%2Cfailed&limit=10&offset=5&order=asc',
    );
  });

  it('builds student homework-memory list URLs with status filters', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { items: [] } } as never);

    await listStudentHomeworkMemoryEntries('student-1', {
      status: 'ready',
      limit: 5,
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith(
      '/students/student-1/homework-memory?status=ready&limit=5',
    );
  });

  it('builds student memory-snapshot list URLs with filters', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({ data: { items: [] } } as never);

    await listStudentMemorySnapshots('student-1', {
      status: ['ready', 'failed'],
      order: 'desc',
    });

    expect(buildApiProxyPath).toHaveBeenCalledWith(
      '/students/student-1/memory-snapshots?status=ready%2Cfailed&order=desc',
    );
  });

  it('maps backend profile candidate DTOs into the workspace shape', async () => {
    vi.mocked(apiClient.get).mockResolvedValueOnce({
      data: {
        studentId: 'student-1',
        items: [
          {
            id: 'candidate-1',
            studentId: 'student-1',
            fact: 'Uses English in sprint planning and client calls.',
            approvedFact: 'Uses English with product, engineering, and client teams.',
            category: 'work context',
            targetSection: 'work_communication_context',
            authority: 'teacher_confirmed',
            confidence: 'high',
            evidence: [],
            sourceSnapshotId: 'snapshot-1',
            sourceLessonMemoryIds: ['lesson-1', 'lesson-2'],
            status: 'approved',
            reviewState: 'approved',
            reviewerId: 'user-1',
            reviewerNote: null,
            reviewedAt: '2026-03-22T00:00:00.000Z',
            promotedRevisionId: null,
            promotedAt: null,
            supersededById: null,
            createdAt: '2026-03-22T00:00:00.000Z',
            updatedAt: '2026-03-22T00:00:00.000Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
        order: 'desc',
      },
    } as never);

    const result = await listStudentProfileCandidates('student-1');

    expect(result.items[0]).toMatchObject({
      proposedFact: 'Uses English in sprint planning and client calls.',
      approvedFactText: 'Uses English with product, engineering, and client teams.',
      targetSection: 'work_communication_context',
      sourceSummary: 'Latest student-memory snapshot + 2 lesson memory entries',
    });
  });

  it('posts edited approval text using approvedFactText', async () => {
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: {
        id: 'candidate-1',
        studentId: 'student-1',
        fact: 'Uses English in sprint planning and client calls.',
        approvedFact: 'Uses English with product, engineering, and client teams.',
        category: 'work context',
        targetSection: 'work_communication_context',
        authority: 'teacher_confirmed',
        confidence: 'high',
        evidence: [],
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-1'],
        status: 'approved',
        reviewState: 'approved',
        reviewerId: 'user-1',
        reviewerNote: 'Durable enough for profile',
        reviewedAt: '2026-03-22T00:00:00.000Z',
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: '2026-03-22T00:00:00.000Z',
        updatedAt: '2026-03-22T00:00:00.000Z',
      },
    } as never);

    await approveStudentProfileCandidate('student-1', 'candidate-1', {
      approvedFactText: 'Uses English with product, engineering, and client teams.',
      reviewerNote: 'Durable enough for profile',
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/api/students/student-1/profile-candidates/candidate-1/approve',
      {
        approvedFactText: 'Uses English with product, engineering, and client teams.',
        reviewerNote: 'Durable enough for profile',
      },
    );
  });

  it('maps auth failures on overview fetches to a login-required message', async () => {
    vi.mocked(apiClient.get).mockRejectedValueOnce(
      makeAxiosError({
        status: 401,
        data: { error: 'unauthorized', message: 'Unauthorized' },
      }),
    );

    await expect(getStudentMemoryOverview('student-1')).rejects.toThrow(
      'Authentication required. Please login to view student memory.',
    );
    expect(isAuthError).toHaveBeenCalledTimes(1);
  });

  it('falls back to generic API handling for snapshot list failures', async () => {
    vi.mocked(handleApiError).mockReturnValueOnce('Snapshots unavailable');
    vi.mocked(apiClient.get).mockRejectedValueOnce(
      makeAxiosError({
        status: 500,
        data: { error: 'internal_error' },
      }),
    );

    await expect(listStudentMemorySnapshots('student-1')).rejects.toThrow('Snapshots unavailable');
  });
});
