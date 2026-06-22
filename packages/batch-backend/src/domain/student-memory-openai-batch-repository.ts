import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';

export const StudentMemoryOpenAiBatchWorkloadValues = [
  'lesson_memory',
  'homework_memory',
  'student_memory_snapshot',
] as const;

export type StudentMemoryOpenAiBatchWorkload =
  (typeof StudentMemoryOpenAiBatchWorkloadValues)[number];

export type StudentMemoryOpenAiBatchRunState =
  | 'planned'
  | 'submitted'
  | 'in_progress'
  | 'finalizing'
  | 'completed'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'reconciled';

export type StudentMemoryOpenAiBatchItemState =
  | 'planned'
  | 'submitted'
  | 'completed'
  | 'imported'
  | 'stale'
  | 'superseded_by_online'
  | 'terminal_failure'
  | 'retryable_failure';

export type StudentMemoryOpenAiBatchClaimState =
  | 'active'
  | 'superseded_by_online'
  | 'imported'
  | 'stale'
  | 'terminal_failure'
  | 'retryable_failure';

export interface StudentMemoryOpenAiBatchRun {
  id: string;
  workload: StudentMemoryOpenAiBatchWorkload;
  model: string;
  state: StudentMemoryOpenAiBatchRunState;
  inputJsonlSha256: string;
  inputBytes: number;
  itemCount: number;
  plannedAt: Date;
  remoteInputFileId: string | null;
  remoteBatchId: string | null;
  remoteOutputFileId: string | null;
  remoteErrorFileId: string | null;
}

export interface StudentMemoryOpenAiBatchItem {
  id: string;
  runId: string;
  studentId: string;
  workload: StudentMemoryOpenAiBatchWorkload;
  model: string;
  customId: string;
  canonicalScopeKey: string;
  sourceVersionHash: string;
  requestEnvelope: unknown;
  responseSchemaFingerprint: string;
  requestBody: Record<string, unknown>;
  sourceRefs: Record<string, unknown>;
  claimState: StudentMemoryOpenAiBatchClaimState;
  state: StudentMemoryOpenAiBatchItemState;
}

export interface LockedStudentMemoryOpenAiBatchItemForImport {
  itemId: string;
  itemState: StudentMemoryOpenAiBatchItemState;
  itemClaimState: StudentMemoryOpenAiBatchClaimState;
  claimState: StudentMemoryOpenAiBatchClaimState;
  importedCanonicalRecordId: string | null;
}

export interface CreateStudentMemoryOpenAiBatchRunParams {
  id?: string;
  parentRetryRunId?: string | null;
  workload: StudentMemoryOpenAiBatchWorkload;
  model: string;
  inputJsonlSha256: string;
  inputBytes: number;
  items: Array<{
    id?: string;
    retryOfItemId?: string | null;
    studentId: string;
    customId: string;
    canonicalScopeKey: string;
    sourceVersionHash: string;
    requestEnvelope: unknown;
    responseSchemaFingerprint: string;
    requestBody: Record<string, unknown>;
    sourceRefs: Record<string, unknown>;
  }>;
}

interface RunRow {
  id: string;
  workload: StudentMemoryOpenAiBatchWorkload;
  model: string;
  state: StudentMemoryOpenAiBatchRunState;
  input_jsonl_sha256: string;
  input_bytes: number;
  item_count: number;
  planned_at: Date;
  remote_input_file_id: string | null;
  remote_batch_id: string | null;
  remote_output_file_id: string | null;
  remote_error_file_id: string | null;
}

interface ItemRow {
  id: string;
  run_id: string;
  student_id: string;
  workload: StudentMemoryOpenAiBatchWorkload;
  model: string;
  custom_id: string;
  canonical_scope_key: string;
  source_version_hash: string;
  request_envelope: unknown;
  response_schema_fingerprint: string;
  request_body: Record<string, unknown>;
  source_refs: Record<string, unknown>;
  claim_state: StudentMemoryOpenAiBatchClaimState;
  state: StudentMemoryOpenAiBatchItemState;
}

