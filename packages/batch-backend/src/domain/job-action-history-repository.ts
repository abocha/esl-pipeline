import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient } from '../infrastructure/db.js';
import type {
  InsertJobActionHistoryParams,
  JobActionHistoryRecord,
} from './job-action-history-model.js';

interface JobActionHistoryRow {
  id: string;
  job_id: string;
  action_type: JobActionHistoryRecord['actionType'];
  payload_json: Record<string, unknown> | null;
  requested_at: Date;
  requested_by: string | null;
  outcome: JobActionHistoryRecord['outcome'];
  message: string;
  error_code: string | null;
  created_job_id: string | null;
  created_at: Date;
}

const SELECT_COLUMNS = `
  id,
  job_id,
  action_type,
  payload_json,
  requested_at,
  requested_by,
  outcome,
  message,
  error_code,
  created_job_id,
  created_at
`;

export async function insertJobActionHistory(
  params: InsertJobActionHistoryParams,
): Promise<JobActionHistoryRecord> {
  const id = randomUUID();
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO job_action_history (
        id,
        job_id,
        action_type,
        payload_json,
        requested_at,
        requested_by,
        outcome,
        message,
        error_code,
        created_job_id,
        created_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, NOW())
      RETURNING ${SELECT_COLUMNS}
      `,
      [
        id,
        params.jobId,
        params.actionType,
        params.payload ? JSON.stringify(params.payload) : null,
        params.requestedAt,
        params.requestedBy ?? null,
        params.outcome,
        params.message,
        params.errorCode ?? null,
        params.createdJobId ?? null,
      ],
    );
    return result.rows[0] as JobActionHistoryRow;
  });

  return mapRow(row);
}

export async function listJobActionHistoryForJob(jobId: string): Promise<JobActionHistoryRecord[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT ${SELECT_COLUMNS}
      FROM job_action_history
      WHERE job_id = $1 OR created_job_id = $1
      ORDER BY requested_at DESC, created_at DESC, id DESC
      `,
      [jobId],
    );
    return result.rows as JobActionHistoryRow[];
  });

  return rows.map((row) => mapRow(row));
}

function mapRow(row: JobActionHistoryRow): JobActionHistoryRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    actionType: row.action_type,
    payload: row.payload_json ?? null,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by ?? null,
    outcome: row.outcome,
    message: row.message,
    errorCode: row.error_code ?? null,
    createdJobId: row.created_job_id ?? null,
    createdAt: row.created_at,
  };
}
