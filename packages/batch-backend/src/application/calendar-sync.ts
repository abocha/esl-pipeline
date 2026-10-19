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
  return { startsAt: start, duration, timezone: event.start.timeZone ?? 'UTC' };
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
  const timing = calendarEventTiming(event);
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
    lesson.schedule_hidden_at;
  if (
    changed &&
    (protectedLesson || (lesson.status === 'canceled' && !link.canceled_by_calendar))
  ) {
    await attention(client, binding.id, link.lesson_id, 'protected_lesson_changed');
    return;
  }
  if (changed)
    await client.query(
      `UPDATE student_lessons SET starts_at=$2,timezone=$3,duration_minutes=$4,status='scheduled',title=$5,updated_by=NULL,updated_at=now() WHERE id=$1`,
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
        // Tombstones may no longer be readable through events.get. Apply their authoritative
        // evidence in the same commit as the page checkpoint, then retain refresh work.
        if (event.status === 'cancelled') {
          if (event.id === binding.provider_event_id && binding.kind === 'series') {
            const links = (
              await client.query<LessonBinding>(
                'SELECT * FROM calendar_lesson_bindings WHERE schedule_binding_id=$1 ORDER BY lesson_id',
                [id],
              )
            ).rows;
            for (const link of links)
              await cancelCalendarLesson(client, binding, link, event, new Date());
          } else await projectCalendarObservation(client, binding, event);
          if (event.id === binding.provider_event_id) {
            await client.query(
              "UPDATE calendar_schedule_bindings SET next_projection_at='infinity',source_version=$2 WHERE id=$1",
              [id, event.etag ?? null],
            );
            continue;
          }
        } else if (event.id !== binding.provider_event_id || binding.kind === 'one_off')
          await projectCalendarObservation(client, binding, event);
        await enqueueCalendarRefresh(client, current, id);
      }
      const marker = event.extendedProperties?.private?.eslAssociation;
      if (!ids.length && marker)
        await client.query(
          "UPDATE calendar_schedule_bindings SET attention_code='association_required' WHERE connection_id=$1 AND association_marker=$2",
          [current.id, marker],
        );
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
  const timeMin = new Date().toISOString(),
    timeMax = new Date(Date.now() + 120 * 86400000).toISOString();
  const seen = new Set<string>();
  const pageTokens = new Set<string>();
  let token: string | undefined;
  do {
    if (signal?.aborted) throw new CalendarError('calendar_shutdown');
    const page = await provider.instances(
      op.connection_id,
      op.connection_generation,
      binding.provider_event_id,
      { timeMin, timeMax, ...(token ? { pageToken: token } : {}) },
    );
    await fencedProjection(op, async (client) => {
      for (const event of page.items) {
        seen.add(event.id);
        await projectCalendarObservation(client, binding, event);
      }
    });
    token = page.nextPageToken;
    if (token) {
      if (pageTokens.has(token)) throw new CalendarError('provider_pagination_cycle');
      pageTokens.add(token);
      if (pageTokens.size >= 32) throw new CalendarError('provider_projection_limit');
    }
  } while (token);
  // Only after complete pagination: targeted checks cover moved/out-of-range/removed known occurrences.
  const known = await calendarTransaction(async (client) => {
    await lockCalendarOperation(client, op);
    return (
      await client.query<LessonBinding>(
        `SELECT b.* FROM calendar_lesson_bindings b JOIN student_lessons l ON l.id=b.lesson_id WHERE b.schedule_binding_id=$1 AND l.starts_at>=now() AND l.status IN ('scheduled','canceled') AND NOT(b.provider_event_id=ANY($2::text[])) ORDER BY b.lesson_id LIMIT 65`,
        [binding.id, [...seen]],
      )
    ).rows;
  });
  if (known.length > 64) throw new CalendarError('provider_projection_limit');
  for (const link of known) {
    if (signal?.aborted) throw new CalendarError('calendar_shutdown');
    if (seen.has(link.provider_event_id)) continue;
    const event = await provider.get(
      op.connection_id,
      op.connection_generation,
      link.provider_event_id,
    );
    await fencedProjection(op, async (client) => {
      if (event) await projectCalendarObservation(client, binding, event);
      else {
        // A completed provider-expanded range plus a targeted missing identity is absence
        // evidence only within that original range, while the master remains readable.
        const original = link.original_start_time ? new Date(link.original_start_time) : null;
        if (original && original >= new Date(timeMin) && original < new Date(timeMax))
          await cancelCalendarLesson(
            client,
            binding,
            link,
            { id: link.provider_event_id, status: 'cancelled', updated: master.updated },
            new Date(),
          );
        else await attention(client, binding.id, link.lesson_id, 'provider_occurrence_missing');
      }
    });
  }
  await fencedProjection(op, async (client) => {
    await client.query(
      "UPDATE calendar_schedule_bindings SET projected_until=$2,next_projection_at=now()+interval '1 day',source_version=$3 WHERE id=$1",
      [binding.id, timeMax, master.etag ?? null],
    );
  });
}
