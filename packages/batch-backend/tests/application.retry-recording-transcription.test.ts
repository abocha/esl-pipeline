import { describe, expect, it, vi } from 'vitest';

import {
  RecordingRetryError,
  retryRecordingTranscription,
} from '../src/application/retry-recording-transcription.js';

const failedRecording = {
  id: 'recording-1',
  workspaceId: 'workspace-1',
  source: 'upload' as const,
  audioLifecycle: 'retained' as const,
  studentId: null,
  sourcePath: null,
  storageUri: 'local://recording-1.opus',
  sha256: null,
  bytes: 1,
  durationSec: null,
  channels: null,
  mediaPreparationVersion: 'recording-media-v1',
  status: 'failed' as const,
  error: 'old failure',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('retryRecordingTranscription', () => {
  it('rejects terminal normal-user retry without enqueuing replacement provider work', async () => {
    const enqueue = vi.fn();
    await expect(
      retryRecordingTranscription(
        'recording-1',
        { workspaceId: 'workspace-1' },
        {
          recordings: {
            getById: vi.fn().mockResolvedValue(failedRecording),
            updateStatus: vi.fn(),
          },
          enqueue,
          publishEvent: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({ code: 'recording_retry_not_supported' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects active and successful retry before any mutation', async () => {
    for (const status of ['queued', 'transcribing', 'transcribed'] as const) {
      const updateStatus = vi.fn();
      await expect(
        retryRecordingTranscription(
          'recording-1',
          { workspaceId: 'workspace-1' },
          {
            recordings: {
              getById: vi.fn().mockResolvedValue({ ...failedRecording, status }),
              updateStatus,
            },
            enqueue: vi.fn(),
            publishEvent: vi.fn(),
          },
        ),
      ).rejects.toBeInstanceOf(RecordingRetryError);
      expect(updateStatus).not.toHaveBeenCalled();
    }
  });
});
