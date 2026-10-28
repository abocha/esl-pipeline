import './support/bootstrap-pg-test-env.js';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CalendarSetupRequestDto } from '@esl-pipeline/contracts';

import {
  bindCalendarEvent,
  listUnlinkedCalendarEvents,
} from '../src/application/calendar-association.js';
import {
  dispatchCalendarWork,
  processCalendarCreate,
} from '../src/application/calendar-dispatcher.js';
import {
  adoptCalendarOperation,
  createCalendarSetup,
  getCalendarSchedulingStatus,
  getCalendarSetup,
  retryCalendarOperation,
  reviewCalendarOperation,
} from '../src/application/calendar-scheduling.js';
import {
  processCalendarRefresh,
  processCalendarSync,
  projectCalendarObservation,
} from '../src/application/calendar-sync.js';
import { getStudentActivity } from '../src/application/student-activity.js';
import { updateStudentLesson } from '../src/application/student-schedule-billing.js';
import { confirmStudentAssignmentSession } from '../src/domain/assignment-session-repository.js';
import {
  type CalendarOperation,
  calendarTransaction,
  lockCalendarOperation,
} from '../src/domain/calendar-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import {
  type CalendarProvider,
  GoogleCalendarError,
  type GoogleCalendarEvent,
  type GoogleCalendarPage,
} from '../src/infrastructure/google-calendar-client.js';

const connectionString = process.env.BATCH_BACKEND_TEST_PG?.trim();
const describePg = connectionString ? describe : describe.skip;
const request: CalendarSetupRequestDto = {
  title: 'English lesson',
  timezone: 'Asia/Bangkok',
  slots: [
    {
      kind: 'weekly',
      weekday: 1,
      startDate: '2030-01-07',
      localTime: '11:00',
      durationMinutes: 60,
    },
    {
      kind: 'weekly',
      weekday: 5,
      startDate: '2030-01-07',
      localTime: '09:00',
      durationMinutes: 45,
    },
  ],
};
const scopes = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
];
let owner: string,
  member: string,
  workspace: string,
  student: string,
  connection: string,
  grant: string;
const workspaces: string[] = [];
const q = async (sql: string, params: unknown[] = []) =>
  withPgClient((client) => client.query(sql, params));
function confirmed(
  body: Record<string, unknown>,
  extra: Partial<GoogleCalendarEvent> = {},
): GoogleCalendarEvent {
  return {
    ...body,
    status: 'confirmed',
    etag: 'v1',
    updated: '2029-01-01T00:00:00Z',
    htmlLink: 'https://calendar.google.com/calendar/event?eid=test',
    ...extra,
  } as GoogleCalendarEvent;
}
function providerFixture() {
  const events = new Map<string, GoogleCalendarEvent>();
  const insert = vi.fn(
    async (_c: string, _g: string, event: Record<string, unknown>, _invite: boolean) => {
      const created = confirmed(event);
      events.set(created.id, created);
      return created;
    },
  );
  const get = vi.fn(async (_c: string, _g: string, id: string) => events.get(id) ?? null);
  const changes = vi.fn(async () => ({ items: [], nextSyncToken: 'sync-1' }) as GoogleCalendarPage);
  const instances = vi.fn(async () => ({ items: [] }) as GoogleCalendarPage);
  return {
    provider: { get, insert, changes, instances } satisfies CalendarProvider,
    events,
    insert,
    get,
    changes,
    instances,
  };
}
async function fixture() {
  owner = randomUUID();
  member = randomUUID();
  workspace = randomUUID();
  student = randomUUID();
  connection = randomUUID();
  grant = randomUUID();
  workspaces.push(workspace);
  await calendarTransaction(async (client) => {
    await client.query(
      "INSERT INTO users(id,email,password_hash) VALUES($1,$2,'hash'),($3,$4,'hash')",
      [owner, `${owner}@example.test`, member, `${member}@example.test`],
    );
    await client.query("INSERT INTO workspaces(id,name) VALUES($1,'Calendar runtime test')", [
      workspace,
    ]);
    await client.query(
      "INSERT INTO workspace_business_settings(workspace_id,timezone) VALUES($1,'Asia/Bangkok')",
      [workspace],
    );
    await client.query(
      "INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
      [workspace, owner, member],
    );
    await client.query(
      "INSERT INTO students(id,student,workspace_id,email) VALUES($1,'Synthetic learner',$2,'controlled@example.test')",
      [student, workspace],
    );
    await client.query(
      `INSERT INTO google_oauth_grants(id,workspace_id,authorizing_user_id,issuer,subject,client_id,google_email,granted_scopes,refresh_credential) VALUES($1,$2,$3,'https://accounts.google.com',$4,'calendar-test-client','tutor@example.test',$5,'encrypted-test-only')`,
      [grant, workspace, owner, randomUUID(), scopes],
    );
    await client.query(
      `INSERT INTO workspace_calendar_connections(id,workspace_id,grant_id,calendar_id,calendar_name,calendar_timezone,status,next_sync_at) VALUES($1,$2,$3,$4,'Synthetic calendar','Asia/Bangkok','connected',now()+interval '1 day')`,
      [connection, workspace, grant, `runtime-test-${connection}@example.test`],
    );
  });
}
async function opFor(id: string): Promise<CalendarOperation> {
  return (await q('SELECT * FROM calendar_operations WHERE id=$1', [id])).rows[0];
}
async function claim(id: string): Promise<CalendarOperation> {
  return (
    await q(
      "UPDATE calendar_operations SET state='running',lease_token=$2,lease_expires_at=now()+interval '60 seconds',attempts=attempts+1 WHERE id=$1 RETURNING *",
      [id, randomUUID()],
    )
  ).rows[0];
}
async function bindingFixture(kind: 'series' | 'one_off' = 'series') {
  const id = randomUUID();
  await q(
    `INSERT INTO calendar_schedule_bindings(id,workspace_id,student_id,connection_id,provider_event_id,kind,association_marker,next_projection_at) VALUES($1,$2,$3,$4,'master',$5,$6,now()+interval '1 day')`,
    [id, workspace, student, connection, kind, randomUUID()],
  );
  return (await q('SELECT * FROM calendar_schedule_bindings WHERE id=$1', [id])).rows[0];
}
async function operationFixture(kind: 'sync' | 'refresh', payload: Record<string, unknown> = {}) {
  const id = randomUUID();
  await q(
    `INSERT INTO calendar_operations(id,workspace_id,connection_id,connection_generation,authority_policy,kind,idempotency_key,request_hash,request_payload) VALUES($1,$2,$3,1,'workspace_service',$4,$5,$5,$6)`,
    [id, workspace, connection, kind, randomUUID(), JSON.stringify(payload)],
  );
  return claim(id);
}
function occurrence(
  id = 'instance',
  extra: Partial<GoogleCalendarEvent> = {},
): GoogleCalendarEvent {
  return {
    id,
    recurringEventId: 'master',
    originalStartTime: { dateTime: '2030-01-07T04:00:00Z' },
    start: { dateTime: '2030-01-07T04:00:00Z', timeZone: 'Asia/Bangkok' },
    end: { dateTime: '2030-01-07T05:00:00Z', timeZone: 'Asia/Bangkok' },
    status: 'confirmed',
    etag: 'v1',
    updated: '2029-01-01T00:00:00Z',
    ...extra,
  };
}
async function project(
  binding: Awaited<ReturnType<typeof bindingFixture>>,
  event: GoogleCalendarEvent,
) {
  return calendarTransaction(async (client) => {
    await client.query("SELECT set_config('app.calendar_sync','on',true)");
    await projectCalendarObservation(client, binding, event, new Date('2029-01-01T00:00:00Z'));
  });
}

