import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  student: vi.fn(),
  workspace: vi.fn(),
  historical: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('../src/domain/assignment-session-repository.js', () => ({
  getAssignmentSessionByIdForUser: mocks.session,
}));
vi.mock('../src/domain/student-repository.js', () => ({ getStudentById: mocks.student }));
vi.mock('../src/application/workspace-context.js', () => ({
  resolvePrimaryWorkspaceIdForUser: mocks.workspace,
}));
vi.mock('../src/application/historical-assignment.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/application/historical-assignment.js')>()),
  isHistoricalAssignmentSession: mocks.historical,
}));
vi.mock('../src/infrastructure/material-transcript.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/infrastructure/material-transcript.js')>()),
  fetchYouTubeMaterialTranscript: mocks.fetch,
}));

import { fetchAssignmentMaterialTranscript } from '../src/application/fetch-assignment-material-transcript.js';
import type { BatchBackendConfig } from '../src/config/env.js';

const url = 'https://youtu.be/abc123XYZ_0';
const config = {
  materialTranscript: { apiKey: 'test-only', timeoutMs: 500 },
} as BatchBackendConfig;

describe('authorized assignment material retrieval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.mockResolvedValue({
      id: 'session',
      studentId: 'student',
      confirmedStep: 'source',
    });
    mocks.workspace.mockResolvedValue('workspace');
    mocks.student.mockResolvedValue({ id: 'student' });
    mocks.historical.mockResolvedValue(false);
    mocks.fetch.mockResolvedValue({ sourceUrl: url, sourceText: 'Useful content.' });
  });

  it('authorizes the session, workspace and active student before spending a credit', async () => {
    await fetchAssignmentMaterialTranscript('user', 'session', url, config);
    expect(mocks.session).toHaveBeenCalledWith('session', 'user');
    expect(mocks.workspace).toHaveBeenCalledWith('user');
    expect(mocks.student).toHaveBeenCalledWith('student', { workspaceId: 'workspace' });
    expect(mocks.fetch).toHaveBeenCalledWith(url, config.materialTranscript);
    expect(mocks.fetch.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.student.mock.invocationCallOrder[0]!,
    );
  });

  it('does not inspect a student or fetch for a missing or foreign session', async () => {
    mocks.session.mockResolvedValue(null);
    await expect(
      fetchAssignmentMaterialTranscript('user', 'foreign', url, config),
    ).resolves.toBeNull();
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not fetch for an archived/missing/foreign-workspace student', async () => {
    mocks.student.mockResolvedValue(null);
    await expect(
      fetchAssignmentMaterialTranscript('user', 'session', url, config),
    ).resolves.toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('preserves historical and shared assignment read-only boundaries', async () => {
    mocks.historical.mockResolvedValue(true);
    await expect(
      fetchAssignmentMaterialTranscript('user', 'session', url, config),
    ).rejects.toMatchObject({ code: 'legacy_assignment_read_only' });
    mocks.historical.mockResolvedValue(false);
    mocks.session.mockResolvedValue({ studentId: 'student', confirmedStep: 'share' });
    await expect(
      fetchAssignmentMaterialTranscript('user', 'session', url, config),
    ).rejects.toMatchObject({ code: 'assignment_read_only' });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('shares duplicate in-flight video requests and rejects a different video while busy', async () => {
    let resolve!: (value: { sourceUrl: string; sourceText: string }) => void;
    mocks.fetch.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const first = fetchAssignmentMaterialTranscript('user', 'session', url, config);
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const second = fetchAssignmentMaterialTranscript(
      'user',
      'session',
      'https://www.youtube.com/watch?v=abc123XYZ_0&t=12',
      config,
    );
    await expect(
      fetchAssignmentMaterialTranscript('user', 'session', 'https://youtu.be/def123XYZ_0', config),
    ).rejects.toMatchObject({ code: 'transcript_in_progress' });
    resolve({ sourceUrl: url, sourceText: 'Saved once.' });
    await expect(first).resolves.toMatchObject({ sourceText: 'Saved once.' });
    await expect(second).resolves.toMatchObject({ sourceText: 'Saved once.' });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('releases failed retrievals so an explicit retry can succeed', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('provider failed'));
    await expect(fetchAssignmentMaterialTranscript('user', 'session', url, config)).rejects.toThrow(
      'provider failed',
    );
    await expect(
      fetchAssignmentMaterialTranscript('user', 'session', url, config),
    ).resolves.toMatchObject({ sourceText: 'Useful content.' });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
});
