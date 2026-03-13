import type { PoolClient } from 'pg';

import type { OpsActionListResponse, OpsActionState, OpsActionStatus } from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';

interface OpsActionRow {
  operation_id: string;
  action: OpsActionStatus['action'];
  state: OpsActionState;
  requested_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  requested_by: string | null;
  requested_by_user_id: string | null;
  message: string | null;
  command: string;
  exit_code: number | null;
  stdout_tail: string | null;
  stderr_tail: string | null;
  owner_id: string | null;
  ownership_claimed_at: Date | null;
  ownership_expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ClaimOpsActionOwnershipParams {
  operationId: string;
  ownerId: string;
  startedAt: Date;
  ownershipExpiresAt: Date;
  message: string;
}

export interface FinalizeOwnedOpsActionParams {
  operationId: string;
  ownerId: string;
  state: Extract<OpsActionState, 'succeeded' | 'failed'>;
  finishedAt: Date;
  message: string;
  exitCode: number | null;
  stdoutTail: string | null;
  stderrTail: string | null;
}

const SELECT_COLUMNS = `
  operation_id,
  action,
  state,
  requested_at,
  started_at,
  finished_at,
  requested_by,
  requested_by_user_id,
  message,
  command,
  exit_code,
  stdout_tail,
  stderr_tail,
  owner_id,
  ownership_claimed_at,
  ownership_expires_at,
  created_at,
  updated_at
`;

export async function upsertOpsActionStatus(status: OpsActionStatus): Promise<OpsActionStatus> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      INSERT INTO ops_actions (
        operation_id,
        action,
        state,
        requested_at,
        started_at,
        finished_at,
        requested_by,
        requested_by_user_id,
        message,
        command,
        exit_code,
        stdout_tail,
        stderr_tail,
        owner_id,
        ownership_claimed_at,
        ownership_expires_at,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL, NULL, NULL, NOW(), NOW())
      ON CONFLICT (operation_id) DO UPDATE
      SET
        action = EXCLUDED.action,
        state = EXCLUDED.state,
        requested_at = EXCLUDED.requested_at,
        started_at = EXCLUDED.started_at,
        finished_at = EXCLUDED.finished_at,
        requested_by = EXCLUDED.requested_by,
        requested_by_user_id = EXCLUDED.requested_by_user_id,
        message = EXCLUDED.message,
        command = EXCLUDED.command,
        exit_code = EXCLUDED.exit_code,
        stdout_tail = EXCLUDED.stdout_tail,
        stderr_tail = EXCLUDED.stderr_tail,
        updated_at = NOW()
      RETURNING ${SELECT_COLUMNS}
      `,
      [
        status.operationId,
        status.action,
        status.state,
        status.requestedAt,
        status.startedAt,
        status.finishedAt,
        status.requestedBy,
        status.requestedByUserId,
        status.message,
        status.command,
        status.exitCode,
        status.stdoutTail,
        status.stderrTail,
      ],
    );
    return result.rows[0] as OpsActionRow;
  });

  return mapRow(row);
}

export async function getOpsActionStatusByOperationId(
  operationId: string,
): Promise<OpsActionStatus | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT ${SELECT_COLUMNS}
      FROM ops_actions
      WHERE operation_id = $1
      `,
      [operationId],
    );
    return (result.rows[0] as OpsActionRow | undefined) ?? null;
  });

  return row ? mapRow(row) : null;
}

