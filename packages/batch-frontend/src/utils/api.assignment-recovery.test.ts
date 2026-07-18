import type { AxiosError } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ArtifactWorkingConflictApiError,
  updateAssignmentSessionRecovery,
  updateDraft,
  updateRecordingTranscript,
} from './api';
import apiClient from './api-client';

vi.mock('./api-client', () => ({
  __esModule: true,
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
  },
  buildApiProxyPath: vi.fn((path: string) => `/api${path}`),
  getApiAuthToken: vi.fn(() => null),
  handleApiError: vi.fn(
    (error: { response?: { status?: number } }) => `HTTP ${error.response?.status ?? 0}`,
  ),
  isAuthError: vi.fn(
    (error: { response?: { status?: number } }) =>
      error.response?.status === 401 || error.response?.status === 403,
  ),
}));

function makeAxiosError(status?: number, data?: unknown): AxiosError {
  return {
    name: 'AxiosError',
    message: 'request failed',
    isAxiosError: true,
    config: {} as AxiosError['config'],
    response:
      status === undefined
        ? undefined
        : ({ status, statusText: String(status), headers: {}, config: {}, data } as never),
    toJSON: () => ({}),
  } as AxiosError;
}

describe('assignment recovery API', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('preserves the typed transcript working conflict', async () => {
    vi.mocked(apiClient.put).mockRejectedValueOnce(
      makeAxiosError(409, {
        code: 'artifact_working_conflict',
        artifact: { workingVersion: 4, contentHash: 'a'.repeat(64) },
      }),
    );

    await expect(updateRecordingTranscript('rec-1', 'local', 3)).rejects.toMatchObject({
      name: 'ArtifactWorkingConflictApiError',
      latestArtifact: { workingVersion: 4, contentHash: 'a'.repeat(64) },
    });
    expect(apiClient.put).toHaveBeenCalledTimes(1);
  });

  it('retries a transient draft recovery twice with the same CAS request', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.put)
      .mockRejectedValueOnce(makeAxiosError(503))
      .mockRejectedValueOnce(makeAxiosError(429))
      .mockResolvedValueOnce({ data: { id: 'draft-1', workingVersion: 2 } } as never);

    const resultPromise = updateDraft('draft-1', 'local', 1);
    await vi.runAllTimersAsync();
    await expect(resultPromise).resolves.toMatchObject({ workingVersion: 2 });
    expect(apiClient.put).toHaveBeenCalledTimes(3);
    expect(vi.mocked(apiClient.put).mock.calls[0]).toEqual(vi.mocked(apiClient.put).mock.calls[2]);
  });

  it('does not retry a session revision conflict', async () => {
    vi.mocked(apiClient.patch).mockRejectedValueOnce(
      makeAxiosError(409, {
        code: 'assignment_session_revision_conflict',
        session: { id: 'session-1', revision: 2 },
      }),
    );

    await expect(
      updateAssignmentSessionRecovery('session-1', { expectedRevision: 1, patch: {} }),
    ).rejects.toMatchObject({ name: 'AssignmentSessionConflictApiError' });
    expect(apiClient.patch).toHaveBeenCalledTimes(1);
  });

  it('exports a concrete artifact conflict error class for UI reconciliation', () => {
    const error = new ArtifactWorkingConflictApiError({
      workingVersion: 2,
      contentHash: 'b'.repeat(64),
    });
    expect(error.latestArtifact.workingVersion).toBe(2);
  });
});
