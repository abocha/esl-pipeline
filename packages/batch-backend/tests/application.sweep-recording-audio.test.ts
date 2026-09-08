import { describe, expect, it, vi } from 'vitest';

import {
  deletionRetryDelayMs,
  sweepRecordingAudio,
} from '../src/application/sweep-recording-audio.js';
import type { RecordingAudioCleanupClaim } from '../src/domain/recording-audio-cleanup-repository.js';

const claim: RecordingAudioCleanupClaim = {
  recordingId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  uri: 'local://workspaces/22222222-2222-4222-8222-222222222222/recordings/11111111-1111-4111-8111-111111111111/audio.mp3',
  attemptCount: 1,
  reason: 'source_confirmed',
};

function repository(claims: RecordingAudioCleanupClaim[] = [claim]) {
  return {
    claim: vi.fn(async () => claims),
    complete: vi.fn(async () => true),
    fail: vi.fn(async () => true),
  };
}

describe('application/sweep-recording-audio', () => {
  it('does not claim or physically delete while cleanup is disabled', async () => {
    const repo = repository();
    const deleteObject = vi.fn(async () => undefined);

    await expect(
      sweepRecordingAudio({
        enabled: false,
        recoveryTtlDays: 7,
        limit: 10,
        repository: repo,
        storageForUri: () => ({ delete: deleteObject }) as never,
      }),
    ).resolves.toEqual({ claimed: 0, deleted: 0, failed: 0, staleCompletions: 0 });
    expect(repo.claim).not.toHaveBeenCalled();
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it.each([
    claim,
    {
      ...claim,
      recordingId: '33333333-3333-4333-8333-333333333333',
      uri: 's3://bucket/prefix/workspaces/22222222-2222-4222-8222-222222222222/recordings/33333333-3333-4333-8333-333333333333/candidates/44444444-4444-4444-8444-444444444444/audio.m4a',
      reason: 'failed_ttl' as const,
    },
    {
      ...claim,
      uri: 'local://recordings/11111111-1111-4111-8111-111111111111.mp3',
      reason: 'unconfirmed_transcribed_ttl' as const,
    },
    {
      ...claim,
      uri: 's3://bucket/prefix/recordings/11111111-1111-4111-8111-111111111111.m4a',
      reason: 'source_confirmed' as const,
    },
  ])(
    'deletes an exact current or legacy recording-owned filesystem or S3 object and commits success',
    async (item) => {
      const repo = repository([item]);
      const deleteObject = vi.fn(async () => undefined);

      await expect(
        sweepRecordingAudio({
          enabled: true,
          recoveryTtlDays: 7,
          limit: 1,
          repository: repo,
          storageForUri: () => ({ delete: deleteObject }) as never,
        }),
      ).resolves.toMatchObject({ claimed: 1, deleted: 1, failed: 0 });
      expect(deleteObject).toHaveBeenCalledWith(item.uri);
      expect(repo.complete).toHaveBeenCalledWith(item);
      expect(repo.fail).not.toHaveBeenCalled();
    },
  );

  it('records a secret-safe deletion-only failure with bounded backoff and later succeeds', async () => {
    const retryClaim = { ...claim, attemptCount: 2 };
    const repo = repository([claim]);
    const deleteObject = vi
      .fn()
      .mockRejectedValueOnce(new Error('signed-url-secret storage outage'))
      .mockResolvedValueOnce(undefined);

    await expect(
      sweepRecordingAudio({
        enabled: true,
        recoveryTtlDays: 7,
        limit: 1,
        repository: repo,
        storageForUri: () => ({ delete: deleteObject }) as never,
      }),
    ).resolves.toMatchObject({ failed: 1 });
    expect(repo.fail).toHaveBeenCalledWith({
      claim,
      errorCode: 'recording_audio_delete_failed',
      retryAfterMs: 60_000,
    });

    repo.claim.mockResolvedValueOnce([retryClaim]);
    await expect(
      sweepRecordingAudio({
        enabled: true,
        recoveryTtlDays: 7,
        limit: 1,
        repository: repo,
        storageForUri: () => ({ delete: deleteObject }) as never,
      }),
    ).resolves.toMatchObject({ deleted: 1 });
    expect(deletionRetryDelayMs(100)).toBe(6 * 60 * 60 * 1000);
  });

  it('refuses a URI owned by another recording or workspace before storage mutation', async () => {
    const unsafe = {
      ...claim,
      uri: 'local://workspaces/22222222-2222-4222-8222-222222222222/recordings/99999999-9999-4999-8999-999999999999/audio.mp3',
    };
    const repo = repository([unsafe]);
    const deleteObject = vi.fn(async () => undefined);

    await expect(
      sweepRecordingAudio({
        enabled: true,
        recoveryTtlDays: 7,
        limit: 1,
        repository: repo,
        storageForUri: () => ({ delete: deleteObject }) as never,
      }),
    ).resolves.toMatchObject({ failed: 1 });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'recording_audio_ownership_mismatch' }),
    );
  });

  it('does not let a stale completion become authoritative', async () => {
    const repo = repository();
    repo.complete.mockResolvedValueOnce(false);

    await expect(
      sweepRecordingAudio({
        enabled: true,
        recoveryTtlDays: 7,
        limit: 1,
        repository: repo,
        storageForUri: () => ({ delete: async () => undefined }) as never,
      }),
    ).resolves.toEqual({ claimed: 1, deleted: 0, failed: 0, staleCompletions: 1 });
  });
});
