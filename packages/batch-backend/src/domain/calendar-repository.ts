import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { withPgClient, withSanitizedPgLogging } from '../infrastructure/db.js';
import { assertCalendarConnectionAuthority } from './google-connection-repository.js';

export class CalendarError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
/** No network work is allowed inside these transactions. */
export async function calendarTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  return withSanitizedPgLogging(() =>
    withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }),
  );
}
export const newCalendarEventId = () => randomUUID().replaceAll('-', '');
function canonicalRequest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalRequest);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalRequest(item)]),
    );
  return value;
}
export const hashCalendarRequest = (value: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(canonicalRequest(value)))
    .digest('hex');
export interface CalendarOperation {
  id: string;
  workspace_id: string;
  connection_id: string;
  connection_generation: string;
  student_id: string | null;
  initiating_user_id: string | null;
  adopted_by: string | null;
  authority_policy: 'initiator' | 'workspace_service';
  parent_id: string | null;
  kind: 'setup' | 'create' | 'bind' | 'sync' | 'refresh';
  idempotency_key: string;
  request_hash: string;
  request_payload: Record<string, unknown>;
  provider_event_id: string | null;
  association_marker: string | null;
  state: 'pending' | 'running' | 'retry_wait' | 'succeeded' | 'needs_review' | 'superseded';
  write_attempted_at: Date | null;
  lease_token: string;
  attempts: number;
  slot_index: number | null;
  error_code: string | null;
  event_url: string | null;
}
export interface CalendarConnection {
  id: string;
  workspace_id: string;
  grant_id: string;
  calendar_id: string;
  calendar_timezone: string;
  calendar_name: string;
  generation: string;
  status: string;
  sync_token: string | null;
  sync_page_token: string | null;
}
export async function lockCalendarConnection(
  client: PoolClient,
  id: string,
  generation?: string,
): Promise<CalendarConnection> {
  const initial = (
    await client.query<CalendarConnection>(
      'SELECT * FROM workspace_calendar_connections WHERE id=$1',
      [id],
    )
  ).rows[0];
  if (!initial) throw new CalendarError('connection_changed');
  // User/membership -> grant -> connection follows role-loss trigger lock order.
  await assertCalendarConnectionAuthority(client, id, Number(generation ?? initial.generation));
  const { rows } = await client.query<CalendarConnection>(
    'SELECT * FROM workspace_calendar_connections WHERE id=$1 FOR UPDATE',
    [id],
  );
  const connection = rows[0];
  if (
    !connection ||
    connection.status !== 'connected' ||
    (generation !== undefined && String(connection.generation) !== String(generation))
  )
    throw new CalendarError('connection_changed');
  return connection;
}
export async function lockCalendarOperation(
  client: PoolClient,
  op: CalendarOperation,
): Promise<CalendarConnection> {
  const connection = await lockCalendarConnection(
    client,
    op.connection_id,
    op.connection_generation,
  );
  const { rows } = await client.query(
    "SELECT id FROM calendar_operations WHERE id=$1 AND lease_token=$2 AND lease_expires_at>now() AND state='running' FOR UPDATE",
    [op.id, op.lease_token],
  );
  if (!rows.length) throw new CalendarError('lease_lost');
  return connection;
}
export async function enqueueCalendarRefresh(
  client: PoolClient,
  connection: CalendarConnection,
  bindingId: string,
): Promise<void> {
  const key = `${bindingId}:${randomUUID()}`;
  // Coalescing applies only to undispatched work. A change during a running refresh needs another intent.
  await client.query(
    `INSERT INTO calendar_operations(id,workspace_id,connection_id,connection_generation,authority_policy,kind,idempotency_key,request_hash,request_payload)
    SELECT $1,$2,$3,$4,'workspace_service','refresh',$5,$5,$6::jsonb WHERE NOT EXISTS (
      SELECT 1 FROM calendar_operations WHERE connection_id=$3 AND kind='refresh' AND request_payload->>'bindingId'=$7 AND state IN ('pending','retry_wait'))`,
    [
      randomUUID(),
      connection.workspace_id,
      connection.id,
      connection.generation,
      key,
      JSON.stringify({ bindingId }),
      bindingId,
    ],
  );
}