export async function listOpsActions(params: {
  limit: number;
  offset: number;
}): Promise<OpsActionListResponse> {
  const result = await withPgClient(async (client: PoolClient) => {
    const countResult = await client.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM ops_actions
      `,
    );
    const rowsResult = await client.query(
      `
      SELECT ${SELECT_COLUMNS}
      FROM ops_actions
      ORDER BY requested_at DESC, created_at DESC, operation_id DESC
      LIMIT $1
      OFFSET $2
      `,
      [params.limit, params.offset],
    );

    return {
      total: Number(countResult.rows[0]?.count ?? '0'),
      rows: rowsResult.rows as OpsActionRow[],
    };
  });

  return {
    actions: result.rows.map((row) => mapRow(row)),
    total: result.total,
    limit: params.limit,
    offset: params.offset,
  };
}

export async function claimQueuedOpsActionOwnership(
  params: ClaimOpsActionOwnershipParams,
): Promise<OpsActionStatus | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE ops_actions
      SET
        state = 'running',
        started_at = COALESCE(started_at, $3),
        message = $4,
        owner_id = $2,
        ownership_claimed_at = $3,
        ownership_expires_at = $5,
        updated_at = NOW()
      WHERE operation_id = $1
        AND (
          state = 'queued'
          OR (
            state = 'running'
            AND (
              ownership_expires_at IS NULL
              OR ownership_expires_at <= $3
            )
          )
        )
      RETURNING ${SELECT_COLUMNS}
      `,
      [
        params.operationId,
        params.ownerId,
        params.startedAt.toISOString(),
        params.message,
        params.ownershipExpiresAt.toISOString(),
      ],
    );
    return (result.rows[0] as OpsActionRow | undefined) ?? null;
  });

  return row ? mapRow(row) : null;
}

export async function listResumableOpsActions(params: {
  now: Date;
  limit: number;
}): Promise<OpsActionStatus[]> {
  const rows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      SELECT ${SELECT_COLUMNS}
      FROM ops_actions
      WHERE
        state = 'queued'
        OR (
          state = 'running'
          AND (
            ownership_expires_at IS NULL
            OR ownership_expires_at <= $1
          )
        )
      ORDER BY requested_at ASC
      LIMIT $2
      `,
      [params.now.toISOString(), params.limit],
    );
    return result.rows as OpsActionRow[];
  });

  return rows.map((row) => mapRow(row));
}

export async function finalizeOwnedOpsAction(
  params: FinalizeOwnedOpsActionParams,
): Promise<OpsActionStatus | null> {
  const row = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      UPDATE ops_actions
      SET
        state = $3,
        finished_at = $4,
        message = $5,
        exit_code = $6,
        stdout_tail = $7,
        stderr_tail = $8,
        ownership_expires_at = NULL,
        updated_at = NOW()
      WHERE operation_id = $1
        AND owner_id = $2
      RETURNING ${SELECT_COLUMNS}
      `,
      [
        params.operationId,
        params.ownerId,
        params.state,
        params.finishedAt.toISOString(),
        params.message,
        params.exitCode,
        params.stdoutTail,
        params.stderrTail,
      ],
    );
    return (result.rows[0] as OpsActionRow | undefined) ?? null;
  });

  return row ? mapRow(row) : null;
}

export async function pruneOpsActionHistoryByFinishedAt(params: {
  before: Date;
  limit: number;
}): Promise<number> {
  const deletedRows = await withPgClient(async (client: PoolClient) => {
    const result = await client.query(
      `
      WITH candidate AS (
        SELECT operation_id
        FROM ops_actions
        WHERE finished_at IS NOT NULL
          AND finished_at < $1
        ORDER BY finished_at ASC
        LIMIT $2
      )
      DELETE FROM ops_actions AS target
      USING candidate
      WHERE target.operation_id = candidate.operation_id
      RETURNING target.operation_id
      `,
      [params.before.toISOString(), params.limit],
    );
    return result.rowCount ?? result.rows.length;
  });

  return deletedRows;
}

function mapRow(row: OpsActionRow): OpsActionStatus {
  return {
    operationId: row.operation_id,
    action: row.action,
    state: row.state,
    requestedAt: row.requested_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    requestedBy: row.requested_by,
    requestedByUserId: row.requested_by_user_id,
    message: row.message,
    command: row.command,
    exitCode: row.exit_code,
    stdoutTail: row.stdout_tail,
    stderrTail: row.stderr_tail,
  };
}
