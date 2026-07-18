import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

const putTranscript = vi.fn();
const deleteStored = vi.fn();

const storage = {
  putTranscript,
  delete: deleteStored,
} as unknown as TranscriptionStorage;

describe('application/ingest-manual-transcript-source', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putTranscript.mockResolvedValue({
      uri: 'local://transcripts/transcript-id.txt',
      bytes: 25,
      sha256: 'transcript-sha',
    });
    deleteStored.mockResolvedValue(undefined);
  });

  it('stores trimmed text and persists manual provenance', async () => {
    const persist = vi.fn(async (params) => ({
      recording: {
        id: params.recordingId,
        source: 'manual_transcript' as const,
        studentId: params.studentId,
        sourcePath: params.displayName,
        storageUri: params.storageUri,
        sha256: null,
        bytes: params.bytes,
        durationSec: null,
        channels: null,
        status: 'transcribed' as const,
        error: null,
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
      transcript: {
        id: params.transcriptId,
        recordingId: params.recordingId,
        storageUri: params.storageUri,
        workingVersion: params.workingVersion,
        contentHash: params.contentHash,
        rawResponseUri: null,
        mode: 'timeline' as const,
        model: 'manual-entry',
        language: 'und',
        sttProvider: 'manual' as const,
        fallbackUsed: false,
        summaryJson: { provider: 'manual', origin: 'tutor_paste' },
        createdAt: new Date('2026-07-10T00:00:00.000Z'),
        updatedAt: new Date('2026-07-10T00:00:00.000Z'),
      },
    }));
    const { ingestManualTranscriptSource } = await import(
      '../src/application/ingest-manual-transcript-source.js'
    );

    const result = await ingestManualTranscriptSource(
      {
        studentId: '11111111-1111-4111-8111-111111111111',
        text: '  Tutor supplied transcript  ',
        displayName: '  Lesson on travel  ',
      },
      { storage, persist },
    );

    expect(putTranscript).toHaveBeenCalledWith({
      transcriptId: expect.any(String),
      text: 'Tutor supplied transcript',
    });
    expect(persist).toHaveBeenCalledWith({
      recordingId: expect.any(String),
      transcriptId: expect.any(String),
      studentId: '11111111-1111-4111-8111-111111111111',
      displayName: 'Lesson on travel',
      storageUri: 'local://transcripts/transcript-id.txt',
      bytes: Buffer.byteLength('Tutor supplied transcript', 'utf8'),
      workingVersion: 1,
      contentHash: 'transcript-sha',
    });
    expect(result.recording.source).toBe('manual_transcript');
    expect(result.transcript).toMatchObject({
      sttProvider: 'manual',
      model: 'manual-entry',
      language: 'und',
      fallbackUsed: false,
      summaryJson: { provider: 'manual', origin: 'tutor_paste' },
      workingVersion: 1,
      contentHash: 'transcript-sha',
    });
  });

  it('rejects blank transcript text before writing storage', async () => {
    const { ingestManualTranscriptSource, ManualTranscriptSourceValidationError } = await import(
      '../src/application/ingest-manual-transcript-source.js'
    );

    await expect(
      ingestManualTranscriptSource(
        { studentId: '11111111-1111-4111-8111-111111111111', text: '   ' },
        { storage, persist: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'text_required' });
    expect(ManualTranscriptSourceValidationError).toBeTypeOf('function');
    expect(putTranscript).not.toHaveBeenCalled();
  });

  it('rejects text over 500000 characters before writing storage', async () => {
    const { ingestManualTranscriptSource } = await import(
      '../src/application/ingest-manual-transcript-source.js'
    );

    await expect(
      ingestManualTranscriptSource(
        {
          studentId: '11111111-1111-4111-8111-111111111111',
          text: 'x'.repeat(500_001),
        },
        { storage, persist: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: 'text_too_large' });
    expect(putTranscript).not.toHaveBeenCalled();
  });

  it('deletes stored text when database persistence fails', async () => {
    const { ingestManualTranscriptSource } = await import(
      '../src/application/ingest-manual-transcript-source.js'
    );
    const persist = vi.fn().mockRejectedValue(new Error('database write failed'));

    await expect(
      ingestManualTranscriptSource(
        {
          studentId: '11111111-1111-4111-8111-111111111111',
          text: 'Tutor supplied transcript',
        },
        { storage, persist },
      ),
    ).rejects.toThrow('database write failed');
    expect(deleteStored).toHaveBeenCalledWith('local://transcripts/transcript-id.txt');
  });
});
