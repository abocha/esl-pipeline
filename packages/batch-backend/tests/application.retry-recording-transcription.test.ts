import { describe, expect, it, vi } from 'vitest';

import {
  RecordingRetryError,
  retryRecordingTranscription,
} from '../src/application/retry-recording-transcription.js';

const baseRecording = {
  id: 'recording-1',
  source: 'upload' as const,
  studentId: null,
  sourcePath: null,
  storageUri: 'local://recordings/recording-1.opus',
  sha256: null,
  bytes: 2048,
  durationSec: null,
  channels: null,
  status: 'failed' as const,
  error: 'boom',
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
};

describe('retryRecordingTranscription', () => {
  it('queues a failed recording and publishes the update', async () => {
    const getById = vi.fn().mockResolvedValue(baseRecording);
    const updateStatus = vi.fn().mockResolvedValue({
      ...baseRecording,
      status: 'queued',
      error: null,
    });
    const enqueue = vi.fn().mockImplementation(async () => {});
    const publishEvent = vi.fn();

    const result = await retryRecordingTranscription(
      'recording-1',
      undefined,
      {
        recordings: { getById, updateStatus },
        enqueue,
        publishEvent,
      },
    );

    expect(result).toEqual({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 2048,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(updateStatus).toHaveBeenCalledWith({
      id: 'recording-1',
      status: 'queued',
      error: null,
    });
    expect(enqueue).toHaveBeenCalledWith({ recordingId: 'recording-1' });
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recording_state_changed',
        recording: expect.objectContaining({ status: 'queued' }),
      }),
    );
  });

  it('forwards explicit STT provider override into transcribe queue payload', async () => {
    const getById = vi.fn().mockResolvedValue(baseRecording);
    const updateStatus = vi.fn().mockResolvedValue({
      ...baseRecording,
      status: 'queued',
      error: null,
    });
    const enqueue = vi.fn().mockImplementation(async () => {});

    await retryRecordingTranscription(
      'recording-1',
      { sttProvider: 'elevenlabs' },
      {
        recordings: { getById, updateStatus },
        enqueue,
        publishEvent: vi.fn(),
      },
    );

    expect(enqueue).toHaveBeenCalledWith({
      recordingId: 'recording-1',
      sttProvider: 'elevenlabs',
    });
  });

  it('rejects retries when recording is not failed', async () => {
    const getById = vi.fn().mockResolvedValue({
      ...baseRecording,
      status: 'transcribed',
      error: null,
    });
    const updateStatus = vi.fn();

    await expect(
      retryRecordingTranscription(
        'recording-1',
        undefined,
        {
          recordings: { getById, updateStatus },
          enqueue: vi.fn(),
          publishEvent: vi.fn(),
        },
      ),
    ).rejects.toBeInstanceOf(RecordingRetryError);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('reverts the recording if enqueue fails', async () => {
    const getById = vi.fn().mockResolvedValue(baseRecording);
    const updateStatus = vi
      .fn()
      .mockResolvedValueOnce({
        ...baseRecording,
        status: 'queued',
        error: null,
      })
      .mockResolvedValueOnce({
        ...baseRecording,
        status: 'failed',
        error: 'queue-down',
      });
    const enqueue = vi.fn().mockRejectedValue(new Error('queue-down'));
    const publishEvent = vi.fn();

    await expect(
      retryRecordingTranscription(
        'recording-1',
        undefined,
        {
          recordings: { getById, updateStatus },
          enqueue,
          publishEvent,
        },
      ),
    ).rejects.toThrow('queue-down');
    expect(updateStatus).toHaveBeenCalledTimes(2);
    expect(publishEvent).toHaveBeenCalledTimes(2);
  });
});