describePg('Calendar durable runtime with PostgreSQL and a controlled provider', () => {
  beforeEach(async () => {
    process.env.GOOGLE_CALENDAR_ENABLED = 'true';
    process.env.GOOGLE_CALENDAR_CLIENT_ID = 'calendar-test-client';
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = 'calendar-test-secret';
    process.env.GOOGLE_CALENDAR_REDIRECT_URI = 'http://127.0.0.1/api/google/calendar/callback';
    process.env.INTEGRATION_CREDENTIAL_ACTIVE_KEY_ID = 'test';
    process.env.INTEGRATION_CREDENTIAL_KEYS = JSON.stringify({
      test: Buffer.alloc(32, 7).toString('base64'),
    });
    await fixture();
  });
  afterEach(async () => {
    await q(
      "UPDATE workspace_calendar_connections SET status='disconnected' WHERE workspace_id=ANY($1::uuid[])",
      [workspaces],
    );
  });
  afterAll(async () => {
    await closePgPool();
  });
  it('stores independent Monday/Friday series, scoped idempotency, optional invitations and rejects changed payloads', async () => {
    const setup = await createCalendarSetup(workspace, student, member, 'monday-friday', request);
    const retry = await createCalendarSetup(workspace, student, member, 'monday-friday', request);
    expect(retry).toEqual(setup);
    expect(setup.operations).toHaveLength(2);
    const children = (
      await q('SELECT * FROM calendar_operations WHERE parent_id=$1 ORDER BY slot_index', [
        setup.id,
      ])
    ).rows;
    expect(new Set(children.map((row) => row.provider_event_id)).size).toBe(2);
    expect(children.map((row) => row.request_payload.event.recurrence[0])).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO',
      'RRULE:FREQ=WEEKLY;BYDAY=FR',
    ]);
    expect(children[0].request_payload.event.attendees).toEqual([
      { email: 'controlled@example.test' },
    ]);
    expect(children[0].request_payload.event.guestsCanInviteOthers).toBe(false);
    expect(JSON.stringify(setup)).not.toContain('controlled@example.test');
    await expect(
      createCalendarSetup(workspace, student, member, 'monday-friday', {
        ...request,
        title: 'Changed',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    const noInvite = await createCalendarSetup(workspace, student, member, 'opt-out', {
      ...request,
      sendInvitation: false,
      slots: [request.slots[0]!],
    });
    expect((await opFor(noInvite.operations[0]!.id)).request_payload.event).not.toHaveProperty(
      'attendees',
    );
    await q('UPDATE students SET email=NULL WHERE id=$1', [student]);
    const noEmail = await createCalendarSetup(workspace, student, member, 'no-email', {
      ...request,
      slots: [request.slots[0]!],
    });
    expect((await opFor(noEmail.operations[0]!.id)).request_payload.invite).toBe(false);
    const another = randomUUID();
    await q(
      "INSERT INTO students(id,student,workspace_id,email) VALUES($1,'Second synthetic learner',$2,'controlled@example.test')",
      [another, workspace],
    );
    expect(another).not.toBe(student);
  });
  it('rejects fresh stale forms but recovers the frozen accepted request after workspace clock changes', async () => {
    await q("UPDATE workspace_business_settings SET timezone='Asia/Saigon' WHERE workspace_id=$1", [
      workspace,
    ]);
    const accepted = { ...request, timezone: 'Asia/Saigon', slots: [request.slots[0]!] };
    await expect(
      createCalendarSetup(workspace, student, member, 'stale', request),
    ).rejects.toMatchObject({ code: 'workspace_timezone_changed' });
    expect(
      (
        await q(
          "SELECT 1 FROM calendar_operations WHERE workspace_id=$1 AND idempotency_key='stale'",
          [workspace],
        )
      ).rows,
    ).toHaveLength(0);
    const setup = await createCalendarSetup(workspace, student, member, 'frozen-zone', accepted);
    const before = await opFor(setup.operations[0]!.id);
    expect(before.request_payload.event).toMatchObject({
      start: { dateTime: '2030-01-07T04:00:00.000Z', timeZone: 'Asia/Ho_Chi_Minh' },
    });
    await q(
      "UPDATE workspace_business_settings SET timezone='America/New_York' WHERE workspace_id=$1",
      [workspace],
    );
    expect(await createCalendarSetup(workspace, student, member, 'frozen-zone', accepted)).toEqual(
      setup,
    );
    await expect(
      createCalendarSetup(workspace, student, member, 'frozen-zone', {
        ...accepted,
        timezone: 'America/New_York',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
    await retryCalendarOperation(workspace, member, before.id);
    const fixture = providerFixture();
    await processCalendarCreate(await claim(before.id), fixture.provider);
    await processCalendarCreate(await claim(before.id), fixture.provider);
    const after = await opFor(before.id);
    expect(after.provider_event_id).toBe(before.provider_event_id);
    expect(after.request_hash).toBe(before.request_hash);
    expect(after.request_payload).toEqual(before.request_payload);
    expect(fixture.insert).toHaveBeenCalledTimes(1);
    expect(fixture.insert.mock.calls[0]![3]).toBe(true);
  });
  it('uses provider Calendar metadata for a zone-less one-off without workspace retiming', async () => {
    const binding = await bindingFixture('one_off');
    await q(
      "UPDATE workspace_calendar_connections SET calendar_timezone='Europe/London' WHERE id=$1",
      [connection],
    );
    const event = {
      id: 'master',
      start: { dateTime: '2030-01-07T11:00:00+07:00' },
      end: { dateTime: '2030-01-07T12:00:00+07:00' },
      etag: 'zone-less-1',
    };
    await project(binding, event);
    const before = (
      await q('SELECT id,starts_at,timezone FROM student_lessons WHERE student_id=$1', [student])
    ).rows;
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      starts_at: new Date('2030-01-07T04:00:00Z'),
      timezone: 'Europe/London',
    });
    await q("UPDATE workspace_business_settings SET timezone='Asia/Tokyo' WHERE workspace_id=$1", [
      workspace,
    ]);
    await project(binding, { ...event, etag: 'zone-less-2' });
    expect(
      (await q('SELECT id,starts_at,timezone FROM student_lessons WHERE student_id=$1', [student]))
        .rows,
    ).toEqual(before);
  });
  it('rejects cross-workspace and viewer mutations without persisting setup children', async () => {
    const foreign = randomUUID();
    await q("INSERT INTO workspaces(id,name) VALUES($1,'Other')", [foreign]);
    await expect(
      createCalendarSetup(foreign, student, member, 'cross', request),
    ).rejects.toMatchObject({ code: 'calendar_permission_changed' });
    await q("UPDATE workspace_memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2", [
      workspace,
      member,
    ]);
    await expect(
      createCalendarSetup(workspace, student, member, 'viewer', request),
    ).rejects.toMatchObject({ code: 'calendar_permission_changed' });
    await expect(getCalendarSchedulingStatus(workspace, member)).resolves.toMatchObject({
      connectionId: connection,
    });
    expect(
      (await q('SELECT id FROM calendar_operations WHERE workspace_id=$1', [workspace])).rowCount,
    ).toBe(0);
  });
  it('keeps a successful sibling when another series fails and recovers an accepted timeout by GET without reinvitation', async () => {
    const f = providerFixture();
    const setup = await createCalendarSetup(workspace, student, member, 'partial', request);
    f.insert.mockImplementationOnce(async (_c, _g, event) => {
      const created = confirmed(event);
      f.events.set(created.id, created);
      return created;
    });
    f.insert.mockImplementationOnce(async (_c, _g, event) => {
      const created = confirmed(event);
      f.events.set(created.id, created);
      throw new GoogleCalendarError('provider_unavailable', true);
    });
    await dispatchCalendarWork(f.provider, 2);
    const first = await getCalendarSetup(workspace, owner, setup.id);
    expect(first.operations.map((op) => op.state).sort()).toEqual(['retry_wait', 'succeeded']);
    const failed = first.operations.find((op) => op.state === 'retry_wait')!;
    await q('UPDATE calendar_operations SET due_at=now() WHERE id=$1', [failed.id]);
    await dispatchCalendarWork(f.provider, 1);
    const final = await getCalendarSetup(workspace, owner, setup.id);
    expect(final.operations.every((op) => op.state === 'succeeded')).toBe(true);
    expect(f.insert).toHaveBeenCalledTimes(2);
    expect(f.get).toHaveBeenCalledTimes(1);
    expect(
      (await q('SELECT id FROM calendar_schedule_bindings WHERE student_id=$1', [student]))
        .rowCount,
    ).toBe(2);
  });
  it('blocks a removed initiator new write, allows read-only recovery, and preserves event identity on explicit adoption', async () => {
    const f = providerFixture();
    const setup = await createCalendarSetup(workspace, student, member, 'role-loss', request);
    const attempted = await opFor(setup.operations[0]!.id);
    f.events.set(
      attempted.provider_event_id!,
      confirmed(attempted.request_payload.event as Record<string, unknown>),
    );
    await q('UPDATE calendar_operations SET write_attempted_at=now() WHERE id=$1', [attempted.id]);
    await q('DELETE FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2', [
      workspace,
      member,
    ]);
    await dispatchCalendarWork(f.provider, 2);
    const result = await getCalendarSetup(workspace, owner, setup.id);
    expect(result.operations[0]!.state).toBe('succeeded');
    expect(result.operations[1]!.state).toBe('needs_review');
    expect(f.insert).not.toHaveBeenCalled();
    expect(f.get).toHaveBeenCalledTimes(1);
    const blockedId = result.operations[1]!.id;
    const before = await opFor(blockedId);
    await expect(retryCalendarOperation(workspace, owner, blockedId)).rejects.toMatchObject({
      code: 'operation_adoption_required',
    });
    await expect(reviewCalendarOperation(workspace, member, blockedId)).rejects.toMatchObject({
      code: 'calendar_permission_changed',
    });
    const review = await reviewCalendarOperation(workspace, owner, blockedId);
    expect(review.invitationRecipient).toBe('controlled@example.test');
    await expect(
      adoptCalendarOperation(workspace, owner, blockedId, 'wrong-reviewed-hash'),
    ).rejects.toMatchObject({ code: 'operation_review_changed' });
    await adoptCalendarOperation(workspace, owner, blockedId, review.requestHash);
    await dispatchCalendarWork(f.provider, 1);
    const after = await opFor(blockedId);
    expect(after.state).toBe('succeeded');
    expect(after.provider_event_id).toBe(before.provider_event_id);
    expect(after.request_hash).toBe(before.request_hash);
    expect(after.adopted_by).toBe(owner);
  });
  it('fences authorizer loss and stale worker completion without losing uncertain provider success', async () => {
    const f = providerFixture();
    const setup = await createCalendarSetup(workspace, student, member, 'fence', request);
    const op = await claim(setup.operations[0]!.id);
    f.insert.mockImplementationOnce(async (_c, _g, event) => {
      const created = confirmed(event);
      f.events.set(created.id, created);
      await q(
        "UPDATE workspace_memberships SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [workspace, owner],
      );
      return created;
    });
    await expect(processCalendarCreate(op, f.provider)).rejects.toMatchObject({
      code: expect.stringMatching(/connection|permission/),
    });
    expect(
      (await q('SELECT id FROM calendar_schedule_bindings WHERE student_id=$1', [student]))
        .rowCount,
    ).toBe(0);
    expect((await opFor(op.id)).write_attempted_at).not.toBeNull();
    const c = (await q('SELECT * FROM workspace_calendar_connections WHERE id=$1', [connection]))
      .rows[0];
    expect(c.status).toBe('reconnect_required');
    expect(c.generation).toBe(2);
    await q("UPDATE workspace_memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2", [
      workspace,
      owner,
    ]);
    expect(
      (await q('SELECT status FROM workspace_calendar_connections WHERE id=$1', [connection]))
        .rows[0].status,
    ).toBe('reconnect_required');
  });
  it('serializes workers for a connection while a remote create is in flight', async () => {
    const f = providerFixture();
    await createCalendarSetup(workspace, student, member, 'workers', {
      ...request,
      slots: [request.slots[0]!],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.insert.mockImplementationOnce(async (_c, _g, event) => {
      entered();
      await gate;
      return confirmed(event);
    });
    const first = dispatchCalendarWork(f.provider, 1);
    await started;
    expect(await dispatchCalendarWork(f.provider, 1)).toBe(0);
    release();
    await first;
    expect(f.insert).toHaveBeenCalledTimes(1);
  });
  it('commits dirty work with each cursor page and preserves it on later failure; 410 resets only the cursor', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const lesson = (
      await q('SELECT lesson_id FROM calendar_lesson_bindings WHERE schedule_binding_id=$1', [
        binding.id,
      ])
    ).rows[0].lesson_id;
    const op = await operationFixture('sync');
    f.changes.mockResolvedValueOnce({ items: [occurrence()], nextPageToken: 'page-2' });
    await processCalendarSync(op, f.provider);
    const c = (await q('SELECT * FROM workspace_calendar_connections WHERE id=$1', [connection]))
      .rows[0];
    expect(c.sync_page_token).toBe('page-2');
    expect(c.sync_token).toBeNull();
    expect(
      (
        await q(
          "SELECT id FROM calendar_operations WHERE kind='refresh' AND request_payload->>'bindingId'=$1",
          [binding.id],
        )
      ).rowCount,
    ).toBe(1);
    f.changes.mockRejectedValueOnce(new GoogleCalendarError('provider_unavailable', true));
    await expect(processCalendarSync(await claim(op.id), f.provider)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(
      (
        await q('SELECT sync_page_token FROM workspace_calendar_connections WHERE id=$1', [
          connection,
        ])
      ).rows[0].sync_page_token,
    ).toBe('page-2');
    await q("UPDATE workspace_calendar_connections SET sync_token='expired' WHERE id=$1", [
      connection,
    ]);
    f.changes.mockRejectedValueOnce(new GoogleCalendarError('cursor_expired'));
    await processCalendarSync(await claim(op.id), f.provider);
    const reset = (
      await q('SELECT * FROM workspace_calendar_connections WHERE id=$1', [connection])
    ).rows[0];
    expect(reset.sync_token).toBeNull();
    expect(reset.sync_page_token).toBeNull();
    expect((await q('SELECT id FROM student_lessons WHERE id=$1', [lesson])).rowCount).toBe(1);
    expect(
      (await q('SELECT lesson_id FROM calendar_lesson_bindings WHERE lesson_id=$1', [lesson]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await q(
          "SELECT id FROM calendar_operations WHERE kind='refresh' AND request_payload->>'bindingId'=$1",
          [binding.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it('keeps stable occurrence identity through moves, ignores older observations and protects completed history', async () => {
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const original = (await q('SELECT * FROM student_lessons WHERE student_id=$1', [student]))
      .rows[0];
    await project(
      binding,
      occurrence('moved-id', {
        summary: 'Renamed in Google',
        start: { dateTime: '2030-01-08T06:00:00Z', timeZone: 'Asia/Bangkok' },
        end: { dateTime: '2030-01-08T07:00:00Z' },
        etag: 'v2',
        updated: '2029-01-02T00:00:00Z',
      }),
    );
    const moved = (await q('SELECT * FROM student_lessons WHERE student_id=$1', [student])).rows;
    expect(moved).toHaveLength(1);
    expect(moved[0].id).toBe(original.id);
    expect(moved[0].starts_at.toISOString()).toBe('2030-01-08T06:00:00.000Z');
    expect(moved[0].title).toBe('Renamed in Google');
    expect(moved[0].timezone).toBe('Asia/Bangkok');
    await project(
      binding,
      occurrence('moved-id', { etag: 'old', updated: '2028-12-01T00:00:00Z' }),
    );
    expect(
      (
        await q('SELECT starts_at FROM student_lessons WHERE id=$1', [original.id])
      ).rows[0].starts_at.toISOString(),
    ).toBe('2030-01-08T06:00:00.000Z');
    await q("UPDATE student_lessons SET status='completed',completed_by=$2 WHERE id=$1", [
      original.id,
      owner,
    ]);
    await project(
      binding,
      occurrence('moved-id', { status: 'cancelled', etag: 'v3', updated: '2029-01-03T00:00:00Z' }),
    );
    expect(
      (await q('SELECT status FROM student_lessons WHERE id=$1', [original.id])).rows[0].status,
    ).toBe('completed');
    expect(
      (
        await q('SELECT attention_code FROM calendar_lesson_bindings WHERE lesson_id=$1', [
          original.id,
        ])
      ).rows[0].attention_code,
    ).toBe('protected_lesson_deleted');
  });
  it('rechecks committed source lineage after waiting for a concurrent FK insertion on the lesson', async () => {
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const lessonId = (await q('SELECT id FROM student_lessons WHERE student_id=$1', [student]))
      .rows[0].id;
    await withPgClient(async (sourceClient) => {
      await sourceClient.query('BEGIN');
      const sourcePid = (await sourceClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      try {
        await sourceClient.query(
          `INSERT INTO assignment_sessions(id,user_id,student_id,lesson_id,confirmed_step,confirmed_snapshot)
          VALUES($1,$2,$3,$4,'student',$5::jsonb)`,
          [
            randomUUID(),
            member,
            student,
            lessonId,
            JSON.stringify({
              student: { studentId: student },
              source: null,
              context: null,
              create: null,
            }),
          ],
        );
        await withPgClient(async (projectionClient) => {
          await projectionClient.query('BEGIN');
          const projectionPid = (await projectionClient.query('SELECT pg_backend_pid() AS pid'))
            .rows[0].pid;
          const projecting = projectCalendarObservation(
            projectionClient,
            binding,
            occurrence('instance', {
              start: { dateTime: '2030-01-08T06:00:00Z' },
              end: { dateTime: '2030-01-08T07:00:00Z' },
              updated: '2029-01-02T00:00:00Z',
              etag: 'concurrent-v2',
            }),
            new Date('2029-01-01T00:00:00Z'),
          );
          try {
            await expect
              .poll(
                async () =>
                  (await q('SELECT pg_blocking_pids($1) AS blockers', [projectionPid])).rows[0]
                    .blockers,
              )
              .toContain(sourcePid);
            await sourceClient.query('COMMIT');
            await projecting;
            await projectionClient.query('COMMIT');
          } catch (error) {
            await sourceClient.query('ROLLBACK');
            await projecting.catch(() => {});
            await projectionClient.query('ROLLBACK');
            throw error;
          }
        });
      } catch (error) {
        await sourceClient.query('ROLLBACK');
        throw error;
      }
    });
    const retained = (
      await q(
        `SELECT l.starts_at,b.attention_code FROM student_lessons l
      JOIN calendar_lesson_bindings b ON b.lesson_id=l.id WHERE l.id=$1`,
        [lessonId],
      )
    ).rows[0];
    expect(retained.starts_at.toISOString()).toBe('2030-01-07T04:00:00.000Z');
    expect(retained.attention_code).toBe('protected_lesson_changed');
  });
  it('does not cancel absent occurrences on incomplete instance pagination or lost access', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const op = await operationFixture('refresh', { bindingId: binding.id });
    f.events.set('master', confirmed({ id: 'master', recurrence: ['RRULE:FREQ=WEEKLY'] }));
    f.instances
      .mockResolvedValueOnce({ items: [], nextPageToken: 'second' })
      .mockRejectedValueOnce(new GoogleCalendarError('provider_unavailable', true));
    await expect(processCalendarRefresh(op, f.provider)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(
      (await q('SELECT status FROM student_lessons WHERE student_id=$1', [student])).rows[0].status,
    ).toBe('scheduled');
    expect(f.get).toHaveBeenCalledTimes(1);
    f.instances.mockRejectedValueOnce(new GoogleCalendarError('permission_denied'));
    await expect(processCalendarRefresh(await claim(op.id), f.provider)).rejects.toMatchObject({
      code: 'permission_denied',
    });
    expect(
      (await q('SELECT status FROM student_lessons WHERE student_id=$1', [student])).rows[0].status,
    ).toBe('scheduled');
  });
  it('replaces unused future series projections without canceled duplicates or activity noise', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const old = (await q('SELECT id FROM student_lessons WHERE student_id=$1', [student])).rows[0]
      .id;
    f.events.set('master', confirmed({ id: 'master', recurrence: ['RRULE:FREQ=WEEKLY'] }));
    f.events.set('instance', { id: 'instance', status: 'cancelled' });
    const replacement = occurrence('replacement', {
      originalStartTime: { dateTime: '2030-01-07T03:00:00Z' },
      start: { dateTime: '2030-01-07T03:00:00Z', timeZone: 'Asia/Bangkok' },
      end: { dateTime: '2030-01-07T03:50:00Z', timeZone: 'Asia/Bangkok' },
    });
    f.instances.mockResolvedValue({ items: [replacement] });
    const op = await operationFixture('refresh', { bindingId: binding.id });
    await processCalendarRefresh(op, f.provider);
    const visible = (
      await q(
        'SELECT id,starts_at FROM student_lessons WHERE student_id=$1 AND schedule_hidden_at IS NULL',
        [student],
      )
    ).rows;
    expect(visible).toHaveLength(1);
    expect(visible[0].id).not.toBe(old);
    expect(visible[0].starts_at.toISOString()).toBe('2030-01-07T03:00:00.000Z');
    expect(
      (await q('SELECT schedule_hidden_reason FROM student_lessons WHERE id=$1', [old])).rows[0]
        .schedule_hidden_reason,
    ).toBe('calendar_projection_replaced');
    const activity = await getStudentActivity(workspace, student, owner, { category: 'lessons' });
    expect(activity!.items.map((item) => item.type)).toEqual(['lesson_created']);
    await expect(
      updateStudentLesson(
        workspace,
        student,
        old,
        { status: 'completed', consumesCredit: true },
        owner,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      confirmStudentAssignmentSession({
        userId: owner,
        studentId: student,
        lessonId: old,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: '23514', constraint: 'calendar_projection_reference_visible' });
    await processCalendarRefresh(op, f.provider);
    expect(
      (
        await q(
          'SELECT id FROM student_lessons WHERE student_id=$1 AND schedule_hidden_at IS NULL',
          [student],
        )
      ).rowCount,
    ).toBe(1);
    expect(
      (await q('SELECT id FROM student_credit_events WHERE student_id=$1', [student])).rowCount,
    ).toBe(0);
    f.instances.mockResolvedValue({
      items: [occurrence('instance', { etag: 'restored-v3', updated: '2029-01-03T00:00:00Z' })],
    });
    f.events.set(
      'instance',
      occurrence('instance', { etag: 'restored-v3', updated: '2029-01-03T00:00:00Z' }),
    );
    f.events.set('replacement', { id: 'replacement', status: 'cancelled' });
    await processCalendarRefresh(op, f.provider);
    expect(
      (
        await q(
          'SELECT id FROM student_lessons WHERE student_id=$1 AND schedule_hidden_at IS NULL',
          [student],
        )
      ).rows,
    ).toEqual([{ id: old }]);
    expect(
      (await getStudentActivity(workspace, student, owner, { category: 'lessons' }))!.items.map(
        (item) => item.type,
      ),
    ).toEqual(['lesson_created']);
  });
  it('does not publish replacement occurrences before all provider pages succeed', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    await project(binding, occurrence());
    f.events.set('master', confirmed({ id: 'master', recurrence: ['RRULE:FREQ=WEEKLY'] }));
    f.instances
      .mockResolvedValueOnce({
        items: [
          occurrence('replacement', { originalStartTime: { dateTime: '2030-01-07T03:00:00Z' } }),
        ],
        nextPageToken: 'later',
      })
      .mockRejectedValueOnce(new GoogleCalendarError('provider_unavailable', true));
    await expect(
      processCalendarRefresh(
        await operationFixture('refresh', { bindingId: binding.id }),
        f.provider,
      ),
    ).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(
      (
        await q('SELECT status,schedule_hidden_at FROM student_lessons WHERE student_id=$1', [
          student,
        ])
      ).rows,
    ).toEqual([{ status: 'scheduled', schedule_hidden_at: null }]);
  });
  it('renews the lease between slow provider reads without publishing a partial projection', async () => {
    const f = providerFixture(),
      binding = await bindingFixture();
    await project(binding, occurrence());
    const op = await operationFixture('refresh', { bindingId: binding.id });
    const master = confirmed({ id: 'master', recurrence: ['RRULE:FREQ=WEEKLY'] });
    let paged = false;
    const renewals: boolean[] = [];
    f.get.mockImplementation(async (_c, _g, id) => {
      if (paged) {
        const lease = (
          await q(
            "SELECT lease_expires_at>now()+interval '40 seconds' AS renewed FROM calendar_operations WHERE id=$1",
            [op.id],
          )
        ).rows[0];
        renewals.push(lease.renewed);
      }
      return id === 'master' ? master : null;
    });
    f.instances.mockImplementation(async () => {
      await q(
        "UPDATE calendar_operations SET lease_expires_at=now()+interval '5 seconds' WHERE id=$1",
        [op.id],
      );
      paged = true;
      return { items: [occurrence()] };
    });
    await processCalendarRefresh(op, f.provider);
    expect(renewals).toEqual([true]);
    expect(
      (await q('SELECT id FROM student_lessons WHERE student_id=$1', [student])).rowCount,
    ).toBe(1);
  });
  it('automatically projects a split successor with exact creation provenance, keeping one visible lesson per Google occurrence', async () => {
    const f = providerFixture();
    const setup = await createCalendarSetup(workspace, student, owner, 'split-source', {
      ...request,
      sendInvitation: false,
      slots: request.slots.slice(0, 1),
    });
    await processCalendarCreate(await claim(setup.operations[0]!.id), f.provider);
    const source = (
      await q('SELECT * FROM calendar_schedule_bindings WHERE connection_id=$1', [connection])
    ).rows[0];
    const before = occurrence('before-split', { recurringEventId: source.provider_event_id });
    const after = occurrence('after-split-old', {
      recurringEventId: source.provider_event_id,
      originalStartTime: { dateTime: '2030-01-14T04:00:00Z' },
      start: { dateTime: '2030-01-14T04:00:00Z' },
      end: { dateTime: '2030-01-14T05:00:00Z' },
    });
    await project(source, before);
    await project(source, after);
    const original = f.events.get(source.provider_event_id)!;
    const successor = { ...original, id: 'successor', etag: 'split-v2' };
    f.events.set('successor', successor);
    f.events.set(after.id, { id: after.id, status: 'cancelled' });
    f.changes.mockResolvedValueOnce({
      items: [successor, { ...original, etag: 'split-v2' }],
      nextSyncToken: 'split-complete',
    });
    await processCalendarSync(await operationFixture('sync'), f.provider);
    expect(
      (await q('SELECT id FROM calendar_schedule_bindings WHERE connection_id=$1', [connection]))
        .rowCount,
    ).toBe(2);
    const next = occurrence('after-split-new', {
      recurringEventId: 'successor',
      originalStartTime: { dateTime: '2030-01-14T06:00:00Z' },
      start: { dateTime: '2030-01-14T06:00:00Z' },
      end: { dateTime: '2030-01-14T07:00:00Z' },
    });
    f.instances.mockImplementation(async (...args: unknown[]) => ({
      items: args[2] === 'successor' ? [next] : [before],
    }));
    await processCalendarRefresh(
      await operationFixture('refresh', { bindingId: source.id }),
      f.provider,
    );
    const visible = (
      await q(
        'SELECT l.starts_at,l.status FROM student_lessons l WHERE student_id=$1 AND schedule_hidden_at IS NULL ORDER BY starts_at',
        [student],
      )
    ).rows;
    expect(visible.map((row) => [row.starts_at.toISOString(), row.status])).toEqual([
      ['2030-01-07T04:00:00.000Z', 'scheduled'],
      ['2030-01-14T06:00:00.000Z', 'scheduled'],
    ]);
    expect(f.insert).toHaveBeenCalledOnce();
    expect(
      (await q('SELECT id FROM student_credit_events WHERE student_id=$1', [student])).rowCount,
    ).toBe(0);
  });
  it('keeps protected history visible and does not add an ambiguous replacement duplicate', async () => {
    const f = providerFixture(),
      binding = await bindingFixture();
    await project(binding, occurrence());
    const old = (await q('SELECT id FROM student_lessons WHERE student_id=$1', [student])).rows[0]
      .id;
    await q("UPDATE student_lessons SET status='completed',completed_by=$2 WHERE id=$1", [
      old,
      owner,
    ]);
    f.events.set('master', confirmed({ id: 'master', recurrence: ['RRULE:FREQ=WEEKLY'] }));
    f.events.set('instance', { id: 'instance', status: 'cancelled' });
    f.instances.mockResolvedValue({
      items: [
        occurrence('replacement', { originalStartTime: { dateTime: '2030-01-07T03:00:00Z' } }),
      ],
    });
    await processCalendarRefresh(
      await operationFixture('refresh', { bindingId: binding.id }),
      f.provider,
    );
    expect(
      (
        await q('SELECT id,status,schedule_hidden_at FROM student_lessons WHERE student_id=$1', [
          student,
        ])
      ).rows,
    ).toEqual([{ id: old, status: 'completed', schedule_hidden_at: null }]);
    expect((await getCalendarSchedulingStatus(workspace, owner)).state).toBe('needs_attention');
  });
  it('rejects a new reference that waited behind the projection row lock', async () => {
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const lesson = (await q('SELECT id FROM student_lessons WHERE student_id=$1', [student]))
      .rows[0].id;
    let attempted!: Promise<unknown>;
    await withPgClient(async (projection) => {
      await projection.query('BEGIN');
      try {
        const ownerPid = (await projection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await projection.query('SELECT id FROM student_lessons WHERE id=$1 FOR UPDATE', [lesson]);
        let reportPid!: (pid: number) => void;
        const waitingPid = new Promise<number>((resolve) => {
          reportPid = resolve;
        });
        attempted = withPgClient(async (writer) => {
          reportPid((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
          return writer.query(
            "INSERT INTO assignment_sessions(id,user_id,student_id,lesson_id,revision,confirmed_step,confirmed_snapshot,creation_request_id) VALUES($1,$2,$3,$4,1,'student',$5,$6)",
            [
              randomUUID(),
              owner,
              student,
              lesson,
              JSON.stringify({
                student: { studentId: student },
                source: null,
                context: null,
                create: null,
              }),
              randomUUID(),
            ],
          );
        }).then(
          () => null,
          (error) => error,
        );
        const pid = await waitingPid;
        await vi.waitFor(async () => {
          expect(
            (await q('SELECT $2::int=ANY(pg_blocking_pids($1::int)) AS waiting', [pid, ownerPid]))
              .rows[0].waiting,
          ).toBe(true);
        });
        await projection.query(
          "UPDATE student_lessons SET schedule_hidden_at=now(),schedule_hidden_reason='calendar_projection_replaced' WHERE id=$1",
          [lesson],
        );
        await projection.query('COMMIT');
      } catch (error) {
        await projection.query('ROLLBACK');
        throw error;
      }
    });
    expect(await attempted!).toMatchObject({
      code: '23514',
      constraint: 'calendar_projection_reference_visible',
    });
    expect(
      (await q('SELECT id FROM assignment_sessions WHERE lesson_id=$1', [lesson])).rowCount,
    ).toBe(0);
  });
  it('retains deleted-master evidence when protected history pauses a multi-master family', async () => {
    const f = providerFixture(),
      binding = await bindingFixture();
    const anchor = await operationFixture('refresh', { bindingId: binding.id });
    await q('UPDATE calendar_schedule_bindings SET setup_operation_id=$2 WHERE id=$1', [
      binding.id,
      anchor.id,
    ]);
    await project(binding, occurrence());
    await q("UPDATE student_lessons SET status='completed',completed_by=$2 WHERE student_id=$1", [
      student,
      owner,
    ]);
    await q(
      "INSERT INTO calendar_schedule_bindings(id,workspace_id,student_id,connection_id,provider_event_id,kind,association_marker,setup_operation_id) VALUES($1,$2,$3,$4,'successor','series',$5,$6)",
      [randomUUID(), workspace, student, connection, randomUUID(), anchor.id],
    );
    f.events.set('successor', confirmed({ id: 'successor', recurrence: ['RRULE:FREQ=WEEKLY'] }));
    f.changes.mockResolvedValueOnce({
      items: [{ id: 'master', status: 'cancelled', etag: 'deleted' }],
      nextSyncToken: 'deleted',
    });
    await processCalendarSync(await operationFixture('sync'), f.provider);
    f.instances.mockResolvedValue({
      items: [occurrence('next', { recurringEventId: 'successor' })],
    });
    await processCalendarRefresh(anchor, f.provider);
    expect(
      (
        await q(
          "SELECT next_projection_at='infinity'::timestamptz AS deleted FROM calendar_schedule_bindings WHERE id=$1",
          [binding.id],
        )
      ).rows[0].deleted,
    ).toBe(true);
    await q(
      "UPDATE calendar_operations SET state='succeeded',lease_token=NULL,lease_expires_at=NULL WHERE connection_id=$1 AND kind='refresh'",
      [connection],
    );
    await expect(
      processCalendarRefresh(
        await operationFixture('refresh', { bindingId: binding.id }),
        f.provider,
      ),
    ).resolves.toBeUndefined();
    expect(
      (
        await q('SELECT status,schedule_hidden_at FROM student_lessons WHERE student_id=$1', [
          student,
        ])
      ).rows,
    ).toEqual([{ status: 'completed', schedule_hidden_at: null }]);
  });
  it('rejects stale operation leases and copied association markers without reassigning a student', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const op = await operationFixture('sync');
    await q('UPDATE calendar_operations SET lease_token=$2 WHERE id=$1', [op.id, randomUUID()]);
    await expect(
      calendarTransaction((client) => lockCalendarOperation(client, op)),
    ).rejects.toMatchObject({ code: 'lease_lost' });
    const copyOp = await operationFixture('sync');
    f.changes.mockResolvedValueOnce({
      items: [
        {
          id: 'copied-master',
          recurrence: ['RRULE:FREQ=WEEKLY'],
          extendedProperties: { private: { eslAssociation: binding.association_marker } },
        },
      ],
      nextSyncToken: 'next',
    });
    await processCalendarSync(copyOp, f.provider);
    expect(
      (await q('SELECT attention_code FROM calendar_schedule_bindings WHERE id=$1', [binding.id]))
        .rows[0].attention_code,
    ).toBe('association_provenance_conflict');
    expect(
      (await q('SELECT id FROM student_lessons WHERE student_id=$1', [student])).rowCount,
    ).toBe(1);
    expect(
      (
        await q('SELECT provider_event_id FROM calendar_schedule_bindings WHERE id=$1', [
          binding.id,
        ])
      ).rows[0].provider_event_id,
    ).toBe('master');
  });
  it('publishes a final sync cursor only after durable refresh work and reports it as still syncing', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    const op = await operationFixture('sync');
    f.changes.mockResolvedValueOnce({
      items: [{ id: 'master', recurrence: ['RRULE:FREQ=WEEKLY'] }],
      nextPageToken: 'last-page',
    });
    await processCalendarSync(op, f.provider);
    expect(
      (await q('SELECT sync_token FROM workspace_calendar_connections WHERE id=$1', [connection]))
        .rows[0].sync_token,
    ).toBeNull();
    f.changes.mockResolvedValueOnce({ items: [], nextSyncToken: 'complete-cursor' });
    await processCalendarSync(await claim(op.id), f.provider);
    expect(
      (
        await q(
          'SELECT sync_token,sync_page_token FROM workspace_calendar_connections WHERE id=$1',
          [connection],
        )
      ).rows[0],
    ).toEqual({ sync_token: 'complete-cursor', sync_page_token: null });
    expect((await getCalendarSchedulingStatus(workspace, owner)).state).toBe('syncing');
    const refresh = (
      await q(
        "SELECT * FROM calendar_operations WHERE connection_id=$1 AND kind='refresh' AND request_payload->>'bindingId'=$2",
        [connection, binding.id],
      )
    ).rows;
    expect(refresh).toHaveLength(1);
  });
  it('applies tombstones carried only by the feed and restores only Calendar-owned cancellations', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const lessonId = (await q('SELECT id FROM student_lessons WHERE student_id=$1', [student]))
      .rows[0].id;
    f.changes.mockResolvedValueOnce({
      items: [
        {
          id: 'instance',
          status: 'cancelled',
          updated: '2029-01-02T00:00:00Z',
          etag: 'canceled-v2',
        },
      ],
      nextSyncToken: 'deleted',
    });
    await processCalendarSync(await operationFixture('sync'), f.provider);
    expect(
      (await q('SELECT status FROM student_lessons WHERE id=$1', [lessonId])).rows[0].status,
    ).toBe('scheduled');
    f.events.set('master', confirmed({ id: 'master', recurrence: ['RRULE:FREQ=WEEKLY'] }));
    await processCalendarRefresh(
      await operationFixture('refresh', { bindingId: binding.id }),
      f.provider,
    );
    expect(
      (await q('SELECT status,consumes_credit FROM student_lessons WHERE id=$1', [lessonId]))
        .rows[0],
    ).toEqual({ status: 'canceled', consumes_credit: false });
    await project(
      binding,
      occurrence('instance', { updated: '2029-01-03T00:00:00Z', etag: 'restored-v3' }),
    );
    expect(
      (await q('SELECT status FROM student_lessons WHERE id=$1', [lessonId])).rows[0].status,
    ).toBe('scheduled');
    // A tutor cancellation cannot be silently undone by a later provider restoration.
    await q("UPDATE student_lessons SET status='canceled',updated_by=$2 WHERE id=$1", [
      lessonId,
      owner,
    ]);
    await project(
      binding,
      occurrence('instance', { updated: '2029-01-04T00:00:00Z', etag: 'restored-v4' }),
    );
    expect(
      (await q('SELECT status FROM student_lessons WHERE id=$1', [lessonId])).rows[0].status,
    ).toBe('canceled');
    expect(
      (
        await q('SELECT attention_code FROM calendar_lesson_bindings WHERE lesson_id=$1', [
          lessonId,
        ])
      ).rows[0].attention_code,
    ).toBe('protected_lesson_changed');
  });
  it('waits for the lesson lock and preserves a completion that wins against a provider cancellation', async () => {
    const binding = await bindingFixture();
    await project(binding, occurrence());
    const lessonId = (await q('SELECT id FROM student_lessons WHERE student_id=$1', [student]))
      .rows[0].id;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked!: () => void;
    const obtained = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const complete = calendarTransaction(async (client) => {
      await client.query('SELECT id FROM student_lessons WHERE id=$1 FOR UPDATE', [lessonId]);
      locked();
      await gate;
      await client.query(
        "UPDATE student_lessons SET status='completed',completed_by=$2,consumes_credit=true WHERE id=$1",
        [lessonId, owner],
      );
    });
    await obtained;
    const deletion = project(
      binding,
      occurrence('instance', {
        status: 'cancelled',
        etag: 'delete-v2',
        updated: '2029-01-02T00:00:00Z',
      }),
    );
    release();
    await Promise.all([complete, deletion]);
    expect(
      (
        await q('SELECT status,consumes_credit,completed_by FROM student_lessons WHERE id=$1', [
          lessonId,
        ])
      ).rows[0],
    ).toEqual({ status: 'completed', consumes_credit: true, completed_by: owner });
    expect(
      (
        await q('SELECT attention_code FROM calendar_lesson_bindings WHERE lesson_id=$1', [
          lessonId,
        ])
      ).rows[0].attention_code,
    ).toBe('protected_lesson_deleted');
  });
  it('reports old pending work beyond response limits, binding discrepancies, decline and stale sync honestly', async () => {
    await q('UPDATE workspace_calendar_connections SET last_synced_at=now() WHERE id=$1', [
      connection,
    ]);
    const op = await operationFixture('refresh', { bindingId: randomUUID() });
    await q(
      "UPDATE calendar_operations SET state='pending',lease_token=NULL,lease_expires_at=NULL,created_at=now()-interval '2 days' WHERE id=$1",
      [op.id],
    );
    await q(
      `INSERT INTO calendar_operations(id,workspace_id,connection_id,connection_generation,authority_policy,kind,idempotency_key,request_hash,state)
      SELECT gen_random_uuid(),$1,$2,1,'workspace_service','sync','done-'||n,n::text,'succeeded' FROM generate_series(1,101) n`,
      [workspace, connection],
    );
    const pending = await getCalendarSchedulingStatus(workspace, owner);
    expect(pending.operations).toHaveLength(100);
    expect(pending.operations.some((item) => item.id === op.id)).toBe(false);
    expect(pending.state).toBe('syncing');
    await q("UPDATE calendar_operations SET state='succeeded' WHERE id=$1", [op.id]);
    expect((await getCalendarSchedulingStatus(workspace, owner)).state).toBe('synced');
    const binding = await bindingFixture();
    await project(binding, occurrence('declined', { attendees: [{ responseStatus: 'declined' }] }));
    expect((await getCalendarSchedulingStatus(workspace, owner)).state).toBe('needs_attention');
    await q('UPDATE calendar_lesson_bindings SET attention_code=NULL WHERE connection_id=$1', [
      connection,
    ]);
    await q(
      "UPDATE workspace_calendar_connections SET last_synced_at=now()-interval '10 minutes' WHERE id=$1",
      [connection],
    );
    expect(await getCalendarSchedulingStatus(workspace, owner)).toMatchObject({
      state: 'needs_attention',
      errorCode: 'sync_stale',
    });
  });
  it('preserves completed lessons when a deleted master is no longer readable', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    await project(binding, occurrence('future'));
    await project(
      binding,
      occurrence('completed', {
        originalStartTime: { dateTime: '2030-01-14T04:00:00Z' },
        start: { dateTime: '2030-01-14T04:00:00Z' },
        end: { dateTime: '2030-01-14T05:00:00Z' },
      }),
    );
    const completed = (
      await q(
        "SELECT lesson_id FROM calendar_lesson_bindings WHERE provider_event_id='completed' AND connection_id=$1",
        [connection],
      )
    ).rows[0].lesson_id;
    await q(
      "UPDATE student_lessons SET status='completed',completed_by=$2,consumes_credit=true WHERE id=$1",
      [completed, owner],
    );
    f.changes.mockResolvedValueOnce({
      items: [
        {
          id: 'master',
          status: 'cancelled',
          etag: 'deleted-master',
          updated: '2029-01-03T00:00:00Z',
        },
      ],
      nextSyncToken: 'master-deleted',
    });
    await processCalendarSync(await operationFixture('sync'), f.provider);
    await processCalendarRefresh(
      await operationFixture('refresh', { bindingId: binding.id }),
      f.provider,
    );
    const rows = (
      await q(
        'SELECT b.provider_event_id,l.status,l.consumes_credit,b.attention_code FROM calendar_lesson_bindings b JOIN student_lessons l ON l.id=b.lesson_id WHERE b.schedule_binding_id=$1',
        [binding.id],
      )
    ).rows;
    expect(rows.find((row) => row.provider_event_id === 'future')).toMatchObject({
      status: 'canceled',
      consumes_credit: false,
    });
    expect(rows.find((row) => row.provider_event_id === 'completed')).toMatchObject({
      status: 'completed',
      consumes_credit: true,
      attention_code: 'protected_lesson_deleted',
    });
    expect(f.instances).not.toHaveBeenCalled();
    await q(
      "UPDATE calendar_operations SET state='succeeded',lease_token=NULL,lease_expires_at=NULL WHERE connection_id=$1 AND kind='refresh'",
      [connection],
    );
    await expect(
      processCalendarRefresh(
        await operationFixture('refresh', { bindingId: binding.id }),
        f.provider,
      ),
    ).resolves.toBeUndefined();
  });
  it('rejects cyclic provider pagination and stops work at shutdown without absence-based cancellation', async () => {
    const f = providerFixture();
    const binding = await bindingFixture();
    await project(binding, occurrence());
    f.events.set('master', confirmed({ id: 'master', recurrence: ['RRULE:FREQ=WEEKLY'] }));
    f.instances.mockResolvedValue({ items: [], nextPageToken: 'loop' });
    const refresh = await operationFixture('refresh', { bindingId: binding.id });
    await expect(processCalendarRefresh(refresh, f.provider)).rejects.toMatchObject({
      code: 'provider_pagination_cycle',
    });
    expect(f.instances).toHaveBeenCalledTimes(2);
    expect(
      (await q('SELECT status FROM student_lessons WHERE student_id=$1', [student])).rows[0].status,
    ).toBe('scheduled');
    f.get.mockClear();
    const abort = new AbortController();
    abort.abort();
    await expect(
      processCalendarRefresh(await claim(refresh.id), f.provider, abort.signal),
    ).rejects.toMatchObject({ code: 'calendar_shutdown' });
    expect(f.get).not.toHaveBeenCalled();
    const sync = await operationFixture('sync');
    f.changes.mockResolvedValue({ items: [], nextPageToken: 'repeated' });
    await processCalendarSync(sync, f.provider);
    await expect(processCalendarSync(await claim(sync.id), f.provider)).rejects.toMatchObject({
      code: 'provider_pagination_cycle',
    });
    expect(
      (
        await q(
          'SELECT sync_page_token,sync_token FROM workspace_calendar_connections WHERE id=$1',
          [connection],
        )
      ).rows[0],
    ).toEqual({ sync_page_token: 'repeated', sync_token: null });
  });
  it('recovers a conflict by deterministic GET but refuses mismatched event provenance', async () => {
    const f = providerFixture();
    const setup = await createCalendarSetup(workspace, student, member, 'conflict', request);
    const op = await claim(setup.operations[0]!.id);
    f.events.set(
      op.provider_event_id!,
      confirmed(op.request_payload.event as Record<string, unknown>),
    );
    f.insert.mockRejectedValueOnce(new GoogleCalendarError('conflict'));
    await processCalendarCreate(op, f.provider);
    expect((await opFor(op.id)).state).toBe('succeeded');
    expect(f.insert).toHaveBeenCalledTimes(1);
    expect(f.get).toHaveBeenCalledTimes(1);
    const second = await claim(setup.operations[1]!.id);
    await q('UPDATE calendar_operations SET write_attempted_at=now() WHERE id=$1', [second.id]);
    f.events.set(
      second.provider_event_id!,
      confirmed(second.request_payload.event as Record<string, unknown>, {
        extendedProperties: {
          private: { eslAssociation: 'foreign', eslRequest: second.request_hash },
        },
      }),
    );
    await expect(processCalendarCreate(await opFor(second.id), f.provider)).rejects.toMatchObject({
      code: 'provider_provenance_conflict',
    });
    expect(f.insert).toHaveBeenCalledTimes(1);
    expect(
      (await q('SELECT id FROM calendar_schedule_bindings WHERE student_id=$1', [student]))
        .rowCount,
    ).toBe(1);
  });
  it('persists explicit bind before provider work and retries the same identity without duplicate association', async () => {
    const f = providerFixture();
    f.events.set(
      'explicit-event',
      confirmed({
        id: 'explicit-event',
        start: { dateTime: '2030-01-07T04:00:00Z' },
        end: { dateTime: '2030-01-07T05:00:00Z' },
      }),
    );
    const binding = await bindCalendarEvent(workspace, owner, student, 'explicit-event');
    expect(await bindCalendarEvent(workspace, owner, student, 'explicit-event')).toEqual(binding);
    expect((await opFor(binding.operationId!)).state).toBe('pending');
    expect(f.get).not.toHaveBeenCalled();
    await dispatchCalendarWork(f.provider, 1);
    expect((await opFor(binding.operationId!)).state).toBe('succeeded');
    expect(f.get).toHaveBeenCalledTimes(1);
    expect(
      (
        await q('SELECT student_id,provider_event_id FROM calendar_schedule_bindings WHERE id=$1', [
          binding.bindingId,
        ])
      ).rows[0],
    ).toEqual({ student_id: student, provider_event_id: 'explicit-event' });
    expect(f.insert).not.toHaveBeenCalled();
    await expect(bindCalendarEvent(workspace, member, student, 'other')).rejects.toMatchObject({
      code: 'calendar_permission_changed',
    });
  });
  it('does not automatically churn sync intents while a current sync requires authorized review', async () => {
    const f = providerFixture();
    const op = await operationFixture('sync');
    await q(
      "UPDATE calendar_operations SET state='needs_review',error_code='provider_pagination_cycle',lease_token=NULL,lease_expires_at=NULL WHERE id=$1",
      [op.id],
    );
    await q(
      "UPDATE workspace_calendar_connections SET next_sync_at=now()-interval '1 minute' WHERE id=$1",
      [connection],
    );
    expect(await dispatchCalendarWork(f.provider, 4)).toBe(0);
    expect(
      (
        await q("SELECT id FROM calendar_operations WHERE connection_id=$1 AND kind='sync'", [
          connection,
        ])
      ).rowCount,
    ).toBe(1);
    expect((await getCalendarSchedulingStatus(workspace, owner)).state).toBe('needs_attention');
  });
  it('discovers one provider page per call and continues past entirely bound/deleted pages with a source-bound cursor', async () => {
    const f = providerFixture();
    await bindingFixture();
    f.changes.mockResolvedValueOnce({
      items: [{ id: 'master' }, { id: 'deleted', status: 'cancelled' }],
      nextPageToken: 'provider-secret-page-2',
    });
    const first = await listUnlinkedCalendarEvents(workspace, owner, f.provider);
    expect(first.events).toEqual([]);
    expect(first.nextPageToken).toBeTruthy();
    expect(first.nextPageToken).not.toContain('provider-secret-page-2');
    expect(f.changes).toHaveBeenCalledTimes(1);
    f.changes.mockResolvedValueOnce({
      items: [
        {
          id: 'exact-later-event',
          summary: 'Synthetic later event',
          start: { dateTime: '2030-01-08T04:00:00Z' },
          end: { dateTime: '2030-01-08T05:00:00Z' },
        },
      ],
    });
    const second = await listUnlinkedCalendarEvents(
      workspace,
      owner,
      f.provider,
      first.nextPageToken!,
    );
    expect(second.events.map((event) => event.id)).toEqual(['exact-later-event']);
    expect(second.nextPageToken).toBeNull();
    expect(f.changes).toHaveBeenLastCalledWith(connection, '1', {
      pageToken: 'provider-secret-page-2',
    });
    await expect(
      listUnlinkedCalendarEvents(workspace, owner, f.provider, `${first.nextPageToken}tampered`),
    ).rejects.toMatchObject({ code: 'invalid_discovery_cursor' });
    await q('UPDATE workspace_calendar_connections SET generation=generation+1 WHERE id=$1', [
      connection,
    ]);
    await expect(
      listUnlinkedCalendarEvents(workspace, owner, f.provider, first.nextPageToken!),
    ).rejects.toMatchObject({ code: 'invalid_discovery_cursor' });
    expect(f.changes).toHaveBeenCalledTimes(2);
  });
});
