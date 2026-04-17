import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const mockGetJobById = vi.fn();
const mockListJobActionHistoryForJob = vi.fn();
const mockWithPgClient = vi.fn();
const mockGetPromptPackageLineage = vi.fn();

vi.mock('../src/domain/job-repository.js', () => ({
  getJobById: mockGetJobById,
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
      notionUrl: null,
      anytypeUrl: null,
      htmlUrl: null,
      error: 'Voice generation timed out while calling provider for this lesson',
    });
    mockListJobActionHistoryForJob.mockResolvedValue([]);
    mockWithPgClient.mockImplementation(async (fn: (client: { query: () => unknown }) => unknown) =>
      fn({
        query: vi.fn().mockResolvedValue({ rows: [] }),
      }),
    );
    mockGetPromptPackageLineage.mockResolvedValue(null);

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    const result = await getJobProvenance('job-1');

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
      notionUrl: null,
      anytypeUrl: null,
      htmlUrl: null,
      error: null,
    });
    mockListJobActionHistoryForJob.mockResolvedValue([]);
    mockWithPgClient.mockImplementation(async (fn: (client: { query: () => unknown }) => unknown) =>
      fn({
        query: vi.fn().mockResolvedValue({ rows: [] }),
      }),
    );
    mockGetPromptPackageLineage.mockResolvedValue(null);

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    const result = await getJobProvenance('job-2');

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
      notionUrl: null,
      anytypeUrl: null,
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
      notionUrl: null,
      anytypeUrl: null,
      htmlUrl: null,
      error: null,
    });
    mockListJobActionHistoryForJob.mockResolvedValue([]);
    mockWithPgClient.mockImplementation(async (fn: (client: { query: () => unknown }) => unknown) =>
      fn({
        query: vi.fn().mockResolvedValue({ rows: [] }),
      }),
    );
    mockGetPromptPackageLineage.mockResolvedValue(null);

    const { getJobProvenance } = await import('../src/application/get-job-provenance.js');
    const result = await getJobProvenance('job-3');

    expect(result?.pronunciationWarnings).toEqual([
      {
        code: 'rerun_pronunciation_chunk_unknown_previous_provider',
        message:
          'Pronunciation chunk rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
      },
    ]);
  });
});
