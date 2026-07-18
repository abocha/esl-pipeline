import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWithPgClient = vi.fn();

vi.mock('../src/infrastructure/db.js', () => ({ withPgClient: mockWithPgClient }));
vi.mock('../src/infrastructure/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

const latestRow = {
  id: '44444444-4444-4444-8444-444444444444',
  prompt_package_id: '55555555-5555-4555-8555-555555555555',
  student_id: null,
  lesson_id: null,
  storage_uri: 'local://drafts/d/content/b.md',
  working_version: 2,
  content_hash: 'b'.repeat(64),
  created_by: null,
  created_at: new Date('2026-07-10T00:00:00.000Z'),
  updated_at: new Date('2026-07-10T00:10:00.000Z'),
};

describe('domain/draft-repository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CAS-updates working content and reports the winning row on stale writes', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [latestRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [latestRow] });
    mockWithPgClient.mockImplementation(async (callback) =>
      callback({ query } as unknown as PoolClient),
    );
    const { updateDraftWorkingContent } = await import('../src/domain/draft-repository.js');

    const updated = await updateDraftWorkingContent({
      id: latestRow.id,
      expectedWorkingVersion: 1,
      storageUri: latestRow.storage_uri,
      contentHash: latestRow.content_hash,
    });
    expect(updated).toMatchObject({ workingVersion: 2, contentHash: latestRow.content_hash });

    await expect(
      updateDraftWorkingContent({
        id: latestRow.id,
        expectedWorkingVersion: 1,
        storageUri: 'local://drafts/d/content/c.md',
        contentHash: 'c'.repeat(64),
      }),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_WORKING_CONFLICT',
      latest: expect.objectContaining({ workingVersion: 2, contentHash: latestRow.content_hash }),
    });
  });

  it('locks the draft row used by confirmation', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [latestRow] });
    const client = { query } as unknown as PoolClient;
    const { getDraftByIdForUpdate } = await import('../src/domain/draft-repository.js');

    await expect(getDraftByIdForUpdate(client, latestRow.id)).resolves.toMatchObject({
      id: latestRow.id,
      workingVersion: 2,
    });
    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE');
  });
});
