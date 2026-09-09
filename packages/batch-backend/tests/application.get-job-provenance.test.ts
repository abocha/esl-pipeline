import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetJobById = vi.fn();
const mockGetJobWorkspaceAuthority = vi.fn();
const mockListJobActionHistoryForJob = vi.fn();
const mockWithPgClient = vi.fn();
const mockGetPromptPackageLineage = vi.fn();

vi.mock('../src/domain/job-repository.js', () => ({
  getJobById: mockGetJobById,
  getJobWorkspaceAuthority: mockGetJobWorkspaceAuthority,
}));

vi.mock('../src/domain/job-action-history-repository.js', () => ({
  listJobActionHistoryForJob: mockListJobActionHistoryForJob,
}));

vi.mock('../src/infrastructure/db.js', () => ({
  withPgClient: mockWithPgClient,
}));

vi.mock('../src/application/get-prompt-package.js', () => ({
  getPromptPackageLineage: mockGetPromptPackageLineage,
}));

describe('application/get-job-provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetJobWorkspaceAuthority.mockResolvedValue({
      mode: 'recording_backed',
      recordingId: 'recording-1',
    });
  });

  it('does not materialize job or lineage helpers before workspace authority succeeds', async () => {
    mockGetJobWorkspaceAuthority.mockResolvedValueOnce(null);

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    await expect(
      getJobProvenance('foreign-or-absent-job', 'workspace-1', 'user-1'),
    ).resolves.toBeNull();

    expect(mockGetJobById).not.toHaveBeenCalled();
    expect(mockWithPgClient).not.toHaveBeenCalled();
    expect(mockListJobActionHistoryForJob).not.toHaveBeenCalled();
    expect(mockGetPromptPackageLineage).not.toHaveBeenCalled();
    expect(mockGetJobWorkspaceAuthority).toHaveBeenCalledWith(
      'foreign-or-absent-job',
      'workspace-1',
      'user-1',
    );
  });

  it('returns provenance for an owner-authorized job with intentionally null recording lineage', async () => {
    mockGetJobWorkspaceAuthority.mockResolvedValueOnce({
      mode: 'standalone_owner',
      recordingId: null,
    });
    mockGetJobById.mockResolvedValueOnce({
      id: 'standalone-job',
      state: 'queued',
      createdAt: new Date('2026-09-03T00:00:00.000Z'),
      updatedAt: new Date('2026-09-03T00:00:00.000Z'),
      startedAt: null,
      finishedAt: null,
      sourceJobId: null,
      manifestPath: null,
      htmlUrl: null,
      error: null,
    });
    mockListJobActionHistoryForJob.mockResolvedValue([]);
    mockWithPgClient.mockImplementation(async (fn: (client: { query: () => unknown }) => unknown) =>
      fn({ query: vi.fn().mockResolvedValue({ rows: [{}] }) }),
    );

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    await expect(
      getJobProvenance('standalone-job', 'workspace-1', 'user-1'),
    ).resolves.toMatchObject({
      job: { id: 'standalone-job' },
      recording: null,
      transcript: null,
      promptPackage: null,
      draft: null,
    });
  });

  it.each([
    'foreign transcript_id',
    'foreign prompt_package_id',
    'foreign draft_id',
    'foreign source_job_id',
    'foreign action/history job lineage',
  ])('rejects owned jobs with %s before following rich lineage', async () => {
    mockGetJobWorkspaceAuthority.mockResolvedValueOnce(null);

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    await expect(getJobProvenance('mixed-job', 'workspace-1', 'user-1')).resolves.toBeNull();

    expect(mockGetJobById).not.toHaveBeenCalled();
    expect(mockWithPgClient).not.toHaveBeenCalled();
    expect(mockListJobActionHistoryForJob).not.toHaveBeenCalled();
    expect(mockGetPromptPackageLineage).not.toHaveBeenCalled();
  });

  it('surfaces inferred providerError details for untagged provider failures', async () => {
    mockGetJobById.mockResolvedValueOnce({
      id: 'job-1',
      state: 'failed',
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
      updatedAt: new Date('2024-03-01T00:01:00.000Z'),
      startedAt: new Date('2024-03-01T00:00:10.000Z'),
      finishedAt: new Date('2024-03-01T00:01:00.000Z'),
      sourceJobId: null,
      manifestPath: null,
      htmlUrl: null,
      error: 'Voice generation timed out while calling provider for this lesson',
    });
    mockListJobActionHistoryForJob.mockResolvedValue([]);
    mockWithPgClient.mockImplementation(async (fn: (client: { query: () => unknown }) => unknown) =>
      fn({
        query: vi.fn().mockResolvedValue({ rows: [{ recording_id: 'recording-1' }] }),
      }),
    );
    mockGetPromptPackageLineage.mockResolvedValue(null);

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    const result = await getJobProvenance('job-1', 'workspace-1', 'user-1');

    expect(result?.job.providerError).toEqual({
      category: 'provider_timeout',
      message: 'Voice generation timed out while calling provider for this lesson',
      providerStatus: undefined,
      actionableHint: 'Retry with smaller chunks or increased provider timeout settings.',
    });
  });

  it('reads tts metadata from canonical audioArtifacts.studyText manifest path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'job-provenance-'));
    const manifestPath = join(dir, 'job.manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          audioArtifacts: {
            studyText: {
              tts: {
                provider: 'elevenlabs',
                generatedCharacters: 1200,
                cachedCharacters: 300,
                costPer1kCharsUsd: 0.3,
                estimatedSpendUsd: 0.45,
              },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    mockGetJobById.mockResolvedValueOnce({
      id: 'job-2',
      state: 'succeeded',
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
      updatedAt: new Date('2024-03-01T00:02:00.000Z'),
      startedAt: new Date('2024-03-01T00:00:30.000Z'),
      finishedAt: new Date('2024-03-01T00:02:00.000Z'),
      sourceJobId: null,
      manifestPath,
      htmlUrl: null,
      error: null,
    });
    mockListJobActionHistoryForJob.mockResolvedValue([]);
    mockWithPgClient.mockImplementation(async (fn: (client: { query: () => unknown }) => unknown) =>
      fn({
        query: vi.fn().mockResolvedValue({ rows: [{ recording_id: 'recording-1' }] }),
      }),
    );
    mockGetPromptPackageLineage.mockResolvedValue(null);

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    const result = await getJobProvenance('job-2', 'workspace-1', 'user-1');

    expect(result?.tts).toEqual({
      provider: 'elevenlabs',
      generatedCharacters: 1200,
      cachedCharacters: 300,
      totalCharacters: 1500,
      cacheHitRatio: 0.2,
      costPer1kCharsUsd: 0.3,
      estimatedSpendUsd: 0.45,
    });
    expect(result?.pronunciationWarnings).toEqual([]);
  });

  it('reads pronunciation warnings from the manifest for support-facing provenance', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'job-provenance-'));
    const manifestPath = join(dir, 'job.manifest.json');
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          audioArtifacts: {
            pronunciation: {
              warnings: [
                {
                  code: 'rerun_pronunciation_chunk_unknown_previous_provider',
                  message:
                    'Pronunciation chunk rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
                },
              ],
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    mockGetJobById.mockResolvedValueOnce({
      id: 'job-3',
      state: 'succeeded',
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
      updatedAt: new Date('2024-03-01T00:02:00.000Z'),
      startedAt: new Date('2024-03-01T00:00:30.000Z'),
      finishedAt: new Date('2024-03-01T00:02:00.000Z'),
      sourceJobId: 'job-2',
      manifestPath,
      htmlUrl: null,
      error: null,
    });
    mockGetJobById.mockResolvedValueOnce({
      id: 'job-2',
      state: 'succeeded',
      createdAt: new Date('2024-03-01T00:00:00.000Z'),
      updatedAt: new Date('2024-03-01T00:01:00.000Z'),
      startedAt: new Date('2024-03-01T00:00:10.000Z'),
      finishedAt: new Date('2024-03-01T00:01:00.000Z'),
      sourceJobId: null,
      manifestPath: null,
      htmlUrl: null,
      error: null,
    });
    mockListJobActionHistoryForJob.mockResolvedValue([]);
    mockWithPgClient.mockImplementation(async (fn: (client: { query: () => unknown }) => unknown) =>
      fn({
        query: vi.fn().mockResolvedValue({ rows: [{ recording_id: 'recording-1' }] }),
      }),
    );
    mockGetPromptPackageLineage.mockResolvedValue(null);

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    const result = await getJobProvenance('job-3', 'workspace-1', 'user-1');

    expect(result?.pronunciationWarnings).toEqual([
      {
        code: 'rerun_pronunciation_chunk_unknown_previous_provider',
        message:
          'Pronunciation chunk rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
      },
    ]);
  });
});
