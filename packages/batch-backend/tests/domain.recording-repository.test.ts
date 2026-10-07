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
          workspace_id: '33333333-3333-4333-8333-333333333333',
          source: 'manual_transcript',
          student_id: '22222222-2222-4222-8222-222222222222',
          source_path: 'Pasted lesson transcript',
          storage_uri: null,
          sha256: null,
          bytes: 24,
          duration_sec: null,
          channels: null,
          audio_topology: null,
          media_preparation_version: 'recording-media-v1',
          audio_lifecycle: 'not_retained',
          audio_deletion_requested_at: null,
          audio_deleted_at: null,
          audio_deletion_attempt_count: 0,
          audio_deletion_error_code: null,
          audio_deletion_next_attempt_at: null,
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
        workspaceId: '33333333-3333-4333-8333-333333333333',
        studentId: '22222222-2222-4222-8222-222222222222',
        sourcePath: 'Pasted lesson transcript',
        storageUri: null,
        audioLifecycle: 'not_retained',
        bytes: 24,
        mediaPreparationVersion: 'recording-media-v1',
        status: 'transcribed',
      },
      { client },
    );

    expect(result.source).toBe('manual_transcript');
    expect(result.mediaPreparationVersion).toBe('recording-media-v1');
    expect(query.mock.calls[0]?.[1]).toContain('recording-media-v1');
    expect(query).toHaveBeenCalledTimes(1);
    expect(mockWithPgClient).not.toHaveBeenCalled();
  });

  it('scopes authenticated recording and cache lookups by workspace', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    mockWithPgClient.mockImplementation(async (fn) => fn({ query }));
    const repository = await import('../src/domain/recording-repository.js');

    await repository.getRecordingByIdForWorkspace(
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    );
    await repository.listRecordingsBySha256ForWorkspace(
      'a'.repeat(64),
      '33333333-3333-4333-8333-333333333333',
    );

    expect(query.mock.calls[0]?.[0]).toContain('workspace_id = $2');
    expect(query.mock.calls[0]?.[1]).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(query.mock.calls[1]?.[0]).toContain('workspace_id = $2');
  });

  it('creates cache-hit recording and transcript lineage in one transaction', async () => {
    const now = new Date('2026-09-01T00:00:00.000Z');
    const recordingRow = {
      id: '11111111-1111-4111-8111-111111111111',
      workspace_id: '33333333-3333-4333-8333-333333333333',
      source: 'upload',
      student_id: '22222222-2222-4222-8222-222222222222',
      source_path: 'lesson.mp3',
      storage_uri: null,
      sha256: 'a'.repeat(64),
      bytes: 24,
      duration_sec: 60,
      channels: 1,
      audio_topology: 'mixed_recording',
      media_preparation_version: 'recording-media-v1',
      audio_lifecycle: 'not_retained',
      audio_deletion_requested_at: null,
      audio_deleted_at: null,
      audio_deletion_attempt_count: 0,
      audio_deletion_error_code: null,
      audio_deletion_next_attempt_at: null,
      status: 'transcribed',
      error: null,
      created_at: now,
      updated_at: now,
    };
    const transcriptRow = {
      id: '44444444-4444-4444-8444-444444444444',
      recording_id: recordingRow.id,
      storage_uri: 'local://transcripts/copied.txt',
      working_version: 1,
      content_hash: 'b'.repeat(64),
      raw_response_uri: null,
      mode: 'timeline',
      model: 'scribe_v2',
      language: 'auto',
      stt_provider: 'elevenlabs',
      fallback_used: false,
      summary_json: null,
      created_at: now,
      updated_at: now,
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [recordingRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [transcriptRow] })
      .mockResolvedValueOnce({ rows: [] });
    mockWithPgClient.mockImplementation(async (fn) => fn({ query }));
    const { insertCachedRecordingLineage } = await import('../src/domain/recording-repository.js');

    const result = await insertCachedRecordingLineage({
      recording: {
        id: recordingRow.id,
        workspaceId: recordingRow.workspace_id,
        source: 'upload',
        studentId: recordingRow.student_id,
        sourcePath: recordingRow.source_path,
        storageUri: null,
        audioLifecycle: 'not_retained',
        sha256: recordingRow.sha256,
        bytes: recordingRow.bytes,
        durationSec: recordingRow.duration_sec,
        channels: recordingRow.channels,
        audioTopology: 'mixed_recording',
        mediaPreparationVersion: 'recording-media-v1',
        status: 'transcribed',
      },
      transcript: {
        id: transcriptRow.id,
        recordingId: recordingRow.id,
        storageUri: transcriptRow.storage_uri,
        workingVersion: 1,
        contentHash: transcriptRow.content_hash,
        rawResponseUri: null,
        mode: 'timeline',
        model: 'scribe_v2',
        language: 'auto',
        sttProvider: 'elevenlabs',
        fallbackUsed: false,
      },
    });

    expect(result.recording.audioLifecycle).toBe('not_retained');
    expect(result.recording.mediaPreparationVersion).toBe('recording-media-v1');
    expect(result.transcript.rawResponseUri).toBeNull();
    expect(query.mock.calls.map(([sql]) => String(sql).trim())).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO recordings'),
      expect.stringContaining('FOR UPDATE OF s'),
      expect.stringContaining('INSERT INTO transcripts'),
      'COMMIT',
    ]);
  });
});
