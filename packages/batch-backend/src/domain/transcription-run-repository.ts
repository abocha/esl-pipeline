import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type { SttProviderId } from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import type { RecordingStatus } from './recording-model.js';
import { type InsertTranscriptParams, insertTranscript } from './transcript-repository.js';

export type TranscriptionRunState = 'queued' | 'submitting' | 'retry_wait' | 'succeeded' | 'failed';

export interface TranscriptionRun {
  id: string;
  recordingId: string;
  workspaceId: string;
  provider: SttProviderId;
  requestProfile: string;
  state: TranscriptionRunState;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  submissionSlotsReserved: number;
  submissionSlotLimit: 3;
  currentSubmissionSlot: number | null;
  lastSubmissionOutcome: 'known_success' | 'known_failure' | 'ambiguous' | null;
  errorCode: string | null;
}

export async function createQueuedTranscriptionRun(params: {
  recordingId: string;
  workspaceId: string;
  provider: SttProviderId;
  requestProfile: string;
  client?: PoolClient;
}): Promise<TranscriptionRun> {
  const write = async (client: PoolClient) => {
    // A retry of an uncertain API acknowledgement must converge on the active row.
    const existing = await client.query(
      `SELECT * FROM transcription_runs WHERE recording_id = $1
       AND state IN ('queued', 'claimed', 'submitting', 'retry_wait') FOR UPDATE`,
      [params.recordingId],
    );
    if (existing.rows[0]) return mapRun(existing.rows[0]);
    const result = await client.query(
      `INSERT INTO transcription_runs (id, recording_id, workspace_id, provider, request_profile, state)
       VALUES ($1, $2, $3, $4, $5, 'queued') RETURNING *`,
      [
        randomUUID(),
        params.recordingId,
        params.workspaceId,
        params.provider,
        params.requestProfile,
      ],
    );
    return mapRun(result.rows[0]);
  };
  if (params.client) return write(params.client);
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Serialize an uncertain enqueue acknowledgement against the parent row;
      // the partial active-run uniqueness then remains a backstop, not the protocol.
      await client.query('SELECT id FROM recordings WHERE id = $1 FOR UPDATE', [
        params.recordingId,
      ]);
      const run = await write(client);
      await client.query('COMMIT');
      return run;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function claimTranscriptionRun(params: {
  runId: string;
  claimTtlMs: number;
}): Promise<TranscriptionRun | null> {
  const token = randomUUID();
  return withPgClient(async (client) => {
    // Reclaiming a stale submitting row deliberately preserves its reserved slot as ambiguous.
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `UPDATE transcription_runs
       SET state = 'submitting', claim_token = $2, claimed_at = now(),
           claim_expires_at = now() + ($3::bigint * interval '1 millisecond'),
           last_submission_outcome = CASE
             WHEN state = 'submitting' AND current_submission_slot IS NOT NULL THEN 'ambiguous'
             ELSE last_submission_outcome END,
           updated_at = now()
       WHERE id = $1
         AND (state IN ('queued', 'retry_wait')
           OR (state = 'submitting' AND claim_expires_at < now()))
       RETURNING *`,
        [params.runId, token, params.claimTtlMs],
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const run = mapRun(result.rows[0]);
      await client.query(
        `UPDATE recordings SET status = 'transcribing', error = NULL, updated_at = now() WHERE id = $1`,
        [run.recordingId],
      );
      await client.query('COMMIT');
      return run;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function reserveTranscriptionSubmissionSlot(params: {
  runId: string;
  claimToken: string;
}): Promise<TranscriptionRun | null> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `UPDATE transcription_runs
       SET submission_slots_reserved = submission_slots_reserved + 1,
           current_submission_slot = submission_slots_reserved + 1,
           error_code = NULL, updated_at = now()
       WHERE id = $1 AND state = 'submitting' AND claim_token = $2
         AND claim_expires_at > now()
         AND submission_slots_reserved < submission_slot_limit
       RETURNING *`,
      [params.runId, params.claimToken],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  });
}

/**
 * Short, conditional durable lease renewal. No transaction or connection is
 * retained by the caller; an execution that cannot prove this update succeeded
 * must stop rather than reviving a stale claim.
 */
export async function renewTranscriptionRunLease(params: {
  runId: string;
  claimToken: string;
  claimTtlMs: number;
  /** The reserved slot that is about to cross the provider boundary, if any. */
  submissionSlot?: number;
}): Promise<TranscriptionRun | null> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `UPDATE transcription_runs
       SET claim_expires_at = now() + ($3::bigint * interval '1 millisecond'), updated_at = now()
       WHERE id = $1
         AND state = 'submitting'
         AND claim_token = $2
         AND claim_expires_at > now()
         AND ($4::integer IS NULL OR current_submission_slot = $4)
       RETURNING *`,
      [params.runId, params.claimToken, params.claimTtlMs, params.submissionSlot ?? null],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  });
}

export async function markTranscriptionRunRetryWait(params: {
  runId: string;
  claimToken: string;
  errorCode: string;
  outcome: 'known_failure' | 'ambiguous';
}): Promise<TranscriptionRun | null> {
  return transitionRunAndRecording({
    ...params,
    nextState: 'retry_wait',
    recordingStatus: 'transcribing',
    recordingErrorCode: null,
    outcome: params.outcome,
  });
}

export async function failTranscriptionRun(params: {
  runId: string;
  claimToken?: string;
  errorCode: string;
  outcome?: 'known_failure' | 'ambiguous';
}): Promise<TranscriptionRun | null> {
  return transitionRunAndRecording({
    ...params,
    nextState: 'failed',
    recordingStatus: 'failed',
    outcome: params.outcome ?? 'known_failure',
  });
}

