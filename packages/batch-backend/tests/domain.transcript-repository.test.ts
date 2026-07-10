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
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockWithPgClient).not.toHaveBeenCalled();
  });
});
