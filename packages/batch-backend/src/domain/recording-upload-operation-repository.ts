import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { AudioInputTopology, SttProviderId } from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';

export interface RecordingUploadOperationContext {
  workspaceId: string;
  operationUuid: string;
  studentId: string;
  audioTopology: AudioInputTopology;
  requestedProvider: SttProviderId | null;
  requestProfile: string;
}

export interface RecordingUploadOperation extends RecordingUploadOperationContext {
  id: string;
  recordingId: string;
  state: 'processing' | 'completed';
  attemptToken: string | null;
  attemptExpiresAt: Date | null;
  finalRecordingId: string | null;
}

export type BeginRecordingUploadOperation =
  | { kind: 'claimed'; operation: RecordingUploadOperation; obsoleteCandidateUris: string[] }
  | { kind: 'active'; operation: RecordingUploadOperation }
  | { kind: 'completed'; operation: RecordingUploadOperation };

const DEFAULT_UPLOAD_ATTEMPT_TTL_MS = 30 * 60 * 1000;
const CLEANUP_SUCCESS_REVISIT_MS = 15 * 60 * 1000;
const CLEANUP_FAILURE_RETRY_MS = 60 * 1000;

export interface ObsoleteUploadCandidate {
  operationId: string;
  attemptToken: string;
  uri: string;
}

/**
 * Claims the logical operation before a multipart body is consumed. An active
 * duplicate does no media or storage work; an expired writer is retired before
 * its isolated candidate may be considered for cleanup.
 */