async function transitionRunAndRecording(params: {
  runId: string;
  claimToken?: string;
  nextState: 'retry_wait' | 'failed';
  recordingStatus: RecordingStatus;
  errorCode: string | null;
  recordingErrorCode?: string | null;
  outcome: 'known_failure' | 'ambiguous';
}): Promise<TranscriptionRun | null> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await client.query(
        `UPDATE transcription_runs
         SET state = $3, error_code = $4, last_submission_outcome = $5,
             claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL,
             completed_at = CASE WHEN $3 = 'failed' THEN now() ELSE NULL END, updated_at = now()
         WHERE id = $1 AND state = 'submitting'
           AND claim_expires_at > now()
           AND ($2::uuid IS NULL OR claim_token = $2)
         RETURNING *`,
        [
          params.runId,
          params.claimToken ?? null,
          params.nextState,
          params.errorCode,
          params.outcome,
        ],
      );
      if (!result.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const run = mapRun(result.rows[0]);
      await client.query(
        `UPDATE recordings SET status = $2, error = $3, updated_at = now() WHERE id = $1`,
        [
          run.recordingId,
          params.recordingStatus,
          Object.hasOwn(params, 'recordingErrorCode')
            ? params.recordingErrorCode
            : params.errorCode,
        ],
      );
      await client.query('COMMIT');
      return run;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function completeTranscriptionRun(params: {
  runId: string;
  claimToken: string;
  transcript: InsertTranscriptParams;
}): Promise<{ run: TranscriptionRun; transcriptId: string } | null> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const locked = await client.query(
        `SELECT * FROM transcription_runs WHERE id = $1 AND state = 'submitting'
         AND claim_token = $2 AND claim_expires_at > now() FOR UPDATE`,
        [params.runId, params.claimToken],
      );
      if (!locked.rows[0]) {
        await client.query('ROLLBACK');
        return null;
      }
      const run = mapRun(locked.rows[0]);
      const transcript = await insertTranscript(params.transcript, { client });
      const updated = await client.query(
        `UPDATE transcription_runs SET state = 'succeeded', error_code = NULL,
           last_submission_outcome = 'known_success', completed_at = now(),
           claim_token = NULL, claimed_at = NULL, claim_expires_at = NULL, updated_at = now()
         WHERE id = $1 RETURNING *`,
        [params.runId],
      );
      await client.query(
        `UPDATE recordings SET status = 'transcribed', error = NULL, updated_at = now() WHERE id = $1`,
        [run.recordingId],
      );
      await client.query('COMMIT');
      return { run: mapRun(updated.rows[0]), transcriptId: transcript.id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function getTranscriptionRunById(runId: string): Promise<TranscriptionRun | null> {
  return withPgClient(async (client) => {
    const result = await client.query('SELECT * FROM transcription_runs WHERE id = $1', [runId]);
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  });
}

export async function getLatestTranscriptionRunForRecording(
  recordingId: string,
  workspaceId: string,
): Promise<TranscriptionRun | null> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `SELECT * FROM transcription_runs
       WHERE recording_id = $1 AND workspace_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      [recordingId, workspaceId],
    );
    return result.rows[0] ? mapRun(result.rows[0]) : null;
  });
}

export async function listLatestTranscriptionRunsForRecordings(
  recordingIds: string[],
  workspaceId: string,
): Promise<TranscriptionRun[]> {
  if (recordingIds.length === 0) return [];
  return withPgClient(async (client) => {
    const result = await client.query(
      `SELECT DISTINCT ON (recording_id) *
       FROM transcription_runs
       WHERE recording_id = ANY($1::uuid[]) AND workspace_id = $2
       ORDER BY recording_id, created_at DESC, id DESC`,
      [recordingIds, workspaceId],
    );
    return result.rows.map(mapRun);
  });
}

/** Nonterminal durable work that needs a BullMQ delivery restored. */
export async function listTranscriptionRunsRequiringDelivery(
  limit: number,
): Promise<Pick<TranscriptionRun, 'id' | 'recordingId'>[]> {
  return withPgClient(async (client) => {
    const result = await client.query(
      `SELECT id, recording_id
       FROM transcription_runs
       WHERE state IN ('queued', 'retry_wait')
          OR (state = 'submitting' AND claim_expires_at < now())
       ORDER BY updated_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      recordingId: String(row.recording_id),
    }));
  });
}

function mapRun(row: Record<string, unknown>): TranscriptionRun {
  return {
    id: String(row.id),
    recordingId: String(row.recording_id),
    workspaceId: String(row.workspace_id),
    provider: row.provider as SttProviderId,
    requestProfile: String(row.request_profile),
    state: row.state === 'claimed' ? 'submitting' : (row.state as TranscriptionRunState),
    claimToken: typeof row.claim_token === 'string' ? row.claim_token : null,
    claimExpiresAt: row.claim_expires_at instanceof Date ? row.claim_expires_at : null,
    submissionSlotsReserved: Number(row.submission_slots_reserved),
    submissionSlotLimit: 3,
    currentSubmissionSlot:
      typeof row.current_submission_slot === 'number' ? row.current_submission_slot : null,
    lastSubmissionOutcome: row.last_submission_outcome as TranscriptionRun['lastSubmissionOutcome'],
    errorCode: typeof row.error_code === 'string' ? row.error_code : null,
  };
}
