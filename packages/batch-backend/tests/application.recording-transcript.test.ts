import { describe, expect, it, vi } from 'vitest';

import { getRecordingTranscript } from '../src/application/get-recording-transcript.js';
import { updateRecordingTranscript } from '../src/application/update-recording-transcript.js';
import type { TranscriptRecord } from '../src/domain/transcript-model.js';
import type { TranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

describe('application/recording-transcript', () => {
  it('returns null when no transcript exists', async () => {
    const transcripts = {
      getByRecordingId: vi.fn().mockResolvedValue(null),
    };
    const storage = createStorageStub({ getText: vi.fn() });

    const result = await getRecordingTranscript('recording-1', {
      storage,
      transcripts,
    });

    expect(result).toBeNull();
    expect(storage.getText).not.toHaveBeenCalled();
  });

  it('returns transcript text with metadata', async () => {
    const transcript = createTranscriptRecord();
    const transcripts = {
      getByRecordingId: vi.fn().mockResolvedValue(transcript),
    };
    const storage = createStorageStub({
      getText: vi.fn().mockResolvedValue('Hello transcript'),
    });

    const result = await getRecordingTranscript('recording-1', {
      storage,
      transcripts,
    });

    expect(result).toEqual({
      recordingId: transcript.recordingId,
      transcriptId: transcript.id,
      text: 'Hello transcript',
      summaryJson: transcript.summaryJson,
      model: transcript.model,
      language: transcript.language,
      mode: transcript.mode,
      createdAt: transcript.createdAt.toISOString(),
      updatedAt: transcript.updatedAt.toISOString(),
    });
  });

  it('updates transcript storage and timestamp', async () => {
    const transcript = createTranscriptRecord();
    const updated = {
      ...transcript,
      updatedAt: new Date('2024-01-01T01:00:00Z'),
    };
    const transcripts = {
      getByRecordingId: vi.fn().mockResolvedValue(transcript),
      update: vi.fn().mockResolvedValue(updated),
    };
    const storage = createStorageStub({
      putTranscript: vi.fn().mockResolvedValue({
        uri: transcript.storageUri,
        bytes: 12,
      }),
    });

    const result = await updateRecordingTranscript(
      { recordingId: transcript.recordingId, text: 'Updated text' },
      { storage, transcripts },
    );

    expect(storage.putTranscript).toHaveBeenCalledWith({
      transcriptId: transcript.id,
      text: 'Updated text',
    });
    expect(transcripts.update).toHaveBeenCalledWith({
      id: transcript.id,
      storageUri: transcript.storageUri,
    });
    expect(result).toEqual({
      recordingId: updated.recordingId,
      transcriptId: updated.id,
      text: 'Updated text',
      summaryJson: updated.summaryJson,
      model: updated.model,
      language: updated.language,
      mode: updated.mode,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  });
});

function createTranscriptRecord(): TranscriptRecord {
  return {
    id: 'transcript-1',
    recordingId: 'recording-1',
    storageUri: 'local://transcripts/transcript-1.txt',
    rawResponseUri: null,
    mode: 'timeline',
    model: 'nova-3',
    language: 'en',
    fallbackUsed: false,
    summaryJson: { channels: 2 },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:30:00Z'),
  };
}

function createStorageStub(overrides: Partial<TranscriptionStorage> = {}): TranscriptionStorage {
  return {
    putAudio: vi.fn().mockResolvedValue({ uri: 'local://recordings/recording.opus', bytes: 1 }),
    putTranscript: vi
      .fn()
      .mockResolvedValue({ uri: 'local://transcripts/transcript-1.txt', bytes: 1 }),
    putRawResponse: vi
      .fn()
      .mockResolvedValue({ uri: 'local://transcripts/transcript-1.json', bytes: 1 }),
    putPromptPackage: vi
      .fn()
      .mockResolvedValue({ uri: 'local://prompt-packages/prompt-1.txt', bytes: 1 }),
    putDraft: vi.fn().mockResolvedValue({ uri: 'local://drafts/draft-1.md', bytes: 1 }),
    getText: vi.fn().mockResolvedValue(''),
    getStream: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  };
}
