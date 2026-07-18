import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWithPgClient = vi.fn();

vi.mock('../src/infrastructure/db.js', () => ({
  withPgClient: mockWithPgClient,
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

describe('domain/transcript-repository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses a supplied PostgreSQL client for an insert', async () => {
    const now = new Date('2026-07-10T00:00:00.000Z');
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          recording_id: '11111111-1111-4111-8111-111111111111',
          storage_uri: 'local://transcripts/transcript.txt',
          working_version: 1,
          content_hash: 'a'.repeat(64),
          raw_response_uri: null,
          mode: 'timeline',
          model: 'manual-entry',
          language: 'und',
          stt_provider: 'manual',
          fallback_used: false,
          summary_json: { provider: 'manual', origin: 'tutor_paste' },
          created_at: now,
          updated_at: now,
        },
      ],
    });
    const client = { query } as unknown as PoolClient;
    const { insertTranscript } = await import('../src/domain/transcript-repository.js');

    const result = await insertTranscript(
      {
        id: '33333333-3333-4333-8333-333333333333',
        recordingId: '11111111-1111-4111-8111-111111111111',
        storageUri: 'local://transcripts/transcript.txt',
        workingVersion: 1,
        contentHash: 'a'.repeat(64),
        mode: 'timeline',
        model: 'manual-entry',
        language: 'und',
        sttProvider: 'manual',
        fallbackUsed: false,
        summaryJson: { provider: 'manual', origin: 'tutor_paste' },
      },
      { client },
    );

    expect(result.sttProvider).toBe('manual');
    expect(result.workingVersion).toBe(1);
    expect(result.contentHash).toBe('a'.repeat(64));
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockWithPgClient).not.toHaveBeenCalled();
  });

  it('CAS-updates working content and reports the winning row on stale writes', async () => {
    const now = new Date('2026-07-10T00:00:00.000Z');
    const latestRow = {
      id: '33333333-3333-4333-8333-333333333333',
      recording_id: '11111111-1111-4111-8111-111111111111',
      storage_uri: 'local://transcripts/t/content/b.txt',
      working_version: 2,
      content_hash: 'b'.repeat(64),
      raw_response_uri: null,
      mode: 'timeline',
      model: 'manual-entry',
      language: 'und',
      stt_provider: 'manual',
      fallback_used: false,
      summary_json: null,
      created_at: now,
      updated_at: now,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [latestRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [latestRow] });
    mockWithPgClient.mockImplementation(async (callback) =>
      callback({ query } as unknown as PoolClient),
    );
    const { updateTranscriptWorkingContent } = await import(
      '../src/domain/transcript-repository.js'
    );

    const updated = await updateTranscriptWorkingContent({
      id: latestRow.id,
      expectedWorkingVersion: 1,
      storageUri: latestRow.storage_uri,
      contentHash: latestRow.content_hash,
    });
    expect(updated).toMatchObject({ workingVersion: 2, contentHash: latestRow.content_hash });

    await expect(
      updateTranscriptWorkingContent({
        id: latestRow.id,
        expectedWorkingVersion: 1,
        storageUri: 'local://transcripts/t/content/c.txt',
        contentHash: 'c'.repeat(64),
      }),
    ).rejects.toMatchObject({
      code: 'ARTIFACT_WORKING_CONFLICT',
      latest: expect.objectContaining({ workingVersion: 2, contentHash: latestRow.content_hash }),
    });
  });

  it('excludes legacy rows without a complete working-content tuple from cache reuse', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    mockWithPgClient.mockImplementation(async (callback) =>
      callback({ query } as unknown as PoolClient),
    );
    const { listLatestTranscriptsByRecordingIds } = await import(
      '../src/domain/transcript-repository.js'
    );

    await listLatestTranscriptsByRecordingIds(['11111111-1111-4111-8111-111111111111']);

    expect(query.mock.calls[0]?.[0]).toContain('working_version IS NOT NULL');
    expect(query.mock.calls[0]?.[0]).toContain('content_hash IS NOT NULL');
  });
});
