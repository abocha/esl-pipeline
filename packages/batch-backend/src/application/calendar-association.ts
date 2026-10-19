import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type {
  CalendarUnlinkedEventDto,
  CalendarUnlinkedEventsPageDto,
} from '@esl-pipeline/contracts';

import {
  CalendarError,
  type CalendarOperation,
  calendarTransaction,
  enqueueCalendarRefresh,
  hashCalendarRequest,
  lockCalendarConnection,
  lockCalendarOperation,
} from '../domain/calendar-repository.js';
import {
  assertWorkspaceCalendarRole,
  calendarCredentialServices,
} from '../domain/google-connection-repository.js';
import {
  type CalendarProvider,
  GoogleCalendarClient,
} from '../infrastructure/google-calendar-client.js';
import { assertCalendarStudent } from './calendar-scheduling.js';
import { calendarEventTiming, safeCalendarEventUrl } from './calendar-sync.js';

async function selectedCalendar(workspaceId: string, userId: string, management: boolean) {
  return calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, management);
    const row = (
      await client.query<{ id: string }>(
        "SELECT id FROM workspace_calendar_connections WHERE workspace_id=$1 AND status='connected'",
        [workspaceId],
      )
    ).rows[0];
    if (!row) throw new CalendarError('calendar_required');
    return lockCalendarConnection(client, row.id);
  });
}
export async function listUnlinkedCalendarEvents(
  workspaceId: string,
  userId: string,
  provider: CalendarProvider = new GoogleCalendarClient(),
  cursor?: string,
): Promise<CalendarUnlinkedEventsPageDto> {
  const connection = await selectedCalendar(workspaceId, userId, true);
  const { credentials } = calendarCredentialServices();
  const cursorContext = `calendar-discovery:${workspaceId}`;
  let pageToken: string | undefined;
  if (cursor) {
    try {
      if (cursor.length > 8192) throw new Error();
      const parsed = z
        .object({
          connectionId: z.string(),
          generation: z.number().int(),
          pageToken: z.string().min(1).max(4096),
          expiresAt: z.number().int(),
        })
        .strict()
        .parse(JSON.parse(credentials.decrypt(cursor, cursorContext)));
      if (
        parsed.connectionId !== connection.id ||
        parsed.generation !== Number(connection.generation) ||
        parsed.expiresAt <= Date.now()
      )
        throw new Error();
      pageToken = parsed.pageToken;
    } catch {
      throw new CalendarError('invalid_discovery_cursor', 400);
    }
  }
  const bound = await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    return (
      await client.query<{ provider_event_id: string }>(
        'SELECT provider_event_id FROM calendar_schedule_bindings WHERE connection_id=$1',
        [connection.id],
      )
    ).rows;
  });
  const ids = new Set(bound.map((row) => row.provider_event_id));
  const events: CalendarUnlinkedEventDto[] = [];
  // Exactly one provider page per HTTP request, including pages containing no unlinked events.
  const page = await provider.changes(connection.id, String(connection.generation), {
    ...(pageToken ? { pageToken } : {}),
  });
  for (const event of page.items) {
    if (ids.has(event.id) || event.recurringEventId || event.status === 'cancelled') continue;
    events.push({
      id: event.id,
      title: event.summary ?? '(Untitled)',
      startsAt: calendarEventTiming(event)?.startsAt.toISOString() ?? null,
      recurring: Boolean(event.recurrence?.length),
      eventUrl: safeCalendarEventUrl(event.htmlLink),
    });
  }
  if (page.nextPageToken && (page.nextPageToken === pageToken || page.nextPageToken.length > 4096))
    throw new CalendarError('provider_pagination_cycle');
  await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    await lockCalendarConnection(client, connection.id, String(connection.generation));
  });
  return {
    events,
    nextPageToken: page.nextPageToken
      ? credentials.encrypt(
          JSON.stringify({
            connectionId: connection.id,
            generation: Number(connection.generation),
            pageToken: page.nextPageToken,
            expiresAt: Date.now() + 15 * 60_000,
          }),
          cursorContext,
        )
      : null,
  };
}
export async function bindCalendarEvent(
  workspaceId: string,
  userId: string,
  studentId: string,
  eventId: string,
): Promise<{ bindingId: string; operationId: string | null }> {
  return calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    await assertCalendarStudent(client, workspaceId, studentId);
    const row = (
      await client.query<{ id: string }>(
        "SELECT id FROM workspace_calendar_connections WHERE workspace_id=$1 AND status='connected'",
        [workspaceId],
      )
    ).rows[0];
    if (!row) throw new CalendarError('calendar_required');
    const connection = await lockCalendarConnection(client, row.id);
    const existing = (
      await client.query<{ id: string; student_id: string }>(
        'SELECT id,student_id FROM calendar_schedule_bindings WHERE connection_id=$1 AND provider_event_id=$2',
        [connection.id, eventId],
      )
    ).rows[0];
    if (existing) {
      if (existing.student_id !== studentId) throw new CalendarError('event_already_bound');
      return { bindingId: existing.id, operationId: null };
    }
    const key = `${connection.id}:${eventId}`;
    const hash = hashCalendarRequest({ studentId, eventId });
    const prior = (
      await client.query<CalendarOperation>(
        "SELECT * FROM calendar_operations WHERE workspace_id=$1 AND kind='bind' AND idempotency_key=$2",
        [workspaceId, key],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== hash) throw new CalendarError('idempotency_conflict');
      return { bindingId: String(prior.request_payload.bindingId), operationId: prior.id };
    }
    const id = randomUUID(),
      bindingId = randomUUID();
    await client.query(
      `INSERT INTO calendar_operations(id,workspace_id,connection_id,connection_generation,student_id,initiating_user_id,authority_policy,kind,idempotency_key,request_hash,request_payload,provider_event_id,association_marker)
      VALUES($1,$2,$3,$4,$5,$6,'initiator','bind',$7,$8,$9,$10,$11)`,
      [
        id,
        workspaceId,
        connection.id,
        connection.generation,
        studentId,
        userId,
        key,
        hash,
        JSON.stringify({ bindingId }),
        eventId,
        randomUUID(),
      ],
    );
    return { bindingId, operationId: id };
  });
}
export async function processCalendarBind(
  op: CalendarOperation,
  provider: CalendarProvider,
): Promise<void> {
  await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(
      client,
      op.workspace_id,
      (op.adopted_by ?? op.initiating_user_id)!,
      true,
    );
    await lockCalendarOperation(client, op);
    await assertCalendarStudent(client, op.workspace_id, op.student_id!);
  });
  const event = await provider.get(
    op.connection_id,
    op.connection_generation,
    op.provider_event_id!,
  );
  if (
    !event ||
    event.id !== op.provider_event_id ||
    event.status === 'cancelled' ||
    event.recurringEventId ||
    !calendarEventTiming(event)
  )
    throw new CalendarError('unsupported_event');
  await calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(
      client,
      op.workspace_id,
      (op.adopted_by ?? op.initiating_user_id)!,
      true,
    );
    const current = await lockCalendarOperation(client, op);
    await assertCalendarStudent(client, op.workspace_id, op.student_id!);
    const marker = event.extendedProperties?.private?.eslAssociation;
    if (
      marker &&
      (
        await client.query(
          'SELECT id FROM calendar_schedule_bindings WHERE connection_id=$1 AND association_marker=$2',
          [current.id, marker],
        )
      ).rows.length
    )
      throw new CalendarError('association_continuity_requires_review');
    const bindingId = String(op.request_payload.bindingId);
    await client.query(
      `INSERT INTO calendar_schedule_bindings(id,workspace_id,student_id,connection_id,provider_event_id,kind,association_marker,source_version,setup_operation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        bindingId,
        op.workspace_id,
        op.student_id,
        current.id,
        event.id,
        event.recurrence?.length ? 'series' : 'one_off',
        op.association_marker,
        event.etag ?? null,
        op.id,
      ],
    );
    await enqueueCalendarRefresh(client, current, bindingId);
    await client.query(
      "UPDATE calendar_operations SET state='succeeded',event_url=$3,error_code=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
      [op.id, op.lease_token, safeCalendarEventUrl(event.htmlLink)],
    );
  });
}
