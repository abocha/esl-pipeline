import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import { loadConfig } from '../config/env.js';
import {
  type CalendarConnection,
  CalendarError,
  type CalendarOperation,
  calendarTransaction,
  enqueueCalendarRefresh,
  lockCalendarConnection,
  lockCalendarOperation,
} from '../domain/calendar-repository.js';
import {
  assertWorkspaceCalendarRole,
  CalendarConnectionError,
} from '../domain/google-connection-repository.js';
import {
  CalendarProvider,
  GoogleCalendarClient,
  GoogleCalendarError,
  type GoogleCalendarEvent,
} from '../infrastructure/google-calendar-client.js';
import { logger } from '../infrastructure/logger.js';
import { processCalendarBind } from './calendar-association.js';
import { assertCalendarStudent } from './calendar-scheduling.js';
import {
  processCalendarRefresh,
  processCalendarSync,
  projectCalendarObservation,
  safeCalendarEventUrl,
} from './calendar-sync.js';

async function mayWrite(client: PoolClient, op: CalendarOperation): Promise<void> {
  if (!op.student_id || !(op.adopted_by ?? op.initiating_user_id))
    throw new CalendarError('permission_changed');
  await assertWorkspaceCalendarRole(
    client,
    op.workspace_id,
    (op.adopted_by ?? op.initiating_user_id)!,
  );
  await assertCalendarStudent(client, op.workspace_id, op.student_id);
}
export function verifyCalendarCreateProvenance(
  op: CalendarOperation,
  event: GoogleCalendarEvent,
): void {
  const properties = event.extendedProperties?.private;
  if (
    event.id !== op.provider_event_id ||
    properties?.eslAssociation !== op.association_marker ||
    properties?.eslRequest !== op.request_hash
  )
    throw new CalendarError('provider_provenance_conflict');
}
async function acceptCalendarCreate(
  op: CalendarOperation,
  event: GoogleCalendarEvent,
): Promise<void> {
  verifyCalendarCreateProvenance(op, event);
  await calendarTransaction(async (client) => {
    await lockCalendarOperation(client, op);
    if (!op.student_id) throw new CalendarError('student_not_found');
    await assertCalendarStudent(client, op.workspace_id, op.student_id);
    const id = randomUUID();
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO calendar_schedule_bindings(id,workspace_id,student_id,connection_id,provider_event_id,kind,association_marker,source_version,setup_operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(connection_id,provider_event_id) DO UPDATE SET source_version=EXCLUDED.source_version
      WHERE calendar_schedule_bindings.student_id=EXCLUDED.student_id AND calendar_schedule_bindings.association_marker=EXCLUDED.association_marker RETURNING id`,
      [
        id,
        op.workspace_id,
        op.student_id,
        op.connection_id,
        event.id,
        event.recurrence?.length ? 'series' : 'one_off',
        op.association_marker,
        event.etag ?? null,
        op.id,
      ],
    );
    if (!rows[0]) throw new CalendarError('provider_provenance_conflict');
    const binding = (
      await client.query('SELECT * FROM calendar_schedule_bindings WHERE id=$1', [rows[0].id])
    ).rows[0];
    await client.query(
      "SELECT set_config('app.calendar_sync','on',true),set_config('app.activity_actor_id','',true),set_config('app.user_id','',true)",
    );
    if (binding.kind === 'one_off') await projectCalendarObservation(client, binding, event);
    else
      await enqueueCalendarRefresh(
        client,
        await lockCalendarConnection(client, op.connection_id, op.connection_generation),
        binding.id,
      );
    await client.query(
      "UPDATE calendar_operations SET state='succeeded',event_url=$3,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [op.id, op.lease_token, safeCalendarEventUrl(event.htmlLink)],
    );
  });
}
export async function processCalendarCreate(
  op: CalendarOperation,
  provider: CalendarProvider,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new CalendarError('calendar_shutdown');
  if (!op.provider_event_id) throw new CalendarError('missing_event_identity');
  // Recovery is a read. It remains allowed after initiator role loss under a valid workspace connection.
  if (op.write_attempted_at) {
    const recovered = await provider.get(
      op.connection_id,
      op.connection_generation,
      op.provider_event_id,
    );
    if (recovered) {
      await acceptCalendarCreate(op, recovered);
      return;
    }
  }
  await calendarTransaction(async (client) => {
    // Match authority lock ordering: initiator first, authorizer/grant/connection, operation.
    await mayWrite(client, op);
    await lockCalendarOperation(client, op);
    await client.query(
      'UPDATE calendar_operations SET write_attempted_at=COALESCE(write_attempted_at,now()) WHERE id=$1 AND lease_token=$2',
      [op.id, op.lease_token],
    );
  });
  if (signal?.aborted) throw new CalendarError('calendar_shutdown');
  let event: GoogleCalendarEvent;
  try {
    event = await provider.insert(
      op.connection_id,
      op.connection_generation,
      op.request_payload.event as Record<string, unknown>,
      op.request_payload.invite === true,
    );
  } catch (error) {
    if (!(error instanceof GoogleCalendarError) || error.code !== 'conflict') throw error;
    const recovered = await provider.get(
      op.connection_id,
      op.connection_generation,
      op.provider_event_id,
    );
    if (!recovered) throw new CalendarError('provider_conflict_unresolved');
    event = recovered;
  }
  await acceptCalendarCreate(op, event);
}
async function enqueueSync(client: PoolClient, connection: CalendarConnection): Promise<void> {
  const key = `sync:${randomUUID()}`;
  await client.query(
    `INSERT INTO calendar_operations(id,workspace_id,connection_id,connection_generation,authority_policy,kind,idempotency_key,request_hash)
    SELECT $1,$2,$3,$4,'workspace_service','sync',$5,$5 WHERE NOT EXISTS(SELECT 1 FROM calendar_operations WHERE connection_id=$3 AND kind='sync' AND state IN ('pending','running','retry_wait'))`,
    [randomUUID(), connection.workspace_id, connection.id, connection.generation, key],
  );
}
export async function requestCalendarSync(workspaceId: string, userId: string): Promise<void> {
  await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId);
    const row = (
      await client.query<{ id: string }>(
        "SELECT id FROM workspace_calendar_connections WHERE workspace_id=$1 AND status='connected'",
        [workspaceId],
      )
    ).rows[0];
    if (!row) throw new CalendarError('calendar_required');
    const connection = await lockCalendarConnection(client, row.id);
    await enqueueSync(client, connection);
  });
}
async function scheduleCalendarWork(): Promise<void> {
  // One planner across processes; operation claims remain short, independently fenced transactions.
  await calendarTransaction(async (client) => {
    const locked = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(620070) AS locked',
    );
    if (!locked.rows[0]?.locked) return;
    const connections = (
      await client.query<CalendarConnection>(
        "SELECT c.* FROM workspace_calendar_connections c WHERE c.status='connected' AND c.next_sync_at<=now() AND NOT EXISTS(SELECT 1 FROM calendar_operations o WHERE o.connection_id=c.id AND o.connection_generation=c.generation AND o.kind='sync' AND o.state='needs_review') ORDER BY c.next_sync_at LIMIT 20",
      )
    ).rows;
    for (const connection of connections) await enqueueSync(client, connection);
    const bindings = (
      await client.query<{ id: string; connection_id: string }>(
        `SELECT b.id,b.connection_id FROM calendar_schedule_bindings b JOIN workspace_calendar_connections c ON c.id=b.connection_id WHERE c.status='connected' AND b.next_projection_at<=now() ORDER BY b.next_projection_at LIMIT 100`,
      )
    ).rows;
    for (const binding of bindings) {
      const connection = (
        await client.query<CalendarConnection>(
          'SELECT * FROM workspace_calendar_connections WHERE id=$1',
          [binding.connection_id],
        )
      ).rows[0]!;
      await enqueueCalendarRefresh(client, connection, binding.id);
      await client.query(
        "UPDATE calendar_schedule_bindings SET next_projection_at=now()+interval '1 day' WHERE id=$1",
        [binding.id],
      );
    }
    await client.query(
      `UPDATE calendar_operations o SET state='superseded',error_code='connection_changed',lease_token=NULL,lease_expires_at=NULL WHERE state IN ('pending','retry_wait','running') AND EXISTS(SELECT 1 FROM workspace_calendar_connections c WHERE c.id=o.connection_id AND (c.generation<>o.connection_generation OR c.status<>'connected'))`,
    );
  });
}
async function claimCalendarOperation(): Promise<CalendarOperation | null> {
  return calendarTransaction(async (client) => {
    // Prevent workers selecting different operations of the same connection concurrently.
    const locked = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(620071) AS locked',
    );
    if (!locked.rows[0]?.locked) return null;
    const { rows } =
      await client.query<CalendarOperation>(`SELECT o.* FROM calendar_operations o JOIN workspace_calendar_connections c ON c.id=o.connection_id
    WHERE o.kind<>'setup' AND o.state IN ('pending','retry_wait','running') AND o.due_at<=now() AND (o.lease_expires_at IS NULL OR o.lease_expires_at<=now())
      AND c.status='connected' AND c.generation=o.connection_generation AND NOT EXISTS(SELECT 1 FROM calendar_operations busy WHERE busy.connection_id=o.connection_id AND busy.state='running' AND busy.lease_expires_at>now())
    ORDER BY CASE o.kind WHEN 'create' THEN 0 ELSE 1 END,o.due_at,o.created_at LIMIT 1 FOR UPDATE OF o SKIP LOCKED`);
    if (!rows[0]) return null;
    return (
      await client.query<CalendarOperation>(
        "UPDATE calendar_operations SET state='running',lease_token=$2,lease_expires_at=now()+interval '60 seconds',attempts=attempts+1,updated_at=now() WHERE id=$1 RETURNING *",
        [rows[0].id, randomUUID()],
      )
    ).rows[0]!;
  });
}
async function finishCalendarOperation(op: CalendarOperation): Promise<void> {
  await calendarTransaction(async (client) => {
    await lockCalendarOperation(client, op);
    await client.query(
      "UPDATE calendar_operations SET state='succeeded',error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [op.id, op.lease_token],
    );
  });
}
async function failCalendarOperation(op: CalendarOperation, error: unknown): Promise<void> {
  const code =
    error instanceof CalendarError ||
    error instanceof GoogleCalendarError ||
    error instanceof CalendarConnectionError
      ? error.code
      : 'calendar_internal_error';
  const retry =
    (error instanceof GoogleCalendarError && error.retryable) ||
    (error instanceof CalendarConnectionError && error.status === 503) ||
    code === 'calendar_internal_error' ||
    code === 'calendar_shutdown';
  await calendarTransaction(async (client) => {
    // Failure recording cannot revive stale generations or a worker whose lease was superseded.
    await client.query(
      `UPDATE calendar_operations SET state=$3,error_code=$4,due_at=now()+($5*interval '1 second'),lease_token=NULL,lease_expires_at=NULL,updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND state='running'`,
      [
        op.id,
        op.lease_token,
        retry ? 'retry_wait' : 'needs_review',
        code,
        Math.min(3600, 15 * 2 ** Math.min(op.attempts, 8)) + Math.floor(Math.random() * 10),
      ],
    );
    if (
      error instanceof GoogleCalendarError &&
      ['unauthorized', 'permission_denied'].includes(error.code)
    )
      await client.query(
        "UPDATE workspace_calendar_connections SET status='reconnect_required',generation=generation+1,error_code=$3 WHERE id=$1 AND generation=$2 AND status='connected'",
        [op.connection_id, op.connection_generation, code],
      );
  });
}
export async function dispatchCalendarWork(
  provider: CalendarProvider = new GoogleCalendarClient(),
  limit = 4,
  signal?: AbortSignal,
): Promise<number> {
  if (signal?.aborted) return 0;
  await scheduleCalendarWork();
  let count = 0;
  for (let i = 0; i < limit; i++) {
    if (signal?.aborted) break;
    const op = await claimCalendarOperation();
    if (!op) break;
    count++;
    try {
      if (op.kind === 'create') {
        await processCalendarCreate(op, provider, signal);
        continue;
      }
      if (op.kind === 'bind') {
        await processCalendarBind(op, provider);
        continue;
      }
      if (op.kind === 'sync') {
        await processCalendarSync(op, provider);
        continue;
      }
      if (op.kind === 'refresh') {
        await processCalendarRefresh(op, provider, signal);
        await finishCalendarOperation(op);
        continue;
      }
      throw new CalendarError('unsupported_operation');
    } catch (error) {
      await failCalendarOperation(op, error);
      logger.warn('Calendar operation needs retry or review', {
        component: 'calendar',
        operationId: op.id,
        classification:
          error instanceof CalendarError ||
          error instanceof GoogleCalendarError ||
          error instanceof CalendarConnectionError
            ? error.code
            : 'calendar_internal_error',
      });
    }
  }
  return count;
}
export function startCalendarDispatcher(): { close: () => Promise<void> } {
  let stopped = false;
  let running: Promise<unknown> | null = null;
  const controller = new AbortController();
  const tick = () => {
    if (stopped || running) return;
    running = dispatchCalendarWork(new GoogleCalendarClient(), 4, controller.signal)
      .catch(() =>
        logger.warn('Calendar dispatch failed', {
          component: 'calendar',
          classification: 'calendar_dispatch_failed',
        }),
      )
      .finally(() => {
        running = null;
      });
  };
  if (loadConfig().googleCalendar?.enabled) {
    tick();
  }
  const timer = setInterval(() => {
    if (loadConfig().googleCalendar?.enabled) tick();
  }, 5000);
  timer.unref();
  return {
    close: async () => {
      stopped = true;
      controller.abort();
      clearInterval(timer);
      await running;
    },
  };
}
