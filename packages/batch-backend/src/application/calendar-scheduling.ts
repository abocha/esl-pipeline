import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  CalendarOperationDto,
  CalendarOperationReviewDto,
  CalendarSchedulingStatusDto,
  CalendarSetupDto,
  CalendarSetupRequestDto,
  CalendarSlotDto,
} from '@esl-pipeline/contracts';
import { calendarSetupRequestSchema } from '@esl-pipeline/contracts';

import {
  CalendarError,
  type CalendarOperation,
  calendarTransaction,
  hashCalendarRequest,
  lockCalendarConnection,
  newCalendarEventId,
} from '../domain/calendar-repository.js';
import { assertWorkspaceCalendarRole } from '../domain/google-connection-repository.js';

function wallParts(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}
/** Resolve one requested wall time, rejecting both DST gaps and folds. Never expands recurrence. */
export function resolveCalendarWallTime(date: string, time: string, timezone: string): Date {
  const wall = `${date}T${time}`;
  const naive = Date.parse(`${wall}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== wall)
    throw new CalendarError('invalid_local_time', 400);
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en', { timeZone: timezone });
    formatter.format(new Date());
  } catch {
    throw new CalendarError('invalid_timezone', 400);
  }
  const offsets = new Set<number>();
  for (let h = -48; h <= 48; h += 6) {
    const probe = naive + h * 3600000;
    offsets.add(Date.parse(`${wallParts(new Date(probe), timezone)}:00Z`) - probe);
  }
  const matches = [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((candidate) => wallParts(candidate, timezone) === wall);
  if (matches.length !== 1)
    throw new CalendarError(
      matches.length ? 'ambiguous_local_time' : 'nonexistent_local_time',
      400,
    );
  return matches[0]!;
}
function firstSlotDate(slot: CalendarSlotDto): string {
  const date = new Date(`${slot.startDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== slot.startDate)
    throw new CalendarError('invalid_date', 400);
  if (slot.kind === 'weekly')
    date.setUTCDate(date.getUTCDate() + ((slot.weekday! - date.getUTCDay() + 7) % 7));
  const first = date.toISOString().slice(0, 10);
  if (slot.endDate && first > slot.endDate) throw new CalendarError('empty_series', 400);
  return first;
}
export function calendarEventProjection(
  request: CalendarSetupRequestDto,
  slot: CalendarSlotDto,
  id: string,
  marker: string,
  requestHash: string,
  recipient: string | null,
): Record<string, unknown> {
  const startsAt = resolveCalendarWallTime(firstSlotDate(slot), slot.localTime, request.timezone);
  const end = new Date(startsAt.getTime() + slot.durationMinutes * 60000);
  const recurrence =
    slot.kind === 'weekly'
      ? [
          `RRULE:FREQ=WEEKLY;BYDAY=${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][slot.weekday!]}${slot.endDate ? `;UNTIL=${resolveCalendarWallTime(slot.endDate, '23:59', request.timezone).toISOString().replace(/[-:]/g, '').replace('.000', '')}` : ''}`,
        ]
      : undefined;
  return {
    id,
    summary: request.title,
    start: { dateTime: startsAt.toISOString(), timeZone: request.timezone },
    end: { dateTime: end.toISOString(), timeZone: request.timezone },
    ...(recurrence ? { recurrence } : {}),
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    ...(recipient ? { attendees: [{ email: recipient }] } : {}),
    extendedProperties: { private: { eslAssociation: marker, eslRequest: requestHash } },
  };
}
export const calendarOperationDto = (op: CalendarOperation): CalendarOperationDto => ({
  id: op.id,
  parentId: op.parent_id,
  kind: op.kind,
  state: op.state,
  errorCode: op.error_code,
  slotIndex: op.slot_index,
  eventUrl: op.event_url,
});
export async function assertCalendarStudent(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<{ email: string | null }> {
  const { rows } = await client.query<{ email: string | null }>(
    'SELECT email FROM students WHERE id=$1 AND workspace_id=$2 AND archived_at IS NULL FOR SHARE',
    [studentId, workspaceId],
  );
  if (!rows[0]) throw new CalendarError('student_not_found', 404);
  return rows[0];
}
export async function createCalendarSetup(
  workspaceId: string,
  studentId: string,
  userId: string,
  key: string,
  input: CalendarSetupRequestDto,
): Promise<CalendarSetupDto> {
  const request = calendarSetupRequestSchema.parse(input);
  if (!key || key.length > 150) throw new CalendarError('invalid_idempotency_key', 400);
  return calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId);
    const student = await assertCalendarStudent(client, workspaceId, studentId);
    // Normalize invitation choice into the immutable payload; student email is captured once.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${workspaceId}:setup:${key}`,
    ]);
    const prior = await client.query<CalendarOperation>(
      "SELECT * FROM calendar_operations WHERE workspace_id=$1 AND kind='setup' AND idempotency_key=$2",
      [workspaceId, key],
    );
    if (prior.rows[0]) {
      // Student contact changes cannot alter a previously accepted request.
      const old = prior.rows[0];
      const accepted = old.request_payload.request as CalendarSetupRequestDto;
      if (
        hashCalendarRequest({
          studentId,
          request: {
            ...request,
            sendInvitation: request.sendInvitation ?? accepted.sendInvitation,
          },
        }) !== hashCalendarRequest({ studentId: old.request_payload.studentId, request: accepted })
      )
        throw new CalendarError('idempotency_conflict');
      return loadSetup(client, workspaceId, old.id);
    }
    const invite = request.sendInvitation ?? Boolean(student.email);
    if (invite && !student.email) throw new CalendarError('invitation_email_required', 400);
    const payload = {
      studentId,
      request: { ...request, sendInvitation: invite },
      recipient: invite ? student.email : null,
    };
    const hash = hashCalendarRequest(payload);
    const connectionRows = await client.query<{ id: string }>(
      "SELECT id FROM workspace_calendar_connections WHERE workspace_id=$1 AND status='connected' ORDER BY id LIMIT 1",
      [workspaceId],
    );
    if (!connectionRows.rows[0]) throw new CalendarError('calendar_required');
    const connection = await lockCalendarConnection(client, connectionRows.rows[0].id);
    const setupId = randomUUID();
    // Validate every child before storing any intent.
    const children = request.slots.map((slot, index) => {
      const id = randomUUID(),
        eventId = newCalendarEventId(),
        marker = randomUUID(),
        childHash = hashCalendarRequest({ hash, index });
      return {
        id,
        eventId,
        marker,
        index,
        event: calendarEventProjection(
          request,
          slot,
          eventId,
          marker,
          childHash,
          payload.recipient,
        ),
        childHash,
      };
    });
    await client.query(
      `INSERT INTO calendar_operations(id,workspace_id,connection_id,connection_generation,student_id,initiating_user_id,authority_policy,kind,idempotency_key,request_hash,request_payload,state)
      VALUES($1,$2,$3,$4,$5,$6,'initiator','setup',$7,$8,$9,'succeeded')`,
      [
        setupId,
        workspaceId,
        connection.id,
        connection.generation,
        studentId,
        userId,
        key,
        hash,
        JSON.stringify(payload),
      ],
    );
    for (const child of children)
      await client.query(
        `INSERT INTO calendar_operations(id,workspace_id,connection_id,connection_generation,student_id,initiating_user_id,authority_policy,parent_id,kind,idempotency_key,request_hash,request_payload,provider_event_id,association_marker,slot_index)
      VALUES($1,$2,$3,$4,$5,$6,'initiator',$7,'create',$8,$9,$10,$11,$12,$13)`,
        [
          child.id,
          workspaceId,
          connection.id,
          connection.generation,
          studentId,
          userId,
          setupId,
          `${key}:${child.index}`,
          child.childHash,
          JSON.stringify({ event: child.event, invite }),
          child.eventId,
          child.marker,
          child.index,
        ],
      );
    return loadSetup(client, workspaceId, setupId);
  });
}
async function loadSetup(
  client: PoolClient,
  workspaceId: string,
  id: string,
): Promise<CalendarSetupDto> {
  const { rows } = await client.query<CalendarOperation>(
    'SELECT * FROM calendar_operations WHERE workspace_id=$1 AND (id=$2 OR parent_id=$2) ORDER BY slot_index NULLS FIRST',
    [workspaceId, id],
  );
  if (!rows.some((op) => op.id === id && op.kind === 'setup'))
    throw new CalendarError('setup_not_found', 404);
  return { id, operations: rows.filter((op) => op.kind !== 'setup').map(calendarOperationDto) };
}
export async function getCalendarSetup(workspaceId: string, userId: string, id: string) {
  return calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId);
    return loadSetup(client, workspaceId, id);
  });
}
export async function retryCalendarOperation(workspaceId: string, userId: string, id: string) {
  return calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId);
    const { rows } = await client.query<CalendarOperation>(
      'SELECT * FROM calendar_operations WHERE id=$1 AND workspace_id=$2',
      [id, workspaceId],
    );
    const op = rows[0];
    if (!op) throw new CalendarError('operation_not_found', 404);
    if (op.authority_policy === 'initiator' && (op.adopted_by ?? op.initiating_user_id) !== userId)
      throw new CalendarError('operation_adoption_required', 403);
    if (op.authority_policy === 'workspace_service')
      await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    await lockCalendarConnection(client, op.connection_id, op.connection_generation);
    const current = (
      await client.query<CalendarOperation>(
        'SELECT * FROM calendar_operations WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0]!;
    if (op.student_id) await assertCalendarStudent(client, workspaceId, op.student_id);
    if (current.state === 'running') throw new CalendarError('operation_in_flight');
    if (current.state === 'succeeded' || current.state === 'superseded' || current.kind === 'setup')
      throw new CalendarError('operation_not_retryable');
    await client.query(
      "UPDATE calendar_operations SET state='pending',error_code=NULL,due_at=now(),updated_at=now() WHERE id=$1",
      [id],
    );
  });
}
/** Explicit privileged review is the only API that exposes the captured invitation recipient. */
export async function reviewCalendarOperation(
  workspaceId: string,
  userId: string,
  id: string,
): Promise<CalendarOperationReviewDto> {
  return calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    const op = (
      await client.query<CalendarOperation>(
        "SELECT * FROM calendar_operations WHERE id=$1 AND workspace_id=$2 AND kind='create'",
        [id, workspaceId],
      )
    ).rows[0];
    if (!op) throw new CalendarError('operation_not_found', 404);
    const event = op.request_payload.event as {
      summary: string;
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string };
      recurrence?: string[];
      attendees?: { email: string }[];
    };
    return {
      id: op.id,
      requestHash: op.request_hash,
      title: event.summary,
      startsAt: event.start.dateTime,
      endsAt: event.end.dateTime,
      timezone: event.start.timeZone,
      recurrence: event.recurrence ?? [],
      invitationRecipient: event.attendees?.[0]?.email ?? null,
    };
  });
}
export async function adoptCalendarOperation(
  workspaceId: string,
  userId: string,
  id: string,
  reviewedRequestHash: string,
): Promise<void> {
  return calendarTransaction(async (client) => {
    await assertWorkspaceCalendarRole(client, workspaceId, userId, true);
    const snapshot = (
      await client.query<CalendarOperation>(
        "SELECT * FROM calendar_operations WHERE id=$1 AND workspace_id=$2 AND kind='create'",
        [id, workspaceId],
      )
    ).rows[0];
    if (!snapshot) throw new CalendarError('operation_not_found', 404);
    await lockCalendarConnection(client, snapshot.connection_id, snapshot.connection_generation);
    const op = (
      await client.query<CalendarOperation>(
        'SELECT * FROM calendar_operations WHERE id=$1 FOR UPDATE',
        [id],
      )
    ).rows[0]!;
    if (op.request_hash !== reviewedRequestHash)
      throw new CalendarError('operation_review_changed');
    if (op.state === 'running') throw new CalendarError('operation_in_flight');
    if (op.state === 'succeeded' || op.state === 'superseded')
      throw new CalendarError('operation_not_retryable');
    await assertCalendarStudent(client, workspaceId, op.student_id!);
    await client.query(
      "UPDATE calendar_operations SET adopted_by=$2,state='pending',error_code=NULL,due_at=now(),updated_at=now() WHERE id=$1",
      [id, userId],
    );
  });
}
export async function getCalendarSchedulingStatus(
  workspaceId: string,
  userId: string,
): Promise<CalendarSchedulingStatusDto> {
  return calendarTransaction(async (client) => {
    const member = await client.query(
      `SELECT 1 FROM workspace_memberships m JOIN users u ON u.id=m.user_id
       WHERE m.workspace_id=$1 AND m.user_id=$2 AND u.is_active`,
      [workspaceId, userId],
    );
    if (!member.rowCount) throw new CalendarError('calendar_permission_changed', 403);
    const { rows } = await client.query(
      `SELECT c.*,g.google_email FROM workspace_calendar_connections c JOIN google_oauth_grants g ON g.id=c.grant_id WHERE c.workspace_id=$1 ORDER BY (c.status<>'disconnected') DESC,c.updated_at DESC LIMIT 1`,
      [workspaceId],
    );
    const c = rows[0];
    const ops = await client.query<CalendarOperation>(
      `SELECT * FROM calendar_operations WHERE workspace_id=$1 AND kind<>'setup' AND (state<>'succeeded' OR created_at>now()-interval '1 day') ORDER BY created_at DESC LIMIT 100`,
      [workspaceId],
    );
    const flags = c
      ? (
          await client.query<{ pending: boolean; needs_review: boolean; attention: boolean }>(
            `SELECT
    EXISTS(SELECT 1 FROM calendar_operations WHERE connection_id=$1 AND connection_generation=$2 AND state IN ('pending','running','retry_wait')) AS pending,
    EXISTS(SELECT 1 FROM calendar_operations WHERE connection_id=$1 AND connection_generation=$2 AND state='needs_review') AS needs_review,
    EXISTS(SELECT 1 FROM calendar_schedule_bindings WHERE connection_id=$1 AND attention_code IS NOT NULL) OR
    EXISTS(SELECT 1 FROM calendar_lesson_bindings WHERE connection_id=$1 AND attention_code IS NOT NULL) AS attention`,
            [c.id, c.generation],
          )
        ).rows[0]
      : null;
    const stale = Boolean(c?.last_synced_at && Date.now() - c.last_synced_at.getTime() > 180_000);
    return {
      state:
        !c || c.status === 'disconnected'
          ? 'disconnected'
          : c.status === 'reconnect_required'
            ? 'reconnect_required'
            : c.error_code || flags?.needs_review || flags?.attention
              ? 'needs_attention'
              : flags?.pending
                ? 'syncing'
                : stale
                  ? 'needs_attention'
                  : c.last_synced_at
                    ? 'synced'
                    : 'syncing',
      connectionId: c?.id ?? null,
      calendarName: c?.calendar_name ?? null,
      googleEmail: c?.google_email ?? null,
      lastSyncedAt: c?.last_synced_at?.toISOString() ?? null,
      errorCode:
        c?.error_code ??
        (stale ? 'sync_stale' : flags?.attention ? 'lesson_attention_required' : null),
      operations: ops.rows.map(calendarOperationDto),
    };
  });
}
