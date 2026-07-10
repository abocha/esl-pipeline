import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockWithPgClient = vi.fn();

vi.mock('../src/infrastructure/db.js', () => ({
  withPgClient: mockWithPgClient,
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

describe('domain/recording-repository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses a supplied PostgreSQL client for an insert', async () => {
    const now = new Date('2026-07-10T00:00:00.000Z');
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          source: 'manual_transcript',
          student_id: '22222222-2222-4222-8222-222222222222',
          source_path: 'Pasted lesson transcript',
          storage_uri: 'local://transcripts/transcript.txt',
          sha256: null,
          bytes: 24,
          duration_sec: null,
          channels: null,
          status: 'transcribed',
          error: null,
          created_at: now,
          updated_at: now,
        },
      ],
    });
    const client = { query } as unknown as PoolClient;
    const { insertRecording } = await import('../src/domain/recording-repository.js');

    const result = await insertRecording(
      {
        id: '11111111-1111-4111-8111-111111111111',
        source: 'manual_transcript',
        studentId: '22222222-2222-4222-8222-222222222222',
        sourcePath: 'Pasted lesson transcript',
        storageUri: 'local://transcripts/transcript.txt',
        bytes: 24,
        status: 'transcribed',
      },
      { client },
    );

    expect(result.source).toBe('manual_transcript');
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockWithPgClient).not.toHaveBeenCalled();
  });
});
