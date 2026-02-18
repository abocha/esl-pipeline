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
});
