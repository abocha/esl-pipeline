import { withPgClient } from '../infrastructure/db.js';

export type RecordingAudioCleanupReason =
  | 'source_confirmed'
  | 'failed_ttl'
  | 'unconfirmed_transcribed_ttl'
  | 'safely_stale_processing';

export interface RecordingAudioCleanupClaim {
  recordingId: string;
  workspaceId: string;
  uri: string;
  attemptCount: number;
  reason: RecordingAudioCleanupReason;
}

interface CleanupClaimRow {
  recording_id: string;
  workspace_id: string;
  storage_uri: string;
  audio_deletion_attempt_count: number;
  cleanup_reason: RecordingAudioCleanupReason;
}

const NONTERMINAL_RUN_STATES = ['queued', 'claimed', 'submitting', 'retry_wait'] as const;

/**
 * Claims a bounded batch without retaining the transaction or PostgreSQL client
 * across storage I/O. `audio_deletion_attempt_count` is the durable claim
 * generation used by completion CAS updates.
 */
export async function claimRecordingAudioCleanupCandidates(params: {
  limit: number;
  recoveryTtlDays: number;
  claimLeaseMs: number;
}): Promise<RecordingAudioCleanupClaim[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(params.limit)));
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      // A queued/transcribing row is terminalized only when no nonterminal run
      // remains that delivery reconciliation could legitimately recover.
      await client.query(
        `WITH stale AS (
           SELECT r.id
           FROM recordings r
           WHERE r.audio_lifecycle = 'retained'
             AND r.status IN ('queued', 'transcribing')
             AND r.updated_at <= now() - ($2::integer * interval '1 day')
             AND NOT EXISTS (
               SELECT 1 FROM transcription_runs tr
               WHERE tr.recording_id = r.id
                 AND tr.state = ANY($3::text[])
           )
           ORDER BY r.updated_at ASC, r.id ASC
           LIMIT $1
           FOR UPDATE OF r SKIP LOCKED
         )
         UPDATE recordings r
         SET status = 'failed',
             error = 'transcription_stale',
             audio_lifecycle = 'pending',
             audio_deletion_requested_at = COALESCE(r.audio_deletion_requested_at, now()),
             updated_at = now()
         FROM stale
         WHERE r.id = stale.id`,
        [boundedLimit, params.recoveryTtlDays, NONTERMINAL_RUN_STATES],
      );

      const result = await client.query<CleanupClaimRow>(
        `WITH eligible AS (
           SELECT r.id,
             CASE
               WHEN r.error = 'transcription_stale' THEN 'safely_stale_processing'
               WHEN r.audio_lifecycle = 'pending' THEN 'source_confirmed'
               WHEN EXISTS (
                 SELECT 1 FROM assignment_sessions s
                 WHERE s.recording_id = r.id
                   AND s.student_id = r.student_id
                   AND s.confirmed_snapshot #>> '{source,recordingId}' = r.id::text
               ) THEN 'source_confirmed'
               WHEN r.status = 'failed' THEN 'failed_ttl'
               ELSE 'unconfirmed_transcribed_ttl'
             END AS cleanup_reason
           FROM recordings r
           WHERE r.storage_uri IS NOT NULL
             AND (
               r.audio_lifecycle = 'pending'
               OR (
                 r.audio_lifecycle IN ('deleting', 'delete_failed')
                 AND r.audio_deletion_next_attempt_at <= now()
               )
               OR (
                 r.audio_lifecycle = 'retained'
                 AND EXISTS (
                   SELECT 1 FROM assignment_sessions s
                   WHERE s.recording_id = r.id
                     AND s.student_id = r.student_id
                     AND s.confirmed_snapshot #>> '{source,recordingId}' = r.id::text
                 )
               )
               OR (
                 r.audio_lifecycle = 'retained'
                 AND r.status = 'failed'
                 AND r.updated_at <= now() - ($2::integer * interval '1 day')
               )
               OR (
                 r.audio_lifecycle = 'retained'
                 AND r.status = 'transcribed'
                 AND r.updated_at <= now() - ($2::integer * interval '1 day')
                 AND NOT EXISTS (
                   SELECT 1 FROM assignment_sessions s
                   WHERE s.recording_id = r.id
                     AND s.student_id = r.student_id
                     AND s.confirmed_snapshot #>> '{source,recordingId}' = r.id::text
                 )
               )
             )
           ORDER BY
             CASE WHEN r.audio_lifecycle = 'pending' THEN 0 ELSE 1 END,
             COALESCE(r.audio_deletion_next_attempt_at, r.updated_at) ASC,
             r.id ASC
           LIMIT $1
           FOR UPDATE OF r SKIP LOCKED
         ), claimed AS (
           UPDATE recordings r
           SET audio_lifecycle = 'deleting',
               audio_deletion_requested_at = COALESCE(r.audio_deletion_requested_at, now()),
               audio_deletion_attempt_count = r.audio_deletion_attempt_count + 1,
               audio_deletion_error_code = NULL,
               audio_deletion_next_attempt_at = now() + ($3::bigint * interval '1 millisecond'),
               updated_at = now()
           FROM eligible
           WHERE r.id = eligible.id
           RETURNING r.id AS recording_id, r.workspace_id, r.storage_uri,
                     r.audio_deletion_attempt_count, eligible.cleanup_reason
         )
         SELECT * FROM claimed`,
        [boundedLimit, params.recoveryTtlDays, params.claimLeaseMs],
      );
      await client.query('COMMIT');
      return result.rows.map(mapClaim);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function completeRecordingAudioDeletion(
  claim: RecordingAudioCleanupClaim,
): Promise<boolean> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `UPDATE recordings
       SET storage_uri = NULL,
           audio_lifecycle = 'deleted',
           audio_deleted_at = now(),
           audio_deletion_error_code = NULL,
           audio_deletion_next_attempt_at = NULL,
           updated_at = now()
       WHERE id = $1 AND workspace_id = $2
         AND audio_lifecycle = 'deleting'
         AND storage_uri = $3
         AND audio_deletion_attempt_count = $4
       RETURNING id`,
      [claim.recordingId, claim.workspaceId, claim.uri, claim.attemptCount],
    );
    return result.rowCount === 1;
  });
}

export async function failRecordingAudioDeletion(params: {
  claim: RecordingAudioCleanupClaim;
  errorCode: string;
  retryAfterMs: number;
}): Promise<boolean> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `UPDATE recordings
       SET audio_lifecycle = 'delete_failed',
           audio_deletion_error_code = $5,
           audio_deletion_next_attempt_at = now() + ($6::bigint * interval '1 millisecond'),
           updated_at = now()
       WHERE id = $1 AND workspace_id = $2
         AND audio_lifecycle = 'deleting'
         AND storage_uri = $3
         AND audio_deletion_attempt_count = $4
       RETURNING id`,
      [
        params.claim.recordingId,
        params.claim.workspaceId,
        params.claim.uri,
        params.claim.attemptCount,
        params.errorCode,
        params.retryAfterMs,
      ],
    );
    return result.rowCount === 1;
  });
}

function mapClaim(row: CleanupClaimRow): RecordingAudioCleanupClaim {
  return {
    recordingId: row.recording_id,
    workspaceId: row.workspace_id,
    uri: row.storage_uri,
    attemptCount: Number(row.audio_deletion_attempt_count),
    reason: row.cleanup_reason,
  };
}
