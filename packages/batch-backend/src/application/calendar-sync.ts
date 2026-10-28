import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import {
  type CalendarConnection,
  CalendarError,
  type CalendarOperation,
  calendarTransaction,
  enqueueCalendarRefresh,
  lockCalendarOperation,
} from '../domain/calendar-repository.js';
import type {
  CalendarProvider,
  GoogleCalendarEvent,
} from '../infrastructure/google-calendar-client.js';
import { GoogleCalendarError } from '../infrastructure/google-calendar-client.js';

interface ScheduleBinding {
  id: string;
  workspace_id: string;
  student_id: string;
  connection_id: string;
  provider_event_id: string;
  kind: 'one_off' | 'series';
  association_marker: string;
  source_version: string | null;
  setup_operation_id: string | null;
  attention_code: string | null;
  provider_deleted?: boolean;
}
interface LessonBinding {
  lesson_id: string;
  provider_event_id: string;
  original_start_time: string | null;
  provider_updated_at: Date | null;
  canceled_by_calendar: boolean;
  provider_status: string;
  source_version: string | null;
}
export function calendarEventTiming(
  event: GoogleCalendarEvent,
  contextTimezone?: string,
): { startsAt: Date; duration: number; timezone: string } | null {
  if (!event.start?.dateTime || !event.end?.dateTime || event.start.date || event.end.date)
    return null;
  // Offsets are mandatory in observations; never interpret a provider wall time in the host zone.
  if (
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(event.start.dateTime) ||
    !/(?:Z|[+-]\d{2}:\d{2})$/.test(event.end.dateTime)
  )
    return null;
  const start = new Date(event.start.dateTime),
    end = new Date(event.end.dateTime);
  const duration = (end.getTime() - start.getTime()) / 60000;
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isInteger(duration) ||
    duration <= 0 ||
    duration > 1440
  )
    return null;
  // A numeric offset establishes an instant, never a region. Prefer evidenced
  // provider event/master/calendar context and retain an offset if no zone exists.
  const offset = event.start.dateTime.match(/(Z|[+-]\d{2}:\d{2})$/)![1]!;
  return {
    startsAt: start,
    duration,
    timezone:
      event.start.timeZone ??
      event.originalStartTime?.timeZone ??
      contextTimezone ??
      (offset === 'Z' ? 'UTC' : offset),
  };
}
export function safeCalendarEventUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['calendar.google.com', 'www.google.com'].includes(url.hostname) &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
function occurrenceIdentity(event: GoogleCalendarEvent): string | null {
  if (!event.originalStartTime?.dateTime) return event.originalStartTime?.date ?? null;
  const date = new Date(event.originalStartTime.dateTime);
  return Number.isFinite(date.getTime()) &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(event.originalStartTime.dateTime)
    ? date.toISOString()
    : null;
}
async function attention(
  client: PoolClient,
  bindingId: string,
  lessonId: string | null,
  code: string,
): Promise<void> {
  await client.query('UPDATE calendar_schedule_bindings SET attention_code=$2 WHERE id=$1', [
    bindingId,
    code,
  ]);
  if (lessonId)
    await client.query('UPDATE calendar_lesson_bindings SET attention_code=$2 WHERE lesson_id=$1', [
      lessonId,
      code,
    ]);
}
/** Caller holds operation/connection fence; same row lock as completion/session linking. */
export async function projectCalendarObservation(
  client: PoolClient,
  binding: ScheduleBinding,
  event: GoogleCalendarEvent,
  now = new Date(),
  providerTimezone?: string,
): Promise<void> {
  const original = occurrenceIdentity(event);
  if (
    binding.kind === 'series' &&
    (event.recurringEventId !== binding.provider_event_id || !original)
  ) {
    const known = await client.query<LessonBinding>(
      'SELECT * FROM calendar_lesson_bindings WHERE connection_id=$1 AND provider_event_id=$2',
      [binding.connection_id, event.id],
    );
    if (event.status === 'cancelled' && known.rows[0])
      return cancelCalendarLesson(client, binding, known.rows[0], event, now);
    await attention(client, binding.id, null, 'association_required');
    return;
  }
  const existing = (
    await client.query<LessonBinding>(
      `SELECT * FROM calendar_lesson_bindings WHERE connection_id=$1 AND (provider_event_id=$2 OR (schedule_binding_id=$3 AND original_start_time=$4)) FOR UPDATE`,
      [binding.connection_id, event.id, binding.id, original],
    )
  ).rows;
  if (existing.length > 1) {
    await attention(client, binding.id, null, 'identity_conflict');
    return;
  }
  const link = existing[0];
  if (
    link &&
    event.updated &&
    link.provider_updated_at &&
    new Date(event.updated) < link.provider_updated_at
  )
    return;
  if (link && event.etag && link.source_version === event.etag) return;
  if (event.status === 'cancelled') {
    if (link) await cancelCalendarLesson(client, binding, link, event, now);
    return;
  }
  const calendarTimezone =
    providerTimezone ??
    (
      await client.query<{ calendar_timezone: string }>(
        'SELECT calendar_timezone FROM workspace_calendar_connections WHERE id=$1',
        [binding.connection_id],
      )
    ).rows[0]?.calendar_timezone;
  const timing = calendarEventTiming(event, calendarTimezone);
  if (!timing) {
    await attention(client, binding.id, link?.lesson_id ?? null, 'unsupported_event');
    return;
  }
  const declined =
    event.attendees?.some((attendee) => attendee.responseStatus === 'declined') ?? false;
  if (!link) {
    // A selected calendar is not an import of unrelated past teaching history.
    if (timing.startsAt < now) return;
    const lessonId = randomUUID();
    await client.query(
      `INSERT INTO student_lessons(id,student_id,workspace_id,starts_at,timezone,duration_minutes,title,status,consumes_credit)
      VALUES($1,$2,$3,$4,$5,$6,$7,'scheduled',false)`,
      [
        lessonId,
        binding.student_id,
        binding.workspace_id,
        timing.startsAt,
        timing.timezone,
        timing.duration,
        event.summary ?? null,
      ],
    );
    await client.query(
      `INSERT INTO calendar_lesson_bindings(lesson_id,schedule_binding_id,connection_id,provider_event_id,recurring_event_id,original_start_time,source_version,provider_updated_at,provider_status,event_url,attention_code)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        lessonId,
        binding.id,
        binding.connection_id,
        event.id,
        event.recurringEventId ?? null,
        original,
        event.etag ?? null,
        event.updated ?? null,
        event.status ?? 'confirmed',
        safeCalendarEventUrl(event.htmlLink),
        declined ? 'invitation_declined' : null,
      ],
    );
    return;
  }
  // A concurrent FK insertion can hold KEY SHARE while this waits. Take the row lock in
  // its own statement so the following READ COMMITTED snapshot sees newly committed links.
  await client.query('SELECT id FROM student_lessons WHERE id=$1 FOR UPDATE', [link.lesson_id]);
  const lesson = (
    await client.query(
      `SELECT l.*,
    EXISTS(SELECT 1 FROM student_credit_events c WHERE c.source_lesson_id=l.id OR c.id=l.credit_event_id) AS has_credit,
    EXISTS(SELECT 1 FROM assignment_sessions s WHERE s.lesson_id=l.id) AS has_session,
    EXISTS(SELECT 1 FROM prompt_packages p WHERE p.lesson_id=l.id) AS has_prompt,
    EXISTS(SELECT 1 FROM drafts d WHERE d.lesson_id=l.id) AS has_draft,
    EXISTS(SELECT 1 FROM jobs j WHERE j.lesson_id=l.id) AS has_job,
    EXISTS(SELECT 1 FROM homework_memory_entries h WHERE h.lesson_id=l.id) AS has_homework,
    EXISTS(SELECT 1 FROM student_profile_candidates p WHERE p.source_lesson_id=l.id) AS has_candidate
    FROM student_lessons l WHERE l.id=$1`,
      [link.lesson_id],
    )
  ).rows[0];
  if (
    !lesson ||
    lesson.workspace_id !== binding.workspace_id ||
    lesson.student_id !== binding.student_id
  )
    throw new CalendarError('lesson_ownership_conflict');
  const changed =
    new Date(lesson.starts_at).getTime() !== timing.startsAt.getTime() ||
    lesson.duration_minutes !== timing.duration ||
    lesson.timezone !== timing.timezone ||
    lesson.title !== (event.summary ?? null) ||
    Boolean(lesson.schedule_hidden_at) ||
    lesson.status !== 'scheduled';
  const protectedLesson =
    lesson.status === 'completed' ||
    lesson.status === 'no_show' ||
    lesson.consumes_credit ||
    lesson.credit_event_id ||
    lesson.completed_by ||
    lesson.has_credit ||
    lesson.has_session ||
    lesson.has_prompt ||
    lesson.has_draft ||
    lesson.has_job ||
    lesson.has_homework ||
    lesson.has_candidate ||
    new Date(lesson.starts_at) < now ||
    (lesson.schedule_hidden_at && lesson.schedule_hidden_reason !== 'calendar_projection_replaced');
  if (
    changed &&
    (protectedLesson || (lesson.status === 'canceled' && !link.canceled_by_calendar))
  ) {
    await attention(client, binding.id, link.lesson_id, 'protected_lesson_changed');
    return;
  }
  if (changed)
    await client.query(
      `UPDATE student_lessons SET starts_at=$2,timezone=$3,duration_minutes=$4,status='scheduled',title=$5,updated_by=NULL,updated_at=now(),schedule_hidden_at=NULL,schedule_hidden_reason=NULL,schedule_hidden_by=NULL WHERE id=$1`,
      [link.lesson_id, timing.startsAt, timing.timezone, timing.duration, event.summary ?? null],
    );
  await client.query(
    `UPDATE calendar_lesson_bindings SET provider_event_id=$2,source_version=$3,provider_updated_at=$4,provider_status=$5,canceled_by_calendar=false,event_url=$6,attention_code=$7 WHERE lesson_id=$1`,
    [
      link.lesson_id,
      event.id,
      event.etag ?? null,
      event.updated ?? null,
      event.status ?? 'confirmed',
      safeCalendarEventUrl(event.htmlLink),
      declined ? 'invitation_declined' : null,
    ],
  );
}
async function cancelCalendarLesson(
  client: PoolClient,
  binding: ScheduleBinding,
  link: LessonBinding,
  event: GoogleCalendarEvent,
  now: Date,
): Promise<void> {
  if (
    event.updated &&
    link.provider_updated_at &&
    new Date(event.updated) < link.provider_updated_at
  )
    return;
  // Lock before checking every accounting/lineage predicate, matching completion's lock boundary.
  const lesson = (
    await client.query('SELECT * FROM student_lessons WHERE id=$1 FOR UPDATE', [link.lesson_id])
  ).rows[0];
  if (!lesson) return;
  const refs = (
    await client.query(
      `SELECT
    EXISTS(SELECT 1 FROM student_credit_events WHERE source_lesson_id=$1 OR id=$2) OR
    EXISTS(SELECT 1 FROM assignment_sessions WHERE lesson_id=$1) OR
    EXISTS(SELECT 1 FROM prompt_packages WHERE lesson_id=$1) OR
    EXISTS(SELECT 1 FROM drafts WHERE lesson_id=$1) OR
    EXISTS(SELECT 1 FROM jobs WHERE lesson_id=$1) OR
    EXISTS(SELECT 1 FROM homework_memory_entries WHERE lesson_id=$1) OR
    EXISTS(SELECT 1 FROM student_profile_candidates WHERE source_lesson_id=$1) AS protected`,
      [link.lesson_id, lesson.credit_event_id],
    )
  ).rows[0];
  if (
    lesson.status !== 'scheduled' ||
    lesson.consumes_credit ||
    lesson.credit_event_id ||
    lesson.completed_by ||
    refs.protected ||
    new Date(lesson.starts_at) < now ||
    lesson.schedule_hidden_at
  ) {
    if (lesson.status === 'canceled' && link.canceled_by_calendar) return;
    await attention(client, binding.id, link.lesson_id, 'protected_lesson_deleted');
    return;
  }
  await client.query(
    "UPDATE student_lessons SET status='canceled',updated_by=NULL,updated_at=now() WHERE id=$1",
    [link.lesson_id],
  );
  await client.query(
    `UPDATE calendar_lesson_bindings SET source_version=$2,provider_updated_at=$3,provider_status='cancelled',canceled_by_calendar=true,attention_code=NULL WHERE lesson_id=$1`,
    [link.lesson_id, event.etag ?? null, event.updated ?? null],
  );
}
async function fencedProjection(
  op: CalendarOperation,
  fn: (client: PoolClient, connection: CalendarConnection) => Promise<void>,
): Promise<void> {
  await calendarTransaction(async (client) => {
    const connection = await lockCalendarOperation(client, op);
    await client.query(
      "SELECT set_config('app.calendar_sync','on',true),set_config('app.activity_actor_id','',true),set_config('app.user_id','',true)",
    );
    await fn(client, connection);
    await client.query(
      "UPDATE calendar_operations SET lease_expires_at=now()+interval '60 seconds',updated_at=now() WHERE id=$1 AND lease_token=$2",
      [op.id, op.lease_token],
    );
  });
}
export async function processCalendarSync(
  op: CalendarOperation,
  provider: CalendarProvider,
): Promise<void> {
  const connection = await calendarTransaction((client) => lockCalendarOperation(client, op));
  let page;
  try {
    page = await provider.changes(connection.id, String(connection.generation), {
      ...(connection.sync_token ? { syncToken: connection.sync_token } : {}),
      ...(connection.sync_page_token ? { pageToken: connection.sync_page_token } : {}),
    });
  } catch (error) {
    if (error instanceof GoogleCalendarError && error.code === 'cursor_expired') {
      await fencedProjection(op, async (client) => {
        await client.query(
          "UPDATE workspace_calendar_connections SET sync_token=NULL,sync_page_token=NULL,error_code='rebaselining' WHERE id=$1",
          [connection.id],
        );
        await client.query(
          "UPDATE calendar_operations SET state='pending',lease_token=NULL,lease_expires_at=NULL,due_at=now() WHERE id=$1",
          [op.id],
        );
      });
      return;
    }
    throw error;
  }
  await fencedProjection(op, async (client, current) => {
    const previousTokens = Array.isArray(op.request_payload.pageTokens)
      ? op.request_payload.pageTokens.filter((item): item is string => typeof item === 'string')
      : [];
    if (
      page.nextPageToken &&
      (page.nextPageToken === current.sync_page_token ||
        previousTokens.includes(page.nextPageToken))
    )
      throw new CalendarError('provider_pagination_cycle');
    for (const event of page.items) {
      const ids = (
        await client.query<{ id: string }>(
          `SELECT DISTINCT b.id FROM calendar_schedule_bindings b LEFT JOIN calendar_lesson_bindings l ON l.schedule_binding_id=b.id
        WHERE b.connection_id=$1 AND (b.provider_event_id=$2 OR b.provider_event_id=$3 OR l.provider_event_id=$2)`,
          [current.id, event.id, event.recurringEventId ?? null],
        )
      ).rows;
      for (const { id } of ids) {
        const binding = (
          await client.query<ScheduleBinding>(
            'SELECT * FROM calendar_schedule_bindings WHERE id=$1',
            [id],
          )
        ).rows[0]!;
        if (binding.kind === 'series') {
          // Keep feed-only tombstones durable with the refresh intent. Applying them before
          // all pages/related masters arrive exposes canceled/recreated implementation rows.
          await enqueueCalendarRefresh(client, current, id);
          await client.query(
            `UPDATE calendar_operations SET request_payload=jsonb_set(request_payload,'{observations}',
              COALESCE(request_payload->'observations','{}'::jsonb) || jsonb_build_object($3::text,$4::jsonb))
             WHERE connection_id=$1 AND kind='refresh' AND request_payload->>'bindingId'=$2 AND state IN ('pending','retry_wait')`,
            [current.id, id, event.id, JSON.stringify(event)],
          );
          continue;
        }
        // Tombstones may no longer be readable through events.get. Apply their authoritative
        // evidence in the same commit as the page checkpoint, then retain refresh work.
        if (event.status === 'cancelled') {
          await projectCalendarObservation(
            client,
            binding,
            event,
            new Date(),
            page.timeZone ?? current.calendar_timezone,
          );
          if (event.id === binding.provider_event_id) {
            await client.query(
              "UPDATE calendar_schedule_bindings SET next_projection_at='infinity',source_version=$2 WHERE id=$1",
              [id, event.etag ?? null],
            );
            continue;
          }
        } else if (event.id !== binding.provider_event_id || binding.kind === 'one_off')
          await projectCalendarObservation(
            client,
            binding,
            event,
            new Date(),
            page.timeZone ?? current.calendar_timezone,
          );
        await enqueueCalendarRefresh(client, current, id);
      }
      const marker = event.extendedProperties?.private?.eslAssociation;
      if (!ids.length && marker) {
        // A registered marker + durable request hash establishes student ownership only.
        // A split or a copy remains a distinct provider series; never merge occurrences.
        const source = (
          await client.query<ScheduleBinding>(
            `SELECT b.* FROM calendar_schedule_bindings b JOIN calendar_operations o ON o.id=b.setup_operation_id
           WHERE b.connection_id=$1 AND b.association_marker=$2 AND b.kind='series'
             AND o.kind='create' AND o.state='succeeded' AND o.request_hash=$3
             AND o.student_id=b.student_id AND o.workspace_id=b.workspace_id`,
            [current.id, marker, event.extendedProperties?.private?.eslRequest ?? null],
          )
        ).rows[0];
        if (
          source &&
          event.status !== 'cancelled' &&
          !event.recurringEventId &&
          event.recurrence?.length &&
          calendarEventTiming(event)
        ) {
          await client.query(
            `INSERT INTO calendar_schedule_bindings(id,workspace_id,student_id,connection_id,provider_event_id,kind,association_marker,setup_operation_id)
             VALUES($1,$2,$3,$4,$5,'series',$6,$7) ON CONFLICT(connection_id,provider_event_id) DO NOTHING`,
            [
              randomUUID(),
              source.workspace_id,
              source.student_id,
              current.id,
              event.id,
              randomUUID(),
              source.setup_operation_id,
            ],
          );
          await enqueueCalendarRefresh(client, current, source.id);
        } else
          await client.query(
            "UPDATE calendar_schedule_bindings SET attention_code='association_provenance_conflict' WHERE connection_id=$1 AND association_marker=$2",
            [current.id, marker],
          );
      }
    }
    if (page.nextPageToken) {
      await client.query(
        'UPDATE workspace_calendar_connections SET sync_page_token=$2 WHERE id=$1',
        [current.id, page.nextPageToken],
      );
      await client.query(
        "UPDATE calendar_operations SET state='pending',lease_token=NULL,lease_expires_at=NULL,due_at=now(),request_payload=jsonb_set(request_payload,'{pageTokens}',$2::jsonb) WHERE id=$1",
        [op.id, JSON.stringify([...previousTokens.slice(-1000), page.nextPageToken])],
      );
    } else {
      if (!page.nextSyncToken) throw new GoogleCalendarError('invalid_provider_response');
      // A full rebaseline revisits every known binding, preserving its ledger and identity.
      if (!current.sync_token) {
        const bindings = await client.query<{ id: string }>(
          'SELECT id FROM calendar_schedule_bindings WHERE connection_id=$1',
          [current.id],
        );
        for (const binding of bindings.rows)
          await enqueueCalendarRefresh(client, current, binding.id);
      }
      await client.query(
        "UPDATE workspace_calendar_connections SET sync_token=$2,sync_page_token=NULL,last_synced_at=now(),next_sync_at=now()+interval '60 seconds',error_code=NULL WHERE id=$1",
        [current.id, page.nextSyncToken],
      );
      await client.query(
        "UPDATE calendar_operations SET state='succeeded',lease_token=NULL,lease_expires_at=NULL,error_code=NULL WHERE id=$1",
        [op.id],
      );
    }
  });
}
export async function processCalendarRefresh(
  op: CalendarOperation,
  provider: CalendarProvider,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new CalendarError('calendar_shutdown');
  const binding = await calendarTransaction(async (client) => {
    await lockCalendarOperation(client, op);
    return (
      await client.query<ScheduleBinding>(
        'SELECT * FROM calendar_schedule_bindings WHERE id=$1 AND connection_id=$2',
        [op.request_payload.bindingId, op.connection_id],
      )
    ).rows[0];
  });
  if (!binding) throw new CalendarError('binding_not_found');
  if (binding.kind === 'series') {
    await projectCalendarSeriesFamily(op, binding, provider, signal);
    return;
  }
  const master = await provider.get(
    op.connection_id,
    op.connection_generation,
    binding.provider_event_id,
  );
  if (!master) {
    await fencedProjection(op, async (client) =>
      attention(client, binding.id, null, 'provider_event_missing'),
    );
    return;
  }
  if (master.id !== binding.provider_event_id)
    throw new CalendarError('provider_identity_conflict');
  if (master.status === 'cancelled') {
    await fencedProjection(op, async (client) => {
      const links = (
        await client.query<LessonBinding>(
          'SELECT * FROM calendar_lesson_bindings WHERE schedule_binding_id=$1 ORDER BY lesson_id',
          [binding.id],
        )
      ).rows;
      for (const link of links)
        await cancelCalendarLesson(client, binding, link, master, new Date());
    });
    return;
  }
  if (binding.kind === 'one_off') {
    await fencedProjection(op, (client) => projectCalendarObservation(client, binding, master));
    return;
  }
}

/** A family shares exact durable creation provenance, never inferred occurrence identity. */
async function projectCalendarSeriesFamily(
  op: CalendarOperation,
  binding: ScheduleBinding,
  provider: CalendarProvider,
  signal?: AbortSignal,
): Promise<void> {
  const snapshot = await calendarTransaction(async (client) => {
    const current = await lockCalendarOperation(client, op);
    if (current.sync_page_token) throw new GoogleCalendarError('provider_unavailable', true);
    const family = (
      await client.query<ScheduleBinding>(
        `SELECT *,next_projection_at='infinity'::timestamptz AS provider_deleted FROM calendar_schedule_bindings WHERE connection_id=$1 AND kind='series'
       AND (id=$2 OR ($3::uuid IS NOT NULL AND setup_operation_id=$3 AND student_id=$4)) ORDER BY id LIMIT 33`,
        [binding.connection_id, binding.id, binding.setup_operation_id, binding.student_id],
      )
    ).rows;
    if (family.length > 32) throw new CalendarError('provider_projection_limit');
    const ids = family.map((item) => item.id);
    const known = (
      await client.query<LessonBinding & { schedule_binding_id: string }>(
        `SELECT b.* FROM calendar_lesson_bindings b JOIN student_lessons l ON l.id=b.lesson_id
       WHERE b.schedule_binding_id=ANY($1::uuid[]) AND l.starts_at>=now() ORDER BY b.lesson_id LIMIT 1001`,
        [ids],
      )
    ).rows;
    if (known.length > 1000) throw new CalendarError('provider_projection_limit');
    const pending = (
      await client.query<{ request_payload: Record<string, unknown> }>(
        `SELECT request_payload FROM calendar_operations WHERE connection_id=$1 AND connection_generation=$2
       AND kind='refresh' AND state IN ('pending','retry_wait','running') AND request_payload->>'bindingId'=ANY($3::text[]) ORDER BY created_at`,
        [op.connection_id, op.connection_generation, ids],
      )
    ).rows;
    const observations = new Map<string, GoogleCalendarEvent>();
    for (const row of pending)
      for (const event of Object.values(row.request_payload.observations ?? {})) {
        const value = event as GoogleCalendarEvent;
        if (value?.id) observations.set(value.id, value);
      }
    return { family, known, observations };
  });
  const now = new Date(),
    timeMin = now.toISOString(),
    timeMax = new Date(now.getTime() + 120 * 86400000).toISOString();
  const collections: {
    binding: ScheduleBinding;
    master: GoogleCalendarEvent;
    events: Map<string, GoogleCalendarEvent>;
    missing: Set<string>;
    timezone?: string;
  }[] = [];
  const renewLease = () => fencedProjection(op, async () => {});
  for (const item of snapshot.family) {
    if (signal?.aborted) throw new CalendarError('calendar_shutdown');
    const master =
      (await provider.get(op.connection_id, op.connection_generation, item.provider_event_id)) ??
      snapshot.observations.get(item.provider_event_id) ??
      (item.provider_deleted
        ? {
            id: item.provider_event_id,
            status: 'cancelled',
            etag: item.source_version ?? undefined,
          }
        : undefined);
    await renewLease();
    if (!master || master.id !== item.provider_event_id)
      throw new GoogleCalendarError('provider_unavailable', true);
    const events = new Map<string, GoogleCalendarEvent>(),
      missing = new Set<string>(),
      tokens = new Set<string>();
    let token: string | undefined;
    let timezone = master.start?.timeZone;
    if (master.status !== 'cancelled')
      do {
        if (signal?.aborted) throw new CalendarError('calendar_shutdown');
        const page = await provider.instances(
          op.connection_id,
          op.connection_generation,
          item.provider_event_id,
          { timeMin, timeMax, ...(token ? { pageToken: token } : {}) },
        );
        await renewLease();
        timezone ??= page.timeZone;
        for (const event of page.items) {
          if (event.recurringEventId !== item.provider_event_id || !occurrenceIdentity(event))
            throw new CalendarError('provider_identity_conflict');
          events.set(event.id, event);
        }
        if (events.size > 8000) throw new CalendarError('provider_projection_limit');
        token = page.nextPageToken;
        if (token) {
          if (tokens.has(token)) throw new CalendarError('provider_pagination_cycle');
          tokens.add(token);
          if (tokens.size >= 32) throw new CalendarError('provider_projection_limit');
        }
      } while (token);
    for (const link of snapshot.known.filter((link) => link.schedule_binding_id === item.id)) {
      if (events.has(link.provider_event_id)) continue;
      if (master.status === 'cancelled') {
        missing.add(link.lesson_id);
        continue;
      }
      const event =
        (await provider.get(op.connection_id, op.connection_generation, link.provider_event_id)) ??
        snapshot.observations.get(link.provider_event_id);
      await renewLease();
      if (event && event.id !== link.provider_event_id)
        throw new CalendarError('provider_identity_conflict');
      if (event) events.set(event.id, event);
      else {
        const original = link.original_start_time ? new Date(link.original_start_time) : null;
        if (original && original >= now && original < new Date(timeMax))
          missing.add(link.lesson_id);
        else throw new GoogleCalendarError('provider_unavailable', true);
      }
    }
    // Retry the whole observation if Google changed a master during pagination.
    const latest = await provider.get(
      op.connection_id,
      op.connection_generation,
      item.provider_event_id,
    );
    await renewLease();
    if ((!latest && master.status !== 'cancelled') || (latest && latest.etag !== master.etag))
      throw new GoogleCalendarError('provider_unavailable', true);
    collections.push({ binding: item, master, events, missing, timezone });
  }
  await fencedProjection(op, async (client, current) => {
    if (current.sync_page_token) throw new GoogleCalendarError('provider_unavailable', true);
    const latestFamily = (
      await client.query<{ id: string }>(
        `SELECT id FROM calendar_schedule_bindings WHERE connection_id=$1 AND kind='series'
       AND (id=$2 OR ($3::uuid IS NOT NULL AND setup_operation_id=$3 AND student_id=$4)) ORDER BY id`,
        [binding.connection_id, binding.id, binding.setup_operation_id, binding.student_id],
      )
    ).rows;
    if (
      latestFamily.map((item) => item.id).join(':') !==
      snapshot.family.map((item) => item.id).join(':')
    )
      throw new GoogleCalendarError('provider_unavailable', true);
    // Keep authoritative deletion evidence even when protected history pauses this batch.
    // Later refreshes must not depend on an unfinished operation retaining its feed payload.
    for (const collection of collections)
      if (collection.master.status === 'cancelled')
        await client.query(
          "UPDATE calendar_schedule_bindings SET next_projection_at='infinity',source_version=$2 WHERE id=$1",
          [collection.binding.id, collection.master.etag ?? null],
        );
    const lost = snapshot.known.filter((link) => {
      const collection = collections.find((item) => item.binding.id === link.schedule_binding_id)!;
      const event = collection.events.get(link.provider_event_id);
      return collection.missing.has(link.lesson_id) || event?.status === 'cancelled';
    });
    const added = collections.some((collection) =>
      [...collection.events.values()].some(
        (event) =>
          event.status !== 'cancelled' &&
          !snapshot.known.some(
            (link) =>
              link.provider_event_id === event.id ||
              (link.schedule_binding_id === collection.binding.id &&
                link.original_start_time === occurrenceIdentity(event)),
          ),
      ),
    );
    // A successor can appear before/after the old master's feed item. Its exact creation
    // family is sufficient to replace unused projections, not to remap protected history.
    const replacing =
      added ||
      snapshot.family.length > 1 ||
      collections.some((collection) =>
        [...collection.events.values()].some((event) => event.status !== 'cancelled'),
      );
    if (replacing && lost.length) {
      const eligible = [];
      for (const link of lost) {
        if (await canReplaceCalendarProjection(client, link, now)) eligible.push(link);
        else {
          for (const item of snapshot.family)
            await attention(client, item.id, null, 'protected_series_changed');
          await attention(
            client,
            link.schedule_binding_id,
            link.lesson_id,
            'protected_series_changed',
          );
          return;
        }
      }
      for (const link of eligible) {
        await client.query(
          `UPDATE student_lessons SET schedule_hidden_at=now(),schedule_hidden_reason='calendar_projection_replaced',updated_by=NULL,updated_at=now() WHERE id=$1`,
          [link.lesson_id],
        );
        await client.query(
          "UPDATE calendar_lesson_bindings SET provider_status='cancelled',canceled_by_calendar=true,source_version=NULL,attention_code=NULL WHERE lesson_id=$1",
          [link.lesson_id],
        );
      }
    }
    for (const collection of collections) {
      const item = collection.binding;
      for (const event of collection.events.values()) {
        if (
          replacing &&
          lost.some(
            (link) => link.schedule_binding_id === item.id && link.provider_event_id === event.id,
          )
        )
          continue;
        await projectCalendarObservation(
          client,
          item,
          event,
          now,
          collection.timezone ?? current.calendar_timezone,
        );
      }
      if (!replacing)
        for (const link of snapshot.known.filter((link) => collection.missing.has(link.lesson_id)))
          await cancelCalendarLesson(
            client,
            item,
            link,
            { id: link.provider_event_id, status: 'cancelled', updated: collection.master.updated },
            now,
          );
      await client.query(
        `UPDATE calendar_schedule_bindings SET projected_until=$2,next_projection_at=CASE WHEN $4 THEN 'infinity'::timestamptz ELSE now()+interval '1 day' END,source_version=$3,
         attention_code=CASE WHEN attention_code IN ('association_required','protected_series_changed') THEN NULL ELSE attention_code END WHERE id=$1`,
        [
          item.id,
          timeMax,
          collection.master.etag ?? null,
          collection.master.status === 'cancelled',
        ],
      );
    }
  });
}

async function canReplaceCalendarProjection(
  client: PoolClient,
  link: LessonBinding,
  now: Date,
): Promise<boolean> {
  await client.query('SELECT id FROM student_lessons WHERE id=$1 FOR UPDATE', [link.lesson_id]);
  // Read after the row lock: an FK/source writer may have committed while we waited.
  const row = (
    await client.query(
      `SELECT l.*,
      EXISTS(SELECT 1 FROM student_credit_events c WHERE c.source_lesson_id=l.id OR c.id=l.credit_event_id) OR
      EXISTS(SELECT 1 FROM assignment_sessions a WHERE a.lesson_id=l.id OR (a.student_id=l.student_id AND jsonb_path_exists(to_jsonb(a),'$.** ? (@ == $lesson)',jsonb_build_object('lesson',l.id::text)))) OR
      EXISTS(SELECT 1 FROM prompt_packages p WHERE p.lesson_id=l.id) OR
      EXISTS(SELECT 1 FROM drafts d WHERE d.lesson_id=l.id) OR
      EXISTS(SELECT 1 FROM jobs j WHERE j.lesson_id=l.id) OR
      EXISTS(SELECT 1 FROM homework_memory_entries h WHERE h.lesson_id=l.id) OR
      EXISTS(SELECT 1 FROM student_profile_candidates p WHERE p.source_lesson_id=l.id) OR
      EXISTS(SELECT 1 FROM student_reminder_preferences r WHERE r.workspace_id=l.workspace_id AND
        (r.latest_hidden_lesson_followup_lesson_id=l.id OR r.latest_hidden_lesson_followup_key LIKE '%'||l.id::text||'%'
         OR EXISTS(SELECT 1 FROM unnest(r.hidden_lesson_followup_keys) k WHERE k LIKE '%'||l.id::text||'%'))) OR
      EXISTS(SELECT 1 FROM student_activity a WHERE a.workspace_id=l.workspace_id
        AND (a.entity_id=l.id OR jsonb_path_exists(a.payload,'$.** ? (@ == $lesson)',jsonb_build_object('lesson',l.id::text)))
        AND NOT(a.entity_id=l.id AND a.actor_kind='system' AND a.type IN ('lesson_created','lesson_changed','lesson_canceled','lesson_restored')))
      AS protected FROM student_lessons l WHERE l.id=$1`,
      [link.lesson_id],
    )
  ).rows[0];
  return Boolean(
    row &&
      !row.protected &&
      !row.consumes_credit &&
      !row.credit_event_id &&
      !row.completed_by &&
      new Date(row.starts_at) >= now &&
      (row.status === 'scheduled' || (row.status === 'canceled' && link.canceled_by_calendar)) &&
      (!row.schedule_hidden_at || row.schedule_hidden_reason === 'calendar_projection_replaced'),
  );
}