export async function createStudentMemoryOpenAiBatchRun(
  params: CreateStudentMemoryOpenAiBatchRunParams,
): Promise<StudentMemoryOpenAiBatchRun> {
  if (params.items.length === 0) {
    throw new Error('OpenAI Batch run requires at least one item');
  }
  const runId = params.id ?? randomUUID();

  return withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const runResult = await client.query<RunRow>(
        `
          INSERT INTO student_memory_openai_batch_runs (
            id, workload, model, parent_retry_run_id, input_jsonl_sha256, input_bytes, item_count
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING
            id, workload, model, state, input_jsonl_sha256, input_bytes, item_count, planned_at,
            remote_input_file_id, remote_batch_id, remote_output_file_id, remote_error_file_id
        `,
        [
          runId,
          params.workload,
          params.model,
          params.parentRetryRunId ?? null,
          params.inputJsonlSha256,
          params.inputBytes,
          params.items.length,
        ],
      );
      const run = runResult.rows[0];
      if (!run) {
        throw new Error('Failed to create OpenAI Batch run');
      }

      for (const sourceItem of params.items) {
        const itemId = sourceItem.id ?? randomUUID();
        await client.query(
          `
            INSERT INTO student_memory_openai_batch_items (
              id, run_id, student_id, workload, model, custom_id, canonical_scope_key,
              source_version_hash, request_envelope, response_schema_fingerprint, request_body, source_refs,
              retry_of_item_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13)
          `,
          [
            itemId,
            runId,
            sourceItem.studentId,
            params.workload,
            params.model,
            sourceItem.customId,
            sourceItem.canonicalScopeKey,
            sourceItem.sourceVersionHash,
            JSON.stringify(sourceItem.requestEnvelope),
            sourceItem.responseSchemaFingerprint,
            JSON.stringify(sourceItem.requestBody),
            JSON.stringify(sourceItem.sourceRefs),
            sourceItem.retryOfItemId ?? null,
          ],
        );
        await client.query(
          `
            INSERT INTO student_memory_openai_batch_claims (
              id, item_id, workload, canonical_scope_key, source_version_hash
            )
            VALUES ($1, $2, $3, $4, $5)
          `,
          [
            randomUUID(),
            itemId,
            params.workload,
            sourceItem.canonicalScopeKey,
            sourceItem.sourceVersionHash,
          ],
        );
      }

      await client.query('COMMIT');
      return mapRun(run);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function hasStudentMemoryOpenAiBatchRetryChild(itemId: string): Promise<boolean> {
  return withPgClient(async (client: PoolClient) => {
    const result = await client.query<{ exists: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM student_memory_openai_batch_items WHERE retry_of_item_id = $1) AS exists`,
      [itemId],
    );
    return result.rows[0]?.exists === true;
  });
}

export async function listStudentMemoryOpenAiBatchItems(params: {
  runId: string;
}): Promise<StudentMemoryOpenAiBatchItem[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<ItemRow>(
      `
        SELECT
          id, run_id, student_id, workload, model, custom_id, canonical_scope_key,
          source_version_hash, request_envelope, response_schema_fingerprint, request_body, source_refs,
          claim_state, state
        FROM student_memory_openai_batch_items
        WHERE run_id = $1
        ORDER BY created_at ASC, id ASC
      `,
      [params.runId],
    );
    return result.rows;
  });
  return rows.map(mapItem);
}

export async function getStudentMemoryOpenAiBatchRunById(
  id: string,
): Promise<StudentMemoryOpenAiBatchRun | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query<RunRow>(
      `
        SELECT
          id, workload, model, state, input_jsonl_sha256, input_bytes, item_count, planned_at,
          remote_input_file_id, remote_batch_id, remote_output_file_id, remote_error_file_id
        FROM student_memory_openai_batch_runs
        WHERE id = $1
      `,
      [id],
    );
    return result.rows[0] ?? null;
  });
  return row ? mapRun(row) : null;
}

export async function updateStudentMemoryOpenAiBatchRunRemoteStatus(params: {
  runId: string;
  state: Extract<
    StudentMemoryOpenAiBatchRunState,
    'in_progress' | 'finalizing' | 'completed' | 'failed' | 'expired' | 'cancelled'
  >;
  remoteOutputFileId?: string | null;
  remoteErrorFileId?: string | null;
  requestCounts?: Record<string, unknown>;
  remoteError?: Record<string, unknown>;
}): Promise<void> {
  const timestampColumn: Record<typeof params.state, string> = {
    in_progress: 'in_progress_at',
    finalizing: 'finalizing_at',
    completed: 'completed_at',
    failed: 'failed_at',
    expired: 'expired_at',
    cancelled: 'cancelled_at',
  };
  await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
        UPDATE student_memory_openai_batch_runs
        SET
          state = $2,
          remote_output_file_id = COALESCE($3, remote_output_file_id),
          remote_error_file_id = COALESCE($4, remote_error_file_id),
          remote_request_counts = COALESCE($5::jsonb, remote_request_counts),
          remote_error = COALESCE($6::jsonb, remote_error),
          ${timestampColumn[params.state]} = NOW()
        WHERE id = $1
          AND state NOT IN ('reconciled')
      `,
      [
        params.runId,
        params.state,
        params.remoteOutputFileId ?? null,
        params.remoteErrorFileId ?? null,
        params.requestCounts ? JSON.stringify(params.requestCounts) : null,
        params.remoteError ? JSON.stringify(params.remoteError) : null,
      ],
    );
    if (result.rowCount !== 1)
      throw new Error(`OpenAI Batch run cannot record remote status: ${params.runId}`);
  });
}

