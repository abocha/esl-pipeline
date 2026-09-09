import {
  claimRecordingAudioCleanupCandidates,
  completeRecordingAudioDeletion,
  failRecordingAudioDeletion,
  type RecordingAudioCleanupClaim,
} from '../domain/recording-audio-cleanup-repository.js';
import { logger } from '../infrastructure/logger.js';
import {
  assertRecordingOwnedAudioUri,
  createTranscriptionStorageForUri,
  RecordingAudioOwnershipError,
} from '../infrastructure/transcription-storage.js';

export const RECORDING_AUDIO_CLEANUP_CLAIM_LEASE_MS = 5 * 60 * 1000;
const INITIAL_RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 6 * 60 * 60 * 1000;

export interface RecordingAudioCleanupSummary {
  claimed: number;
  deleted: number;
  failed: number;
  staleCompletions: number;
}

export async function sweepRecordingAudio(params: {
  enabled: boolean;
  recoveryTtlDays: number;
  limit: number;
  repository?: {
    claim: typeof claimRecordingAudioCleanupCandidates;
    complete: typeof completeRecordingAudioDeletion;
    fail: typeof failRecordingAudioDeletion;
  };
  storageForUri?: typeof createTranscriptionStorageForUri;
  now?: () => number;
}): Promise<RecordingAudioCleanupSummary> {
  const summary: RecordingAudioCleanupSummary = {
    claimed: 0,
    deleted: 0,
    failed: 0,
    staleCompletions: 0,
  };
  if (!params.enabled) return summary;

  const repository = params.repository ?? {
    claim: claimRecordingAudioCleanupCandidates,
    complete: completeRecordingAudioDeletion,
    fail: failRecordingAudioDeletion,
  };
  const storageForUri = params.storageForUri ?? createTranscriptionStorageForUri;
  const now = params.now ?? Date.now;
  const claims = await repository.claim({
    limit: params.limit,
    recoveryTtlDays: params.recoveryTtlDays,
    claimLeaseMs: RECORDING_AUDIO_CLEANUP_CLAIM_LEASE_MS,
  });
  summary.claimed = claims.length;

  for (const claim of claims) {
    const startedAt = now();
    try {
      assertRecordingOwnedAudioUri(claim.uri, claim.workspaceId, claim.recordingId);
      await storageForUri(claim.uri).delete(claim.uri);
      if (await repository.complete(claim)) {
        summary.deleted += 1;
        logTransition(claim, 'deleted', now() - startedAt);
      } else {
        summary.staleCompletions += 1;
      }
    } catch (error) {
      const errorCode =
        error instanceof RecordingAudioOwnershipError
          ? 'recording_audio_ownership_mismatch'
          : 'recording_audio_delete_failed';
      const updated = await repository.fail({
        claim,
        errorCode,
        retryAfterMs: deletionRetryDelayMs(claim.attemptCount),
      });
      if (updated) {
        summary.failed += 1;
        logger.warn('Recording audio deletion failed', {
          event: 'recording_audio_cleanup_transition',
          recordingId: claim.recordingId,
          workspaceId: claim.workspaceId,
          lifecycle: 'delete_failed',
          deletionAttemptCount: claim.attemptCount,
          deletionErrorCode: errorCode,
          cleanupReason: claim.reason,
          latencyMs: Math.max(0, now() - startedAt),
        });
      } else {
        summary.staleCompletions += 1;
      }
    }
  }
  return summary;
}

export function deletionRetryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(20, attemptCount - 1));
  return Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** exponent);
}

function logTransition(
  claim: RecordingAudioCleanupClaim,
  lifecycle: 'deleted',
  latencyMs: number,
): void {
  logger.info('Recording audio deletion completed', {
    event: 'recording_audio_cleanup_transition',
    recordingId: claim.recordingId,
    workspaceId: claim.workspaceId,
    lifecycle,
    deletionAttemptCount: claim.attemptCount,
    deletionErrorCode: null,
    cleanupReason: claim.reason,
    latencyMs: Math.max(0, latencyMs),
  });
}
