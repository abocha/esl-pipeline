import type { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getStudentMemoryOverview,
  listStudentHomeworkMemoryEntries,
  listStudentLessonMemoryEntries,
  listStudentMemorySnapshots,
} from './api';
import apiClient, { buildApiProxyPath, handleApiError, isAuthError } from './api-client';

vi.mock('./api-client', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
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