export async function markStudentMemoryOpenAiBatchRunReconciled(runId: string): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
        UPDATE student_memory_openai_batch_runs
        SET state = 'reconciled', reconciled_at = NOW()
        WHERE id = $1
          AND state IN ('completed', 'expired', 'failed', 'cancelled')
      `,
      [runId],
    );
    if (result.rowCount !== 1) {
      throw new Error(`OpenAI Batch run cannot be reconciled from its current state: ${runId}`);
    }
  });
}

export async function markStudentMemoryOpenAiBatchRunSubmitted(params: {
  runId: string;
  remoteInputFileId: string;
  remoteBatchId: string;
}): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const update = await client.query(
        `
          UPDATE student_memory_openai_batch_runs
          SET
            state = 'submitted',
            remote_input_file_id = $2,
            remote_batch_id = $3,
            submitted_at = NOW()
          WHERE id = $1
            AND state = 'planned'
        `,
        [params.runId, params.remoteInputFileId, params.remoteBatchId],
      );
      if (update.rowCount !== 1) {
        throw new Error(
          `OpenAI Batch run cannot be submitted from its current state: ${params.runId}`,
        );
      }
      await client.query(
        `
          UPDATE student_memory_openai_batch_items
          SET state = 'submitted', submitted_at = NOW()
          WHERE run_id = $1
            AND state = 'planned'
        `,
        [params.runId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function markStudentMemoryOpenAiBatchItemImported(params: {
  itemId: string;
  canonicalRecordId: string;
}): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const itemResult = await client.query<{ imported_canonical_record_id: string | null }>(
        `
          SELECT imported_canonical_record_id
          FROM student_memory_openai_batch_items
          WHERE id = $1
          FOR UPDATE
        `,
        [params.itemId],
      );
      const item = itemResult.rows[0];
      if (!item) {
        throw new Error(`OpenAI Batch item was not found: ${params.itemId}`);
      }
      if (
        item.imported_canonical_record_id &&
        item.imported_canonical_record_id !== params.canonicalRecordId
      ) {
        throw new Error(
          `OpenAI Batch item already has a different canonical destination: ${params.itemId}`,
        );
      }
      await client.query(
        `
          UPDATE student_memory_openai_batch_items
          SET
            claim_state = 'imported',
            state = 'imported',
            imported_canonical_record_id = $2
          WHERE id = $1
        `,
        [params.itemId, params.canonicalRecordId],
      );
      await client.query(
        `
          UPDATE student_memory_openai_batch_claims
          SET state = 'imported'
          WHERE item_id = $1
            AND state = 'active'
        `,
        [params.itemId],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function lockStudentMemoryOpenAiBatchItemForImport(
  client: PoolClient,
  itemId: string,
): Promise<LockedStudentMemoryOpenAiBatchItemForImport> {
  const result = await client.query<{
    item_id: string;
    item_state: StudentMemoryOpenAiBatchItemState;
    item_claim_state: StudentMemoryOpenAiBatchClaimState;
    claim_state: StudentMemoryOpenAiBatchClaimState;
    imported_canonical_record_id: string | null;
  }>(
    `
      SELECT
        item.id AS item_id,
        item.state AS item_state,
        item.claim_state AS item_claim_state,
        claim.state AS claim_state,
        item.imported_canonical_record_id
      FROM student_memory_openai_batch_items item
      INNER JOIN student_memory_openai_batch_claims claim ON claim.item_id = item.id
      WHERE item.id = $1
      FOR UPDATE OF item, claim
    `,
    [itemId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`OpenAI Batch item was not found: ${itemId}`);
  return {
    itemId: row.item_id,
    itemState: row.item_state,
    itemClaimState: row.item_claim_state,
    claimState: row.claim_state,
    importedCanonicalRecordId: row.imported_canonical_record_id,
  };
}

export async function markStudentMemoryOpenAiBatchItemImportedWithinTransaction(
  client: PoolClient,
  params: { itemId: string; canonicalRecordId: string },
): Promise<void> {
  const itemUpdated = await client.query(
    `
      UPDATE student_memory_openai_batch_items
      SET
        claim_state = 'imported',
        state = 'imported',
        imported_canonical_record_id = $2
      WHERE id = $1
        AND claim_state = 'active'
        AND state IN ('planned', 'submitted', 'completed')
    `,
    [params.itemId, params.canonicalRecordId],
  );
  if (itemUpdated.rowCount !== 1) {
    throw new Error(`OpenAI Batch item cannot be marked imported: ${params.itemId}`);
  }
  const claimUpdated = await client.query(
    `
      UPDATE student_memory_openai_batch_claims
      SET state = 'imported'
      WHERE item_id = $1
        AND state = 'active'
    `,
    [params.itemId],
  );
  if (claimUpdated.rowCount !== 1) {
    throw new Error(`OpenAI Batch claim cannot be marked imported: ${params.itemId}`);
  }
}

export async function markStudentMemoryOpenAiBatchItemOutcome(params: {
  itemId: string;
  state: Exclude<
    StudentMemoryOpenAiBatchItemState,
    'planned' | 'submitted' | 'completed' | 'imported'
  >;
  normalizedError?: Record<string, unknown>;
  providerRequestId?: string;
  returnedModel?: string;
  finishReason?: string;
  usage?: unknown;
}): Promise<void> {
  const claimState: StudentMemoryOpenAiBatchClaimState =
    params.state === 'superseded_by_online' ? 'superseded_by_online' : params.state;
  await withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const updated = await client.query(
        `
          UPDATE student_memory_openai_batch_items
          SET
            state = $2,
            claim_state = $3,
            normalized_error = $4::jsonb,
            remote_request_id = COALESCE($5, remote_request_id),
            returned_model = COALESCE($6, returned_model),
            finish_reason = COALESCE($7, finish_reason),
            usage = COALESCE($8::jsonb, usage)
          WHERE id = $1
            AND state NOT IN ('imported', 'stale', 'superseded_by_online', 'terminal_failure')
        `,
        [
          params.itemId,
          params.state,
          claimState,
          JSON.stringify(params.normalizedError ?? null),
          params.providerRequestId ?? null,
          params.returnedModel ?? null,
          params.finishReason ?? null,
          params.usage === undefined ? null : JSON.stringify(params.usage),
        ],
      );
      if (updated.rowCount !== 1) {
        throw new Error(`OpenAI Batch item cannot transition to ${params.state}: ${params.itemId}`);
      }
      await client.query(
        `UPDATE student_memory_openai_batch_claims SET state = $2 WHERE item_id = $1 AND state = 'active'`,
        [params.itemId, claimState],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function recordStudentMemoryOpenAiBatchItemDiagnostics(params: {
  itemId: string;
  providerRequestId?: string;
  returnedModel?: string;
  finishReason?: string;
  usage?: unknown;
}): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    const updated = await client.query(
      `
        UPDATE student_memory_openai_batch_items
        SET
          remote_request_id = COALESCE($2, remote_request_id),
          returned_model = COALESCE($3, returned_model),
          finish_reason = COALESCE($4, finish_reason),
          usage = COALESCE($5::jsonb, usage)
        WHERE id = $1
          AND state = 'imported'
      `,
      [
        params.itemId,
        params.providerRequestId ?? null,
        params.returnedModel ?? null,
        params.finishReason ?? null,
        params.usage === undefined ? null : JSON.stringify(params.usage),
      ],
    );
    if (updated.rowCount !== 1)
      throw new Error(`OpenAI Batch item cannot record diagnostics: ${params.itemId}`);
  });
}

export async function recordStudentMemoryOpenAiBatchReconciliationAudit(params: {
  runId: string;
  protocolFailures: Array<{ reason: string; customId?: string }>;
}): Promise<void> {
  await withPgClient(async (client: PoolClient) => {
    const updated = await client.query(
      `
        UPDATE student_memory_openai_batch_runs
        SET operator_audit = jsonb_build_object(
          'reconciliationProtocolFailures', $2::jsonb,
          'reconciliationProtocolFailureCount', jsonb_array_length($2::jsonb)
        )
        WHERE id = $1
          AND state IN ('completed', 'expired', 'failed', 'cancelled')
      `,
      [params.runId, JSON.stringify(params.protocolFailures)],
    );
    if (updated.rowCount !== 1)
      throw new Error(`OpenAI Batch run cannot record reconciliation audit: ${params.runId}`);
  });
}

export async function supersedeStudentMemoryOpenAiBatchClaimsForOnlineWork(params: {
  workload: StudentMemoryOpenAiBatchWorkload;
  canonicalScopeKey: string;
}): Promise<string[]> {
  return withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const result = await client.query<{ id: string }>(
        `
          UPDATE student_memory_openai_batch_items AS item
          SET claim_state = 'superseded_by_online', state = 'superseded_by_online'
          FROM student_memory_openai_batch_claims AS claim
          WHERE claim.item_id = item.id
            AND claim.workload = $1
            AND claim.canonical_scope_key = $2
            AND claim.state = 'active'
          RETURNING item.id
        `,
        [params.workload, params.canonicalScopeKey],
      );
      await client.query(
        `
          UPDATE student_memory_openai_batch_claims
          SET state = 'superseded_by_online'
          WHERE workload = $1
            AND canonical_scope_key = $2
            AND state = 'active'
        `,
        [params.workload, params.canonicalScopeKey],
      );
      await client.query('COMMIT');
      return result.rows.map((row) => row.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

function mapRun(row: RunRow): StudentMemoryOpenAiBatchRun {
  return {
    id: row.id,
    workload: row.workload,
    model: row.model,
    state: row.state,
    inputJsonlSha256: row.input_jsonl_sha256,
    inputBytes: row.input_bytes,
    itemCount: row.item_count,
    plannedAt: row.planned_at,
    remoteInputFileId: row.remote_input_file_id ?? null,
    remoteBatchId: row.remote_batch_id ?? null,
    remoteOutputFileId: row.remote_output_file_id ?? null,
    remoteErrorFileId: row.remote_error_file_id ?? null,
  };
}

function mapItem(row: ItemRow): StudentMemoryOpenAiBatchItem {
  return {
    id: row.id,
    runId: row.run_id,
    studentId: row.student_id,
    workload: row.workload,
    model: row.model,
    customId: row.custom_id,
    canonicalScopeKey: row.canonical_scope_key,
    sourceVersionHash: row.source_version_hash,
    requestEnvelope: row.request_envelope,
    responseSchemaFingerprint: row.response_schema_fingerprint,
    requestBody: row.request_body,
    sourceRefs: row.source_refs,
    claimState: row.claim_state,
    state: row.state,
  };
}