export async function beginRecordingUploadOperation(
  context: RecordingUploadOperationContext,
  attemptTtlMs = DEFAULT_UPLOAD_ATTEMPT_TTL_MS,
): Promise<BeginRecordingUploadOperation> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const token = randomUUID();
      const id = randomUUID();
      const recordingId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO recording_upload_operations (
           id, workspace_id, operation_uuid, recording_id, student_id,
           audio_topology, requested_provider, request_profile,
           attempt_token, attempt_expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                   now() + ($10::bigint * interval '1 millisecond'))
         ON CONFLICT (workspace_id, operation_uuid) DO NOTHING
         RETURNING *`,
        [
          id,
          context.workspaceId,
          context.operationUuid,
          recordingId,
          context.studentId,
          context.audioTopology,
          context.requestedProvider,
          context.requestProfile,
          token,
          attemptTtlMs,
        ],
      );
      if (inserted.rows[0]) {
        await client.query(
          `INSERT INTO recording_upload_operation_attempts (operation_id, attempt_token)
           VALUES ($1, $2)`,
          [id, token],
        );
        await client.query('COMMIT');
        return {
          kind: 'claimed' as const,
          operation: mapOperation(inserted.rows[0]),
          obsoleteCandidateUris: [],
        };
      }

      const existingResult = await client.query(
        `SELECT * FROM recording_upload_operations
         WHERE workspace_id = $1 AND operation_uuid = $2 FOR UPDATE`,
        [context.workspaceId, context.operationUuid],
      );
      const existing = mapOperation(existingResult.rows[0]);
      assertSameImmutableContext(existing, context);
      if (existing.state === 'completed') {
        await client.query('COMMIT');
        return { kind: 'completed', operation: existing };
      }
      if (existing.attemptExpiresAt && existing.attemptExpiresAt > new Date()) {
        await client.query('COMMIT');
        return { kind: 'active', operation: existing };
      }

      const obsolete = await client.query<{ candidate_uri: string | null }>(
        `UPDATE recording_upload_operation_attempts
         SET state = 'obsolete', retired_at = now()
         WHERE operation_id = $1 AND state = 'active'
         RETURNING candidate_uri`,
        [existing.id],
      );
      const nextToken = randomUUID();
      const claimed = await client.query(
        `UPDATE recording_upload_operations
         SET attempt_token = $2,
             attempt_expires_at = now() + ($3::bigint * interval '1 millisecond'),
             updated_at = now()
         WHERE id = $1 RETURNING *`,
        [existing.id, nextToken, attemptTtlMs],
      );
      await client.query(
        `INSERT INTO recording_upload_operation_attempts (operation_id, attempt_token)
         VALUES ($1, $2)`,
        [existing.id, nextToken],
      );
      await client.query('COMMIT');
      return {
        kind: 'claimed',
        operation: mapOperation(claimed.rows[0]),
        obsoleteCandidateUris: obsolete.rows.flatMap((row) =>
          row.candidate_uri ? [row.candidate_uri] : [],
        ),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function getRecordingUploadOperation(
  workspaceId: string,
  operationUuid: string,
): Promise<RecordingUploadOperation | null> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `SELECT * FROM recording_upload_operations WHERE workspace_id = $1 AND operation_uuid = $2`,
      [workspaceId, operationUuid],
    );
    return result.rows[0] ? mapOperation(result.rows[0]) : null;
  });
}

/** Records a candidate only while its generating attempt is still current. */
export async function recordUploadAttemptCandidate(params: {
  operationId: string;
  attemptToken: string;
  candidateUri: string;
}): Promise<boolean> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `UPDATE recording_upload_operation_attempts attempt
       SET candidate_uri = $3
       FROM recording_upload_operations operation
       WHERE attempt.operation_id = operation.id
         AND attempt.operation_id = $1
         AND attempt.attempt_token = $2
         AND attempt.state = 'active'
         AND operation.state = 'processing'
         AND operation.attempt_token = $2
         AND operation.attempt_expires_at > now()`,
      [params.operationId, params.attemptToken, params.candidateUri],
    );
    return result.rowCount === 1;
  });
}

/**
 * Produces a bounded cleanup worklist from durable truth. Expired active writers
 * are retired first, so a late storage completion remains isolated and becomes
 * eligible on the next reconciliation pass. Completion is scheduled for a
 * bounded revisit so a write which finished after an earlier cleanup check is
 * still recovered; failures are also deferred to let newer work progress.
 */
export async function listObsoleteUploadCandidates(
  limit: number,
): Promise<ObsoleteUploadCandidate[]> {
  const boundedLimit = Math.max(1, Math.floor(limit));
  return withPgClient(async (client) => {
    await client.query(
      `WITH expired AS (
         SELECT attempt.operation_id, attempt.attempt_token
         FROM recording_upload_operation_attempts attempt
         JOIN recording_upload_operations operation ON operation.id = attempt.operation_id
         WHERE attempt.state = 'active'
           AND operation.state = 'processing'
           AND operation.attempt_token = attempt.attempt_token
           AND operation.attempt_expires_at <= now()
         ORDER BY operation.attempt_expires_at
         LIMIT $1
         FOR UPDATE OF attempt SKIP LOCKED
       )
       UPDATE recording_upload_operation_attempts attempt
       SET state = 'obsolete', retired_at = now()
       FROM expired
       WHERE attempt.operation_id = expired.operation_id
         AND attempt.attempt_token = expired.attempt_token`,
      [boundedLimit],
    );
    const result = await client.query<{
      operation_id: string;
      attempt_token: string;
      candidate_uri: string;
    }>(
      `SELECT attempt.operation_id, attempt.attempt_token, attempt.candidate_uri
       FROM recording_upload_operation_attempts attempt
       WHERE attempt.state = 'obsolete'
          AND attempt.candidate_uri IS NOT NULL
         AND attempt.cleanup_next_attempt_at <= now()
          AND NOT EXISTS (
            SELECT 1 FROM recordings recording WHERE recording.storage_uri = attempt.candidate_uri
          )
         AND NOT EXISTS (
           SELECT 1
           FROM recording_upload_operation_attempts current_attempt
           JOIN recording_upload_operations current_operation
             ON current_operation.id = current_attempt.operation_id
           WHERE current_attempt.candidate_uri = attempt.candidate_uri
             AND current_attempt.state = 'active'
             AND current_operation.state = 'processing'
             AND current_operation.attempt_token = current_attempt.attempt_token
             AND current_operation.attempt_expires_at > now()
         )
        ORDER BY attempt.cleanup_next_attempt_at, attempt.retired_at NULLS FIRST,
                 attempt.created_at, attempt.attempt_token
        LIMIT $1`,
      [boundedLimit],
    );
    return result.rows.map((row) => ({
      operationId: row.operation_id,
      attemptToken: row.attempt_token,
      uri: row.candidate_uri,
    }));
  });
}

/** Re-check immediately before a physical delete; adopted/current recording URIs win. */
export async function isObsoleteUploadCandidateDeletable(
  candidate: ObsoleteUploadCandidate,
): Promise<boolean> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `SELECT 1
        FROM recording_upload_operation_attempts attempt
        WHERE attempt.operation_id = $1
          AND attempt.attempt_token = $2
          AND attempt.state = 'obsolete'
          AND attempt.candidate_uri = $3
          AND NOT EXISTS (
            SELECT 1 FROM recordings recording WHERE recording.storage_uri = attempt.candidate_uri
          )
          AND NOT EXISTS (
            SELECT 1
            FROM recording_upload_operation_attempts current_attempt
            JOIN recording_upload_operations current_operation
              ON current_operation.id = current_attempt.operation_id
            WHERE current_attempt.candidate_uri = attempt.candidate_uri
              AND current_attempt.state = 'active'
              AND current_operation.state = 'processing'
              AND current_operation.attempt_token = current_attempt.attempt_token
              AND current_operation.attempt_expires_at > now()
          )
        LIMIT 1`,
      [candidate.operationId, candidate.attemptToken, candidate.uri],
    );
    return result.rowCount === 1;
  });
}

/**
 * Persist one cleanup result after a physical attempt. Deferral, rather than
 * retention at the head of the query, lets a bounded worklist advance while
 * preserving both failure retries and late-write recovery.
 */
export async function recordObsoleteUploadCandidateCleanupResult(params: {
  candidate: ObsoleteUploadCandidate;
  deleted: boolean;
}): Promise<void> {
  const delayMs = params.deleted ? CLEANUP_SUCCESS_REVISIT_MS : CLEANUP_FAILURE_RETRY_MS;
  await withPgClient(async (client) => {
    await client.query(
      `UPDATE recording_upload_operation_attempts
       SET cleanup_next_attempt_at = now() + ($4::bigint * interval '1 millisecond')
       WHERE operation_id = $1
         AND attempt_token = $2
         AND state = 'obsolete'
         AND candidate_uri = $3`,
      [params.candidate.operationId, params.candidate.attemptToken, params.candidate.uri, delayMs],
    );
  });
}

/** Used inside the recording/run transaction; it is the database adoption step. */
export async function completeRecordingUploadOperation(params: {
  client: PoolClient;
  operationId: string;
  attemptToken: string;
  recordingId: string;
  candidateUri: string | null;
}): Promise<boolean> {
  const attempt = await params.client.query(
    `UPDATE recording_upload_operation_attempts attempt
     SET state = 'adopted'
     FROM recording_upload_operations operation
     WHERE attempt.operation_id = operation.id
       AND attempt.operation_id = $1
       AND attempt.attempt_token = $2
       AND attempt.state = 'active'
       AND operation.state = 'processing'
       AND operation.attempt_token = $2
       AND operation.attempt_expires_at > now()
       AND (attempt.candidate_uri IS NOT DISTINCT FROM $3)
     RETURNING attempt.operation_id`,
    [params.operationId, params.attemptToken, params.candidateUri],
  );
  if (!attempt.rows[0]) return false;
  const completed = await params.client.query(
    `UPDATE recording_upload_operations
     SET state = 'completed', final_recording_id = $3, completed_at = now(),
         attempt_token = NULL, attempt_expires_at = NULL, updated_at = now()
     WHERE id = $1 AND attempt_token = $2 AND state = 'processing'`,
    [params.operationId, params.attemptToken, params.recordingId],
  );
  return completed.rowCount === 1;
}

export class RecordingUploadOperationConflictError extends Error {
  constructor() {
    super('Upload operation identity was reused with different immutable request metadata.');
    this.name = 'RecordingUploadOperationConflictError';
  }
}

function assertSameImmutableContext(
  operation: RecordingUploadOperation,
  context: RecordingUploadOperationContext,
): void {
  if (
    operation.studentId !== context.studentId ||
    operation.audioTopology !== context.audioTopology ||
    operation.requestedProvider !== context.requestedProvider ||
    operation.requestProfile !== context.requestProfile
  ) {
    throw new RecordingUploadOperationConflictError();
  }
}

function mapOperation(row: Record<string, unknown>): RecordingUploadOperation {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    operationUuid: String(row.operation_uuid),
    recordingId: String(row.recording_id),
    studentId: String(row.student_id),
    audioTopology: row.audio_topology as AudioInputTopology,
    requestedProvider: (row.requested_provider as SttProviderId | null) ?? null,
    requestProfile: String(row.request_profile),
    state: row.state as 'processing' | 'completed',
    attemptToken: typeof row.attempt_token === 'string' ? row.attempt_token : null,
    attemptExpiresAt: row.attempt_expires_at instanceof Date ? row.attempt_expires_at : null,
    finalRecordingId: typeof row.final_recording_id === 'string' ? row.final_recording_id : null,
  };
}
