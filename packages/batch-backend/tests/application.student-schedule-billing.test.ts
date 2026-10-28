import { promptPackageFixture } from './assignment-v1.test-harness.js';
import './support/bootstrap-pg-test-env.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  attachAssignmentSourceForUser,
  confirmStudentAssignmentSessionForUser,
  updateAssignmentSessionRecoveryForUser,
} from '../src/application/assignment-sessions.js';
import {
  addStudentPackage,
  adjustStudentCredits,
  applyGeneratedLessonTitleIfPlaceholder,
  completeElapsedScheduledLessonForHomework,
  getStudentLesson,
  getStudentLessonPage,
  getStudentScheduleBillingSurface,
  hideStudentLessonFollowupReminder,
  recordStudentPayment,
  undoLatestHiddenStudentReminder,
  updateStudentLesson,
  updateStudentLessonPlan,
} from '../src/application/student-schedule-billing.js';
import {
  getBusinessScheduleSurface,
  getBusinessSettings,
  getBusinessStatsSurface,
  updateBusinessSettings,
} from '../src/application/teacher-business-dashboard.js';
import { resolvePrimaryWorkspaceIdForUser } from '../src/application/workspace-context.js';
import {
  finishTranscriptAssignmentSessionPersistence,
  startHomeworkAssignmentSessionPersistence,
} from '../src/domain/assignment-session-repository.js';
import { archiveStudent, restoreStudent } from '../src/domain/student-repository.js';
import { closePgPool, withPgClientSessionContext } from '../src/infrastructure/db.js';
import { seedUnmanagedLesson } from './support/seed-unmanaged-lesson.js';
import { requirePgTestEnv } from './support/test-env.js';

const hasPgTestEnv = Boolean(process.env.BATCH_BACKEND_TEST_PG?.trim());
if (hasPgTestEnv) {
  requirePgTestEnv();
}

const describeIfPg = hasPgTestEnv ? describe : describe.skip;
const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

async function resetScheduleBillingTables() {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      TRUNCATE TABLE
        homework_memory_entries,
        jobs,
        drafts,
        prompt_packages,
        transcripts,
        recordings,
        assignment_sessions,
        workspace_business_settings,
        student_reminder_preferences,
        student_payment_records,
        student_credit_events,
        student_lessons,
        student_lesson_plans,
        workspace_memberships,
        students,
        users,
        workspaces
      RESTART IDENTITY CASCADE
      `,
    );
    await client.query(
      `
      INSERT INTO workspaces (id, name)
      VALUES ($1, 'Default workspace')
      ON CONFLICT (id) DO NOTHING
      `,
      [DEFAULT_WORKSPACE_ID],
    );
  });
}

async function seedWorkspaceTutor(label: string) {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO users (id, email, password_hash, role)
      VALUES ($1, $2, 'hash', 'user')
      `,
      [userId, `${label}-${userId}@example.test`],
    );
    await client.query(
      `
      INSERT INTO workspaces (id, name)
      VALUES ($1, $2)
      `,
      [workspaceId, `${label} workspace`],
    );
    await client.query(
      `
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')
      `,
      [workspaceId, userId],
    );
    await client.query(
      `
      INSERT INTO workspace_business_settings (
        workspace_id,
        default_currency,
        default_lesson_rate_minor,
        timezone
      )
      VALUES ($1, $2, $3, 'UTC')
      `,
      [workspaceId, label === 'alpha' ? 'AUD' : 'CAD', label === 'alpha' ? 4100 : 5200],
    );
  });
  return { userId, workspaceId };
}

async function seedStudentInWorkspace(workspaceId: string, name: string) {
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO students (id, student, workspace_id, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      `,
      [studentId, name, workspaceId],
    );
  });
  return studentId;
}

async function seedLessonInWorkspace(workspaceId: string, studentId: string, startsAt: string) {
  const lessonId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO student_lessons (
        id,
        student_id,
        workspace_id,
        starts_at,
        timezone,
        duration_minutes,
        status,
        consumes_credit,
        title
      )
      VALUES ($1, $2, $3, $4, 'UTC', 60, 'scheduled', FALSE, 'Seeded lesson')
      `,
      [lessonId, studentId, workspaceId, startsAt],
    );
  });
  return lessonId;
}

async function readStudentBusinessMutationSnapshot(studentId: string) {
  return withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    const result = await client.query<{ snapshot: Record<string, unknown> }>(
      `
      SELECT jsonb_build_object(
        'lessonPlans', COALESCE((
          SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.student_id)
          FROM student_lesson_plans row_value
          WHERE row_value.student_id = $1
        ), '[]'::jsonb),
        'lessons', COALESCE((
          SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id)
          FROM student_lessons row_value
          WHERE row_value.student_id = $1
        ), '[]'::jsonb),
        'reminders', COALESCE((
          SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.student_id)
          FROM student_reminder_preferences row_value
          WHERE row_value.student_id = $1
        ), '[]'::jsonb),
        'creditEvents', COALESCE((
          SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id)
          FROM student_credit_events row_value
          WHERE row_value.student_id = $1
        ), '[]'::jsonb),
        'payments', COALESCE((
          SELECT jsonb_agg(to_jsonb(row_value) ORDER BY row_value.id)
          FROM student_payment_records row_value
          WHERE row_value.student_id = $1
        ), '[]'::jsonb)
      ) AS snapshot
      `,
      [studentId],
    );
    return result.rows[0]?.snapshot ?? {};
  });
}

async function seedStudent() {
  const userId = randomUUID();
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO users (id, email, password_hash, role)
      VALUES ($1, 'teacher@example.com', 'hash', 'user')
      `,
      [userId],
    );
    await client.query(
      `
      INSERT INTO workspace_memberships (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')
      `,
      [DEFAULT_WORKSPACE_ID, userId],
    );
    await client.query(
      `
      INSERT INTO students (id, student, workspace_id, created_at, updated_at)
      VALUES ($1, 'Alex', $2, NOW(), NOW())
      `,
      [studentId, DEFAULT_WORKSPACE_ID],
    );
  });
  return { studentId, userId };
}

async function seedStudentWithoutWorkspace() {
  const userId = randomUUID();
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query('DELETE FROM workspaces WHERE id = $1', [DEFAULT_WORKSPACE_ID]);
    await client.query(
      `
      INSERT INTO users (id, email, password_hash, role)
      VALUES ($1, 'teacher@example.com', 'hash', 'user')
      `,
      [userId],
    );
    await client.query(
      `
      INSERT INTO students (id, student, workspace_id, created_at, updated_at)
      VALUES ($1, 'Alex', NULL, NOW(), NOW())
      `,
      [studentId],
    );
  });
  return { studentId, userId };
}

async function seedAdditionalStudent(name: string, archived = false) {
  const studentId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO students (id, student, workspace_id, archived_at, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      `,
      [studentId, name, DEFAULT_WORKSPACE_ID, archived ? new Date().toISOString() : null],
    );
  });
  return studentId;
}

async function insertBusinessLesson(params: {
  studentId: string;
  startsAt: string;
  status?: 'scheduled' | 'completed' | 'canceled' | 'no_show';
  consumesCredit?: boolean;
  durationMinutes?: number;
  title?: string | null;
}) {
  const id = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO student_lessons (
        id,
        student_id,
        workspace_id,
        starts_at,
        duration_minutes,
        status,
        consumes_credit,
        title
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        id,
        params.studentId,
        DEFAULT_WORKSPACE_ID,
        params.startsAt,
        params.durationMinutes ?? 60,
        params.status ?? 'scheduled',
        params.consumesCredit ?? false,
        params.title ?? null,
      ],
    );
  });
  return id;
}

async function insertBusinessCreditEvent(studentId: string, quantityDelta: number) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO student_credit_events (
        id,
        student_id,
        workspace_id,
        event_type,
        quantity_delta
      )
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        randomUUID(),
        studentId,
        DEFAULT_WORKSPACE_ID,
        quantityDelta > 0 ? 'credit_added' : 'credit_consumed',
        quantityDelta,
      ],
    );
  });
}

async function insertSucceededHomeworkJob(params: {
  studentId: string;
  lessonId: string;
  htmlUrl?: string;
}) {
  const jobId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO jobs (
        id,
        state,
        student_id,
        lesson_id,
        publish_target,
        html_url,
        finished_at,
        created_at,
        updated_at
      , assignment_artifact, assignment_renderer_version, prompt_package_id, draft_id)
      VALUES ($1, 'succeeded', $2, $3, 'html', $4, NOW(), NOW(), NOW(), '{"format":"assignment_v1","schemaVersion":1,"serializationVersion":1,"workingVersion":1,"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","storageUri":"local://drafts/content/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"}'::jsonb, 2, uuid_generate_v4(), uuid_generate_v4())
      `,
      [jobId, params.studentId, params.lessonId, params.htmlUrl ?? 'https://example.test/hw'],
    );
  });
  return jobId;
}

async function insertFailedHomeworkJob(params: { studentId: string; lessonId: string }) {
  const jobId = randomUUID();
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO jobs (
        id,
        state,
        student_id,
        lesson_id,
        publish_target,
        error,
        finished_at,
        created_at,
        updated_at
      , assignment_artifact, assignment_renderer_version, prompt_package_id, draft_id)
      VALUES (
        $1,
        'failed',
        $2,
        $3,
        'html',
        'later rerun failed',
        NOW() + INTERVAL '1 minute',
        NOW() + INTERVAL '1 minute',
        NOW() + INTERVAL '1 minute'
      , '{"format":"assignment_v1","schemaVersion":1,"serializationVersion":1,"workingVersion":1,"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","storageUri":"local://drafts/content/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"}'::jsonb, 2, uuid_generate_v4(), uuid_generate_v4())
      `,
      [jobId, params.studentId, params.lessonId],
    );
  });
  return jobId;
}

async function insertBusinessPayment(params: {
  studentId: string;
  amountMinor: number;
  currency: string;
  receivedAt: string;
  workspaceId?: string;
  voidedAt?: string;
}) {
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `
      INSERT INTO student_payment_records (
        id,
        student_id,
        workspace_id,
        amount_minor,
        currency,
        received_at,
        voided_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        randomUUID(),
        params.studentId,
        params.workspaceId ?? DEFAULT_WORKSPACE_ID,
        params.amountMinor,
        params.currency,
        params.receivedAt,
        params.voidedAt ?? null,
      ],
    );
  });
}

async function prepareTranscriptOnlyLesson(
  userId: string,
  studentId: string,
  lessonId: string | null,
) {
  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  const hash = 'a'.repeat(64);
  const session = await confirmStudentAssignmentSessionForUser(userId, {
    requestId: randomUUID(),
    studentId,
    lessonId,
  });
  await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
    await client.query(
      `INSERT INTO recordings (id, source, student_id, storage_uri, bytes, status, audio_topology,
        source_identity_kind, source_fingerprint_scheme, source_fingerprint)
       VALUES ($1, 'upload', $2, $3, 12, 'transcribed', 'mixed_recording', 'audio',
        'prepared-media-sha256-v1', $4)`,
      [
        recordingId,
        studentId,
        `local://recordings/${recordingId}.mp3`,
        recordingId.replaceAll('-', '').repeat(2),
      ],
    );
    await client.query(
      `INSERT INTO transcripts (id, recording_id, storage_uri, working_version, content_hash, stt_provider,
        mode, model, language, fallback_used, summary_json)
       VALUES ($1, $2, $3, 1, $4, 'elevenlabs', 'timeline', 'scribe_v2', 'auto', false, $5::jsonb)`,
      [
        transcriptId,
        recordingId,
        `local://transcripts/${transcriptId}.txt`,
        hash,
        JSON.stringify({
          audioTopology: 'mixed_recording',
          speakerTracks: { speakers: [{ speaker: 0 }, { speaker: 1 }] },
          speakerRoleMapping: {
            version: 'speaker-role-mapping-v1',
            provenance: 'tutor_confirmed',
            confidence: null,
            roles: [
              { speaker: 0, role: 'teacher' },
              { speaker: 1, role: 'student' },
            ],
            confirmedWorkingVersion: 1,
            confirmedContentHash: hash,
          },
        }),
      ],
    );
  });
  const attached = await attachAssignmentSourceForUser(userId, session.id, {
    expectedRevision: session.revision,
    recordingId,
    transcriptId,
  });
  const saved = await updateAssignmentSessionRecoveryForUser(userId, session.id, {
    expectedRevision: attached.session.revision,
    patch: { homeworkIntent: 'none' },
  });
  return {
    session: saved,
    request: {
      expectedRevision: saved.revision,
      lessonId,
      recordingId,
      transcriptId,
      transcriptWorkingVersion: 1,
      transcriptHash: hash,
    },
  };
}

describeIfPg('application/student-schedule-billing', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-05T00:00:00.000Z'));
    await resetScheduleBillingTables();
  });

  afterAll(async () => {
    vi.useRealTimers();
    await resetScheduleBillingTables();
    await closePgPool();
  });

  it('keeps today and recent history independent of future volume, pages ties and preserves visible exceptions', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    const studentId = await seedStudentInWorkspace(alpha.workspaceId, 'Synthetic learner');
    await updateBusinessSettings(alpha.workspaceId, { timezone: 'Asia/Saigon' });
    // Local day is May 5, beginning at 17:00Z on May 4.
    vi.setSystemTime(new Date('2026-05-05T12:00:00Z'));
    const today = await seedLessonInWorkspace(alpha.workspaceId, studentId, '2026-05-04T17:00:00Z');
    const endToday = await seedLessonInWorkspace(
      alpha.workspaceId,
      studentId,
      '2026-05-05T16:59:59Z',
    );
    const moved = await seedLessonInWorkspace(alpha.workspaceId, studentId, '2026-05-05T17:00:00Z');
    const hidden = await seedLessonInWorkspace(
      alpha.workspaceId,
      studentId,
      '2026-05-05T18:00:00Z',
    );
    const canceled = await seedLessonInWorkspace(
      alpha.workspaceId,
      studentId,
      '2026-05-05T19:00:00Z',
    );
    const recent: string[] = [];
    for (let i = 0; i < 23; i++) {
      recent.push(
        await seedLessonInWorkspace(alpha.workspaceId, studentId, '2026-05-04T16:59:59.123456Z'),
      );
    }
    const microsecondEarlier = await seedLessonInWorkspace(
      alpha.workspaceId,
      studentId,
      '2026-05-04T16:59:59.123455Z',
    );
    const future: string[] = [];
    for (let i = 0; i < 45; i++) {
      future.push(
        await seedLessonInWorkspace(alpha.workspaceId, studentId, '2026-06-01T10:00:00Z'),
      );
    }
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query('UPDATE student_lessons SET schedule_hidden_at = NOW() WHERE id = $1', [
        hidden,
      ]);
      await client.query("UPDATE student_lessons SET status = 'canceled' WHERE id = $1", [
        canceled,
      ]);
      await client.query("UPDATE student_lessons SET title = 'Moved occurrence' WHERE id = $1", [
        moved,
      ]);
    });
    const before = await readStudentBusinessMutationSnapshot(studentId);
    const surface = await getStudentScheduleBillingSurface(alpha.workspaceId, studentId);
    expect(surface?.lessonWindows).toMatchObject({
      timezone: 'Asia/Ho_Chi_Minh',
      date: '2026-05-05',
    });
    expect(surface?.lessonWindows.today.map((lesson) => lesson.id)).toEqual([today, endToday]);
    expect(surface?.lessonWindows.upcoming.items.map((lesson) => lesson.id)).toEqual([
      moved,
      canceled,
      [...future].sort()[0],
    ]);
    expect(surface?.lessonWindows.upcoming.items[1]?.status).toBe('canceled');
    expect(surface?.lessonWindows.recent.items.map((lesson) => lesson.id)).toEqual(
      [...recent].sort().reverse().slice(0, 10),
    );
    const olderIds = surface?.lessonWindows.recent.items.map((lesson) => lesson.id) ?? [];
    let cursor = surface?.lessonWindows.recent.nextCursor;
    while (cursor) {
      const page = await getStudentLessonPage(alpha.workspaceId, studentId, 'recent', cursor);
      olderIds.push(...(page?.items.map((lesson) => lesson.id) ?? []));
      cursor = page?.nextCursor;
    }
    expect(olderIds).toEqual([...recent].sort().reverse().concat(microsecondEarlier));
    const upcomingIds = surface?.lessonWindows.upcoming.items.map((lesson) => lesson.id) ?? [];
    cursor = surface?.lessonWindows.upcoming.nextCursor;
    while (cursor) {
      const page = await getStudentLessonPage(alpha.workspaceId, studentId, 'upcoming', cursor);
      upcomingIds.push(...(page?.items.map((lesson) => lesson.id) ?? []));
      cursor = page?.nextCursor;
    }
    expect(upcomingIds).toEqual([moved, canceled, ...future.sort()]);
    expect(new Set(upcomingIds).size).toBe(upcomingIds.length);
    expect(await getStudentLesson(alpha.workspaceId, studentId, microsecondEarlier)).toMatchObject({
      id: microsecondEarlier,
    });
    expect(await getStudentLesson(alpha.workspaceId, studentId, hidden)).toBeNull();
    expect(await readStudentBusinessMutationSnapshot(studentId)).toEqual(before);
    const edited = await updateStudentLesson(alpha.workspaceId, studentId, today, {
      notes: 'Checked lesson',
    });
    expect(edited.lessonWindows.today[0]).toMatchObject({ id: today, notes: 'Checked lesson' });
    expect(edited.lessonWindows.recent.items).toHaveLength(10);
    expect(edited.lessonWindows.upcoming.items).toHaveLength(3);

    const anotherStudent = await seedStudentInWorkspace(alpha.workspaceId, 'Another learner');
    const beta = await seedWorkspaceTutor('beta');
    const initialCursor = surface?.lessonWindows.recent.nextCursor ?? '';
    await expect(
      getStudentLessonPage(alpha.workspaceId, anotherStudent, 'recent', initialCursor),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      getStudentLessonPage(alpha.workspaceId, studentId, 'upcoming', initialCursor),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      getStudentLessonPage(alpha.workspaceId, studentId, 'recent', 'malformed'),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await getStudentLessonPage(beta.workspaceId, studentId, 'recent', initialCursor),
    ).toBeNull();
    expect(await getStudentLesson(beta.workspaceId, studentId, today)).toBeNull();
    expect(await getStudentLesson(alpha.workspaceId, anotherStudent, today)).toBeNull();
    // Paging stays on the original day after midnight until an explicit refresh.
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));
    expect(
      (await getStudentLessonPage(alpha.workspaceId, studentId, 'recent', initialCursor))?.items,
    ).toHaveLength(10);
    await updateBusinessSettings(alpha.workspaceId, { timezone: 'UTC' });
    await expect(
      getStudentLessonPage(alpha.workspaceId, studentId, 'recent', initialCursor),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['2026-03-08T12:00:00Z', '2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01T12:00:00Z', '2026-11-01', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
  ])('uses calendar midnights across DST at %s', async (now, date, start, end) => {
    const alpha = await seedWorkspaceTutor('alpha');
    const studentId = await seedStudentInWorkspace(alpha.workspaceId, 'DST learner');
    vi.setSystemTime(new Date(now));
    await updateBusinessSettings(alpha.workspaceId, { timezone: 'America/New_York' });
    const previous = await seedLessonInWorkspace(
      alpha.workspaceId,
      studentId,
      new Date(Date.parse(start) - 1).toISOString(),
    );
    const first = await seedLessonInWorkspace(alpha.workspaceId, studentId, start);
    const last = await seedLessonInWorkspace(
      alpha.workspaceId,
      studentId,
      new Date(Date.parse(end) - 1).toISOString(),
    );
    const next = await seedLessonInWorkspace(alpha.workspaceId, studentId, end);
    const surface = await getStudentScheduleBillingSurface(alpha.workspaceId, studentId);
    expect(surface?.lessonWindows.date).toBe(date);
    expect(surface?.lessonWindows.today.map((lesson) => lesson.id)).toEqual([first, last]);
    expect(surface?.lessonWindows.recent.items.map((lesson) => lesson.id)).toEqual([previous]);
    expect(surface?.lessonWindows.upcoming.items.map((lesson) => lesson.id)).toEqual([next]);
  });

  it('returns truthful empty and upcoming-only windows', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    const studentId = await seedStudentInWorkspace(alpha.workspaceId, 'Upcoming learner');
    const empty = await getStudentScheduleBillingSurface(alpha.workspaceId, studentId);
    expect(empty?.lessonWindows).toMatchObject({
      today: [],
      recent: { items: [], nextCursor: null },
      upcoming: { items: [], nextCursor: null },
    });
    const future = await seedLessonInWorkspace(
      alpha.workspaceId,
      studentId,
      '2026-05-06T10:00:00Z',
    );
    const surface = await getStudentScheduleBillingSurface(alpha.workspaceId, studentId);
    expect(surface?.lessonWindows.today).toEqual([]);
    expect(surface?.lessonWindows.recent).toEqual({ items: [], nextCursor: null });
    expect(surface?.lessonWindows.upcoming.items.map((lesson) => lesson.id)).toEqual([future]);
    expect(surface?.lessonWindows.upcoming.nextCursor).toBeNull();
  });

  it('uses the requested tutor workspace for business settings', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    await seedWorkspaceTutor('beta');

    expect(await resolvePrimaryWorkspaceIdForUser(alpha.userId)).toBe(alpha.workspaceId);

    const settings = await getBusinessSettings(alpha.workspaceId);

    expect(settings).toMatchObject({
      workspaceId: alpha.workspaceId,
      defaultCurrency: 'AUD',
      defaultLessonRateMinor: 4100,
    });
  });

  it('rejects cross-workspace student schedule-billing reads with the current API shape', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    const beta = await seedWorkspaceTutor('beta');
    const betaStudentId = await seedStudentInWorkspace(beta.workspaceId, 'Beta student');

    expect(await resolvePrimaryWorkspaceIdForUser(alpha.userId)).toBe(alpha.workspaceId);

    await expect(
      getStudentScheduleBillingSurface(alpha.workspaceId, betaStudentId),
    ).resolves.toBeNull();
  });

  it('rejects cross-workspace lesson-plan updates with the current API shape', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    const beta = await seedWorkspaceTutor('beta');
    const betaStudentId = await seedStudentInWorkspace(beta.workspaceId, 'Beta student');

    await expect(
      updateStudentLessonPlan(
        alpha.workspaceId,
        betaStudentId,
        { timezone: 'Asia/Tokyo' },
        alpha.userId,
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });

  it('rejects every cross-workspace student business mutation without changing persisted rows', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    const beta = await seedWorkspaceTutor('beta');
    const betaStudentId = await seedStudentInWorkspace(beta.workspaceId, 'Beta student');
    const betaLessonId = await seedLessonInWorkspace(
      beta.workspaceId,
      betaStudentId,
      '2026-05-08T10:00:00.000Z',
    );
    const attempts = [
      () =>
        updateStudentLessonPlan(
          alpha.workspaceId,
          betaStudentId,
          { timezone: 'Asia/Tokyo' },
          alpha.userId,
        ),
      () =>
        updateStudentLesson(
          alpha.workspaceId,
          betaStudentId,
          betaLessonId,
          { notes: 'Blocked update' },
          alpha.userId,
        ),
      () =>
        hideStudentLessonFollowupReminder(
          alpha.workspaceId,
          betaStudentId,
          betaLessonId,
          alpha.userId,
        ),
      () => undoLatestHiddenStudentReminder(alpha.workspaceId, betaStudentId, alpha.userId),
      () => addStudentPackage(alpha.workspaceId, betaStudentId, { lessons: 4 }, alpha.userId),
      () =>
        adjustStudentCredits(alpha.workspaceId, betaStudentId, { quantityDelta: 2 }, alpha.userId),
      () =>
        recordStudentPayment(
          alpha.workspaceId,
          betaStudentId,
          { amountMinor: 9000, currency: 'CAD', receivedAt: '2026-05-08' },
          alpha.userId,
        ),
    ];

    for (const attempt of attempts) {
      const before = await readStudentBusinessMutationSnapshot(betaStudentId);
      await expect(attempt()).rejects.toMatchObject({ code: 'not_found', status: 404 });
      expect(await readStudentBusinessMutationSnapshot(betaStudentId)).toEqual(before);
    }
  });

  it('rejects foreign lesson IDs under an authorized student without changing either student', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    const beta = await seedWorkspaceTutor('beta');
    const alphaStudentId = await seedStudentInWorkspace(alpha.workspaceId, 'Alpha student');
    const betaStudentId = await seedStudentInWorkspace(beta.workspaceId, 'Beta student');
    const betaLessonId = await seedLessonInWorkspace(
      beta.workspaceId,
      betaStudentId,
      '2026-05-08T10:00:00.000Z',
    );
    const beforeAlpha = await readStudentBusinessMutationSnapshot(alphaStudentId);
    const beforeBeta = await readStudentBusinessMutationSnapshot(betaStudentId);

    await expect(
      updateStudentLesson(
        alpha.workspaceId,
        alphaStudentId,
        betaLessonId,
        { notes: 'Blocked nested update' },
        alpha.userId,
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(
      hideStudentLessonFollowupReminder(
        alpha.workspaceId,
        alphaStudentId,
        betaLessonId,
        alpha.userId,
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });

    expect(await readStudentBusinessMutationSnapshot(alphaStudentId)).toEqual(beforeAlpha);
    expect(await readStudentBusinessMutationSnapshot(betaStudentId)).toEqual(beforeBeta);
  });

  it('isolates dashboard reads, settings writes, without writes across workspaces', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    const beta = await seedWorkspaceTutor('beta');
    const alphaStudentId = await seedStudentInWorkspace(alpha.workspaceId, 'Alpha student');
    const betaStudentId = await seedStudentInWorkspace(beta.workspaceId, 'Beta student');
    await addStudentPackage(
      alpha.workspaceId,
      alphaStudentId,
      {
        lessons: 4,
        payment: { amountMinor: 12000, currency: 'AUD', receivedAt: '2026-05-06' },
      },
      alpha.userId,
    );
    await addStudentPackage(
      beta.workspaceId,
      betaStudentId,
      {
        lessons: 6,
        payment: { amountMinor: 18000, currency: 'CAD', receivedAt: '2026-05-06' },
      },
      beta.userId,
    );
    await seedUnmanagedLesson(
      alpha.workspaceId,
      alphaStudentId,
      {
        startsAt: '2026-05-08T10:00:00.000Z',
        status: 'completed',
        consumesCredit: true,
      },
      alpha.userId,
    );
    await seedUnmanagedLesson(
      beta.workspaceId,
      betaStudentId,
      { startsAt: '2026-05-08T12:00:00.000Z', status: 'scheduled' },
      beta.userId,
    );
    await seedLessonInWorkspace(alpha.workspaceId, betaStudentId, '2026-05-08T14:00:00.000Z');

    await updateBusinessSettings(alpha.workspaceId, { topUpThreshold: 1 }, alpha.userId);
    const schedule = await getBusinessScheduleSurface(alpha.workspaceId, {
      from: '2026-05-08',
      to: '2026-05-08',
    });
    const stats = await getBusinessStatsSurface(alpha.workspaceId, { month: '2026-05' });

    expect(schedule.workspaceId).toBe(alpha.workspaceId);
    expect(schedule.lessons.map((lesson) => lesson.studentId)).toEqual([alphaStudentId]);
    expect(schedule.recentPayments.map((payment) => payment.studentId)).toEqual([alphaStudentId]);
    expect(stats).toMatchObject({
      workspaceId: alpha.workspaceId,
      currency: 'AUD',
      collectedMinor: 12000,
      completedLessons: 1,
    });
    expect(await getBusinessSettings(beta.workspaceId)).toMatchObject({
      defaultCurrency: 'CAD',
      topUpThreshold: 2,
    });
  });

  it('confines legacy null-workspace business rows to the default workspace', async () => {
    const { studentId } = await seedStudentWithoutWorkspace();
    const alpha = await seedWorkspaceTutor('alpha');
    const lessonId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `
        INSERT INTO student_lesson_plans (student_id, workspace_id, timezone)
        VALUES ($1, NULL, 'Asia/Bangkok')
        `,
        [studentId],
      );
      await client.query(
        `
        INSERT INTO student_lessons (
          id,
          student_id,
          workspace_id,
          starts_at,
          timezone,
          duration_minutes,
          status,
          consumes_credit
        )
        VALUES ($1, $2, NULL, '2026-05-08T10:00:00.000Z', 'UTC', 60, 'scheduled', FALSE)
        `,
        [lessonId, studentId],
      );
      await client.query(
        `
        INSERT INTO student_reminder_preferences (
          student_id,
          workspace_id,
          preferred_channel
        )
        VALUES ($1, NULL, 'email')
        `,
        [studentId],
      );
      await client.query(
        `
        INSERT INTO student_credit_events (
          id,
          student_id,
          workspace_id,
          event_type,
          quantity_delta
        )
        VALUES ($1, $2, NULL, 'credit_added', 3)
        `,
        [randomUUID(), studentId],
      );
      await client.query(
        `
        INSERT INTO student_payment_records (
          id,
          student_id,
          workspace_id,
          amount_minor,
          currency,
          received_at
        )
        VALUES ($1, $2, NULL, 7000, 'USD', '2026-05-06')
        `,
        [randomUUID(), studentId],
      );
    });

    const defaultSurface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    const defaultSchedule = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID, {
      from: '2026-05-08',
      to: '2026-05-08',
    });
    const defaultStats = await getBusinessStatsSurface(DEFAULT_WORKSPACE_ID, { month: '2026-05' });

    expect(defaultSurface).toMatchObject({
      workspaceId: DEFAULT_WORKSPACE_ID,
      lessonPlan: { workspaceId: DEFAULT_WORKSPACE_ID, timezone: 'Asia/Bangkok' },
      creditSummary: { remaining: 3 },
    });
    expect(defaultSurface?.lessons.map((lesson) => lesson.id)).toContain(lessonId);
    expect(defaultSurface?.creditEvents).toHaveLength(1);
    expect(defaultSurface?.payments).toHaveLength(1);
    expect(defaultSurface?.reminders.every((reminder) => reminder.channel === 'email')).toBe(true);
    expect(defaultSchedule.lessons.map((lesson) => lesson.id)).toContain(lessonId);
    expect(defaultSchedule.recentPayments.map((payment) => payment.studentId)).toContain(studentId);
    expect(defaultStats.collectedMinor).toBe(7000);

    await expect(
      getStudentScheduleBillingSurface(alpha.workspaceId, studentId),
    ).resolves.toBeNull();
    const alphaSchedule = await getBusinessScheduleSurface(alpha.workspaceId, {
      from: '2026-05-08',
      to: '2026-05-08',
    });
    const alphaStats = await getBusinessStatsSurface(alpha.workspaceId, { month: '2026-05' });
    expect(alphaSchedule.lessons).toHaveLength(0);
    expect(alphaSchedule.recentPayments).toHaveLength(0);
    expect(alphaStats.collectedMinor).toBe(0);
  });

  it('excludes mismatched child rows even when they reference an authorized student', async () => {
    const alpha = await seedWorkspaceTutor('alpha');
    const beta = await seedWorkspaceTutor('beta');
    const alphaStudentId = await seedStudentInWorkspace(alpha.workspaceId, 'Alpha student');
    const mismatchedLessonId = await seedLessonInWorkspace(
      beta.workspaceId,
      alphaStudentId,
      '2026-05-08T10:00:00.000Z',
    );
    const alphaLessonId = await seedLessonInWorkspace(
      alpha.workspaceId,
      alphaStudentId,
      '2026-05-09T10:00:00.000Z',
    );
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `
        INSERT INTO student_lesson_plans (student_id, workspace_id, timezone)
        VALUES ($1, $2, 'Asia/Tokyo')
        `,
        [alphaStudentId, beta.workspaceId],
      );
      await client.query(
        `
        INSERT INTO student_reminder_preferences (student_id, workspace_id, preferred_channel)
        VALUES ($1, $2, 'email')
        `,
        [alphaStudentId, beta.workspaceId],
      );
      await client.query(
        `
        INSERT INTO student_credit_events (
          id,
          student_id,
          workspace_id,
          event_type,
          quantity_delta
        )
        VALUES ($1, $2, $3, 'credit_added', 9)
        `,
        [randomUUID(), alphaStudentId, beta.workspaceId],
      );
      await client.query(
        `
        INSERT INTO student_payment_records (
          id,
          student_id,
          workspace_id,
          amount_minor,
          currency,
          received_at
        )
        VALUES ($1, $2, $3, 19000, 'CAD', '2026-05-06')
        `,
        [randomUUID(), alphaStudentId, beta.workspaceId],
      );
    });

    const surface = await getStudentScheduleBillingSurface(alpha.workspaceId, alphaStudentId);

    expect(surface).toMatchObject({
      lessonPlan: { timezone: 'UTC', workspaceId: alpha.workspaceId },
      creditSummary: { remaining: 0 },
      creditEvents: [],
      payments: [],
    });
    expect(surface?.lessons.map((lesson) => lesson.id)).toEqual([alphaLessonId]);
    expect(surface?.reminders.every((reminder) => reminder.channel === 'manual')).toBe(true);
    const before = await readStudentBusinessMutationSnapshot(alphaStudentId);
    await expect(
      updateStudentLessonPlan(
        alpha.workspaceId,
        alphaStudentId,
        { timezone: 'Asia/Bangkok' },
        alpha.userId,
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(
      hideStudentLessonFollowupReminder(
        alpha.workspaceId,
        alphaStudentId,
        alphaLessonId,
        alpha.userId,
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(
      updateStudentLesson(
        alpha.workspaceId,
        alphaStudentId,
        mismatchedLessonId,
        { notes: 'Blocked mismatched update' },
        alpha.userId,
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(
      hideStudentLessonFollowupReminder(
        alpha.workspaceId,
        alphaStudentId,
        mismatchedLessonId,
        alpha.userId,
      ),
    ).rejects.toMatchObject({ code: 'not_found', status: 404 });
    expect(await readStudentBusinessMutationSnapshot(alphaStudentId)).toEqual(before);
  });

  it('adds lesson packages, records payment facts, and derives the remaining balance', async () => {
    const { studentId, userId } = await seedStudent();

    const surface = await addStudentPackage(
      DEFAULT_WORKSPACE_ID,
      studentId,
      {
        lessons: 8,
        note: 'May package',
        payment: {
          amountMinor: 12000,
          currency: 'USD',
          method: 'Bank transfer',
          receivedAt: '2026-05-06',
          note: 'Paid in full',
        },
      },
      userId,
    );

    expect(surface.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(surface.creditSummary).toMatchObject({
      purchased: 8,
      consumed: 0,
      remaining: 8,
      isLow: false,
      isNegative: false,
    });
    expect(surface.payments).toHaveLength(1);
    expect(surface.payments[0]).toMatchObject({
      amountMinor: 12000,
      currency: 'USD',
      method: 'Bank transfer',
      receivedAt: '2026-05-06',
    });
  });

  it('consumes exactly one credit when a chargeable lesson is completed and voids it if uncharged', async () => {
    const { studentId, userId } = await seedStudent();
    await addStudentPackage(DEFAULT_WORKSPACE_ID, studentId, { lessons: 1 }, userId);

    let surface = await seedUnmanagedLesson(
      DEFAULT_WORKSPACE_ID,
      studentId,
      {
        startsAt: '2026-05-07T10:00:00.000Z',
        status: 'completed',
        consumesCredit: true,
      },
      userId,
    );

    const lesson = surface.lessons[0];
    expect(lesson).toBeDefined();
    const lessonId = lesson?.id ?? '';
    expect(surface.creditSummary.remaining).toBe(0);
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(1);

    surface = await updateStudentLesson(
      DEFAULT_WORKSPACE_ID,
      studentId,
      lessonId,
      {
        status: 'completed',
        consumesCredit: true,
      },
      userId,
    );
    expect(surface.creditSummary.remaining).toBe(0);
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(1);

    surface = await updateStudentLesson(
      DEFAULT_WORKSPACE_ID,
      studentId,
      lessonId,
      {
        status: 'completed',
        consumesCredit: false,
      },
      userId,
    );
    expect(surface.creditSummary.remaining).toBe(1);
    expect(surface.lessons.find((candidate) => candidate.id === lessonId)).toMatchObject({
      status: 'completed',
      consumesCredit: false,
      creditEventId: null,
    });
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query<{ completed_by: string | null }>(
        'SELECT completed_by FROM student_lessons WHERE id = $1',
        [lessonId],
      );
      expect(result.rows[0]?.completed_by).toBe(userId);
    });
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(0);

    surface = await updateStudentLesson(
      DEFAULT_WORKSPACE_ID,
      studentId,
      lessonId,
      {
        status: 'completed',
        consumesCredit: false,
      },
      userId,
    );
    expect(surface.creditSummary.remaining).toBe(1);
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(0);
  });

  it('never generates lessons from retained recurrence history while serving schedule and stats reads', async () => {
    const { studentId } = await seedStudent();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        'INSERT INTO student_lesson_plans(student_id,workspace_id,retired_schedule_preferences) VALUES($1,$2,$3::jsonb)',
        [
          studentId,
          DEFAULT_WORKSPACE_ID,
          JSON.stringify({
            rules: [
              {
                id: randomUUID(),
                status: 'active',
                timezone: 'UTC',
                starts_on: '2026-01-01',
                frequency: 'weekly',
                generation_horizon_days: 366,
                slots: [
                  {
                    id: randomUUID(),
                    iso_weekday: 1,
                    local_start_time: '11:00',
                    duration_minutes: 60,
                  },
                ],
              },
            ],
          }),
        ],
      );
    });
    const before = await readStudentBusinessMutationSnapshot(studentId);
    for (let pass = 0; pass < 2; pass++) {
      const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
      expect(surface?.lessons).toEqual([]);
      expect(
        (
          await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID, {
            from: '2026-05-01',
            to: '2026-05-31',
          })
        ).lessons,
      ).toEqual([]);
      expect(
        (await getBusinessStatsSurface(DEFAULT_WORKSPACE_ID, { month: '2026-05' }))
          .completedLessons,
      ).toBe(0);
    }
    expect(await readStudentBusinessMutationSnapshot(studentId)).toEqual(before);
  });

  it('returns honest empty-state reminders for students without lessons or credits', async () => {
    const { studentId } = await seedStudent();

    const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);

    expect(surface?.nextLesson).toBeNull();
    expect(surface?.creditSummary.remaining).toBe(0);
    expect(surface?.reminders.map((reminder) => reminder.type)).toEqual([
      'no_next_lesson',
      'low_balance',
      'payment_followup',
    ]);
  });

  it('surfaces elapsed scheduled lessons as homework follow-ups until homework is published', async () => {
    const { studentId } = await seedStudent();
    const elapsedLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      consumesCredit: true,
      title: 'Present perfect review',
    });
    await insertBusinessLesson({
      studentId,
      startsAt: '2999-01-01T10:00:00.000Z',
      consumesCredit: true,
    });

    let surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);

    expect(
      surface?.reminders.find(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === elapsedLessonId,
      ),
    ).toMatchObject({
      type: 'lesson_followup',
      actionIntent: 'complete_lesson_and_start_assignment',
      lessonStatus: 'scheduled',
      lessonConsumesCredit: true,
      title: 'Finish lesson follow-up',
      lessonSummary: {
        lessonId: elapsedLessonId,
        startsAt: '2000-01-01T10:00:00.000Z',
        title: 'Present perfect review',
      },
    });
    expect(
      surface?.lessons.find((lesson) => lesson.id === elapsedLessonId)?.homework,
    ).toMatchObject({
      status: 'not_started',
    });

    const jobId = await insertSucceededHomeworkJob({ studentId, lessonId: elapsedLessonId });
    await insertFailedHomeworkJob({ studentId, lessonId: elapsedLessonId });
    surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);

    expect(
      surface?.reminders.some(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === elapsedLessonId,
      ),
    ).toBe(false);
    expect(
      surface?.lessons.find((lesson) => lesson.id === elapsedLessonId)?.homework,
    ).toMatchObject({
      status: 'published',
      jobId,
      htmlUrl: 'https://example.test/hw',
    });
  });

  it('caps student follow-up reminders after suppressing already published overdue lessons', async () => {
    const { studentId } = await seedStudent();
    const overdueUnpublishedLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      consumesCredit: true,
    });

    for (let index = 0; index < 31; index += 1) {
      const publishedLessonId = await insertBusinessLesson({
        studentId,
        startsAt: `2001-01-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
        consumesCredit: true,
      });
      await insertSucceededHomeworkJob({ studentId, lessonId: publishedLessonId });
    }

    const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);

    expect(
      surface?.reminders.some(
        (reminder) =>
          reminder.type === 'lesson_followup' && reminder.lessonId === overdueUnpublishedLessonId,
      ),
    ).toBe(true);
  });

  it('validates assignment session lesson lineage against the resulting selected student', async () => {
    const { studentId, userId } = await seedStudent();
    const otherStudentId = await seedAdditionalStudent('Bella');
    const matchingLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-18T10:00:00.000Z',
    });
    const mismatchedLessonId = await insertBusinessLesson({
      studentId: otherStudentId,
      startsAt: '2026-05-19T10:00:00.000Z',
    });

    await expect(
      confirmStudentAssignmentSessionForUser(userId, {
        requestId: randomUUID(),
        studentId,
        lessonId: mismatchedLessonId,
      }),
    ).rejects.toThrow('Assignment session lesson must belong to the selected student');

    const session = await confirmStudentAssignmentSessionForUser(userId, {
      requestId: randomUUID(),
      studentId,
      lessonId: matchingLessonId,
    });

    await expect(
      updateAssignmentSessionRecoveryForUser(userId, session.id, {
        expectedRevision: session.revision,
        patch: { lessonId: mismatchedLessonId },
      }),
    ).rejects.toThrow('Assignment session lesson must belong to the selected student');

    await expect(
      updateAssignmentSessionRecoveryForUser(userId, session.id, {
        expectedRevision: session.revision,
        patch: { lessonId: matchingLessonId },
      }),
    ).resolves.toMatchObject({
      id: session.id,
      studentId,
      lessonId: matchingLessonId,
    });
  });

  it('derives draft progress only from an active assignment session', async () => {
    const { studentId, userId } = await seedStudent();
    const lessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2030-05-18T10:00:00.000Z',
    });
    const recordingId = randomUUID();
    const transcriptId = randomUUID();
    const promptPackageId = randomUUID();
    const draftId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO recordings (
           id, source, student_id, storage_uri, bytes, status, sha256,
           source_identity_kind, source_fingerprint_scheme, source_fingerprint
         ) VALUES ($1, 'upload', $2, $3, 12, 'transcribed', $4, 'audio',
                   'prepared-media-sha256-v1', $4)`,
        [recordingId, studentId, `s3://recordings/${recordingId}.mp3`, 'c'.repeat(64)],
      );
      await client.query(
        `INSERT INTO transcripts (
           id, recording_id, storage_uri, stt_provider, working_version, content_hash
         ) VALUES ($1, $2, $3, 'deepgram', 1, $4)`,
        [transcriptId, recordingId, `s3://transcripts/${transcriptId}.txt`, 'a'.repeat(64)],
      );
      await client.query(
        `INSERT INTO prompt_packages (
           id, recording_id, transcript_id, student_id, lesson_id, template_version, storage_uri, request_envelope
         ) VALUES ($1, $2, $3, $4, $5, 'v1', $6, $7::jsonb)`,
        [
          promptPackageId,
          recordingId,
          transcriptId,
          studentId,
          lessonId,
          `s3://prompt-packages/${promptPackageId}.txt`,
          JSON.stringify(promptPackageFixture().requestEnvelope),
        ],
      );
      await client.query(
        `INSERT INTO drafts (
           id, prompt_package_id, student_id, lesson_id, storage_uri, created_by,
           working_version, content_hash
         , format) VALUES ($1, $2, $3, $4, CASE WHEN $5::text IS NOT NULL THEN 'local://drafts/content/' || $7 || '.json' ELSE NULL END, $6, 1, $7, 'assignment_v1')`,
        [
          draftId,
          promptPackageId,
          studentId,
          lessonId,
          `s3://drafts/${draftId}.md`,
          userId,
          'b'.repeat(64),
        ],
      );
    });

    let surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    expect(surface?.lessons.find((lesson) => lesson.id === lessonId)?.homework.status).toBe(
      'not_started',
    );
    let business = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID, {
      from: '2030-05-18',
      to: '2030-05-18',
    });
    expect(business.lessons.find((lesson) => lesson.id === lessonId)?.homework.status).toBe(
      'not_started',
    );

    const session = await confirmStudentAssignmentSessionForUser(userId, {
      requestId: randomUUID(),
      studentId,
      lessonId,
    });
    surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    expect(surface?.lessons.find((lesson) => lesson.id === lessonId)?.homework.status).toBe(
      'session_in_progress',
    );

    const attached = await attachAssignmentSourceForUser(userId, session.id, {
      expectedRevision: session.revision,
      recordingId,
      transcriptId,
    });
    expect(attached.outcome).toBe('source_attached');
    await updateAssignmentSessionRecoveryForUser(userId, session.id, {
      expectedRevision: attached.session.revision,
      patch: { draftId, promptPackageId },
    });
    surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    expect(surface?.lessons.find((lesson) => lesson.id === lessonId)?.homework.status).toBe(
      'draft_in_progress',
    );

    const shareJobId = randomUUID();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `INSERT INTO jobs (id, state, student_id, lesson_id, user_id, assignment_artifact, assignment_renderer_version, prompt_package_id, draft_id)
         VALUES ($1, 'queued', $2, $3, $4, '{"format":"assignment_v1","schemaVersion":1,"serializationVersion":1,"workingVersion":1,"contentHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","storageUri":"local://drafts/content/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json"}'::jsonb, 2, uuid_generate_v4(), uuid_generate_v4())`,
        [shareJobId, studentId, lessonId, userId],
      );
      await client.query(
        `UPDATE assignment_sessions
         SET confirmed_step = 'share', share_job_id = $2, revision = revision + 1
         WHERE id = $1`,
        [session.id, shareJobId],
      );
    });
    surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    expect(surface?.lessons.find((lesson) => lesson.id === lessonId)?.homework.status).toBe(
      'publishing',
    );
    business = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID, {
      from: '2030-05-18',
      to: '2030-05-18',
    });
    expect(business.lessons.find((lesson) => lesson.id === lessonId)?.homework.status).toBe(
      'publishing',
    );
  });

  it('applies generated lesson titles only to automatic placeholders', async () => {
    const { studentId } = await seedStudent();
    const nullTitleLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-18T10:00:00.000Z',
      title: null,
    });
    const blankTitleLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-19T10:00:00.000Z',
      title: '   ',
    });
    const placeholderLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-20T10:00:00.000Z',
      title: 'Untitled lesson',
    });
    const authoredLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-21T10:00:00.000Z',
      title: 'Tutor title',
    });

    await expect(
      applyGeneratedLessonTitleIfPlaceholder({
        studentId,
        lessonId: nullTitleLessonId,
        title: 'Travel Plans Review',
      }),
    ).resolves.toBe(true);
    await expect(
      applyGeneratedLessonTitleIfPlaceholder({
        studentId,
        lessonId: blankTitleLessonId,
        title: 'Article Practice',
      }),
    ).resolves.toBe(true);
    await expect(
      applyGeneratedLessonTitleIfPlaceholder({
        studentId,
        lessonId: placeholderLessonId,
        title: 'Past Tense Storytelling',
      }),
    ).resolves.toBe(true);
    await expect(
      applyGeneratedLessonTitleIfPlaceholder({
        studentId,
        lessonId: authoredLessonId,
        title: 'Generated Title',
      }),
    ).resolves.toBe(false);

    const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    expect(surface?.lessons.find((lesson) => lesson.id === nullTitleLessonId)?.title).toBe(
      'Travel Plans Review',
    );
    expect(surface?.lessons.find((lesson) => lesson.id === blankTitleLessonId)?.title).toBe(
      'Article Practice',
    );
    expect(surface?.lessons.find((lesson) => lesson.id === placeholderLessonId)?.title).toBe(
      'Past Tense Storytelling',
    );
    expect(surface?.lessons.find((lesson) => lesson.id === authoredLessonId)?.title).toBe(
      'Tutor title',
    );
  });

  it('marks an elapsed scheduled lesson completed when homework is added through an assignment session', async () => {
    const { studentId, userId } = await seedStudent();
    await addStudentPackage(DEFAULT_WORKSPACE_ID, studentId, { lessons: 1 }, userId);
    const lessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      status: 'scheduled',
      consumesCredit: false,
    });

    await confirmStudentAssignmentSessionForUser(userId, {
      requestId: randomUUID(),
      studentId,
      lessonId,
    });

    const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    expect(surface).not.toBeNull();
    if (!surface) {
      throw new Error('Expected schedule surface');
    }
    expect(surface.lessons.find((lesson) => lesson.id === lessonId)).toMatchObject({
      status: 'completed',
      consumesCredit: true,
    });
    expect(surface.creditSummary.remaining).toBe(0);
    expect(
      surface.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(1);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query<{ completed_by: string | null }>(
        'SELECT completed_by FROM student_lessons WHERE id = $1',
        [lessonId],
      );
      expect(result.rows[0]?.completed_by).toBe(userId);
    });
  });

  it('serializes concurrent session linking and lesson completion to one active debit', async () => {
    const { studentId, userId } = await seedStudent();
    const lessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
    });
    const sessions = await Promise.all([
      confirmStudentAssignmentSessionForUser(userId, {
        requestId: randomUUID(),
        studentId,
        lessonId,
      }),
      confirmStudentAssignmentSessionForUser(userId, {
        requestId: randomUUID(),
        studentId,
        lessonId,
      }),
      completeElapsedScheduledLessonForHomework(DEFAULT_WORKSPACE_ID, studentId, lessonId, userId),
      completeElapsedScheduledLessonForHomework(DEFAULT_WORKSPACE_ID, studentId, lessonId, userId),
    ]);
    const session = sessions[0];
    // The opt-out saves after the same billing boundary as ordinary homework.
    await updateAssignmentSessionRecoveryForUser(userId, session.id, {
      expectedRevision: session.revision,
      patch: { homeworkIntent: 'none' },
    });
    await completeElapsedScheduledLessonForHomework(
      DEFAULT_WORKSPACE_ID,
      studentId,
      lessonId,
      userId,
    );
    const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    expect(surface?.lessons.find((lesson) => lesson.id === lessonId)).toMatchObject({
      status: 'completed',
      consumesCredit: true,
    });
    expect(
      surface?.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(1);
    expect(surface?.creditSummary.consumed).toBe(1);
  });

  it('suppresses only current finished no-homework follow-ups on both surfaces and keeps real homework precedence', async () => {
    const { studentId, userId } = await seedStudent();
    const lessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
    });
    const prepared = await prepareTranscriptOnlyLesson(userId, studentId, lessonId);
    const surfaces = async () => ({
      student: await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId),
      business: await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID, {
        from: '2000-01-01',
        to: '2000-01-01',
      }),
    });
    const assertFollowup = (surface: Awaited<ReturnType<typeof surfaces>>, present: boolean) => {
      for (const value of [surface.student, surface.business]) {
        expect(
          value?.reminders.some(
            (item) => item.type === 'lesson_followup' && item.lessonId === lessonId,
          ),
        ).toBe(present);
      }
    };
    assertFollowup(await surfaces(), true);
    const finished = await finishTranscriptAssignmentSessionPersistence({
      id: prepared.session.id,
      userId,
      request: prepared.request,
      lessonMemory: {
        schemaVersion: 'lesson-memory-v1',
        provider: 'openai',
        model: 'deterministic-fixture',
        requestedAt: new Date(),
      },
    });
    const completed = await surfaces();
    assertFollowup(completed, false);
    for (const surface of [completed.student, completed.business]) {
      expect(surface?.lessons.find((lesson) => lesson.id === lessonId)?.homework).toMatchObject({
        status: 'not_planned',
        transcriptResultSessionId: prepared.session.id,
        assignmentSessionId: null,
        promptPackageId: null,
        draftId: null,
        jobId: null,
        homeworkMemoryEntryId: null,
        htmlUrl: null,
      });
      expect(surface?.reminders.some((item) => item.type === 'no_next_lesson')).toBe(true);
    }
    expect(
      completed.student?.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
    ).toHaveLength(1);
    const promoted = await startHomeworkAssignmentSessionPersistence({
      id: prepared.session.id,
      userId,
      expectedRevision: finished.session.revision,
    });
    assertFollowup(await surfaces(), true);
    const reselected = await updateAssignmentSessionRecoveryForUser(userId, promoted.id, {
      expectedRevision: promoted.revision,
      patch: { homeworkIntent: 'none' },
    });
    expect(reselected.transcriptCompletedAt).toBeNull();
    expect(reselected.transcriptCompletionHistory).toEqual(
      finished.session.transcriptCompletionHistory,
    );
    assertFollowup(await surfaces(), true);
    await finishTranscriptAssignmentSessionPersistence({
      id: reselected.id,
      userId,
      request: { ...prepared.request, expectedRevision: reselected.revision },
      lessonMemory: {
        schemaVersion: 'lesson-memory-v1',
        provider: 'openai',
        model: 'deterministic-fixture',
        requestedAt: new Date(),
      },
    });
    await confirmStudentAssignmentSessionForUser(userId, {
      requestId: randomUUID(),
      studentId,
      lessonId,
    });
    const withPlanned = await surfaces();
    assertFollowup(withPlanned, true);
    for (const surface of [withPlanned.student, withPlanned.business]) {
      expect(surface?.lessons.find((lesson) => lesson.id === lessonId)?.homework).toMatchObject({
        status: 'session_in_progress',
        transcriptResultSessionId: null,
      });
    }
    await insertSucceededHomeworkJob({ studentId, lessonId });
    const published = await surfaces();
    assertFollowup(published, false);
    for (const surface of [published.student, published.business]) {
      expect(surface?.lessons.find((lesson) => lesson.id === lessonId)?.homework.status).toBe(
        'published',
      );
    }
  });

  it.each([
    { status: 'completed' as const, startsAt: '2000-01-01T10:00:00.000Z' },
    { status: 'canceled' as const, startsAt: '2000-01-01T10:00:00.000Z' },
    { status: 'no_show' as const, startsAt: '2000-01-01T10:00:00.000Z' },
    { status: 'scheduled' as const, startsAt: '2099-01-01T10:00:00.000Z' },
  ])(
    'preserves the ledger for $status/$startsAt when linking and saving no homework',
    async ({ status, startsAt }) => {
      const { studentId, userId } = await seedStudent();
      const lessonId = await insertBusinessLesson({
        studentId,
        startsAt,
        status,
        consumesCredit: false,
      });
      const session = await confirmStudentAssignmentSessionForUser(userId, {
        requestId: randomUUID(),
        studentId,
        lessonId,
      });
      await updateAssignmentSessionRecoveryForUser(userId, session.id, {
        expectedRevision: session.revision,
        patch: { homeworkIntent: 'none' },
      });
      const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
      expect(surface?.lessons.find((lesson) => lesson.id === lessonId)).toMatchObject({
        status,
        consumesCredit: false,
      });
      expect(
        surface?.creditEvents.filter((event) => event.eventType === 'credit_consumed'),
      ).toHaveLength(0);
    },
  );

  it('self-heals the default workspace for baseline-created students without workspace data', async () => {
    const { studentId, userId } = await seedStudentWithoutWorkspace();

    const surface = await addStudentPackage(
      DEFAULT_WORKSPACE_ID,
      studentId,
      { lessons: 3 },
      userId,
    );

    expect(surface.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(surface.creditSummary.remaining).toBe(3);
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      const result = await client.query('SELECT id FROM workspaces WHERE id = $1', [
        DEFAULT_WORKSPACE_ID,
      ]);
      expect(result.rowCount).toBe(1);
    });
  });

  it('derives credit totals from all active events while returning a bounded event list', async () => {
    const { studentId, userId } = await seedStudent();

    for (let index = 0; index < 60; index += 1) {
      await adjustStudentCredits(
        DEFAULT_WORKSPACE_ID,
        studentId,
        { quantityDelta: 1, note: `Adjustment ${index}` },
        userId,
      );
    }

    const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);

    expect(surface?.creditEvents).toHaveLength(50);
    expect(surface?.creditSummary).toMatchObject({
      adjustments: 60,
      remaining: 60,
      isLow: false,
    });
  });

  it('honors stored reminder opt-outs', async () => {
    const { studentId, userId } = await seedStudent();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `
        INSERT INTO student_reminder_preferences (
          student_id,
          workspace_id,
          preferred_channel,
          low_balance_threshold,
          enable_upcoming_lesson,
          enable_low_balance,
          enable_payment_followup,
          updated_by
        )
        VALUES ($1, $2, 'email', 2, FALSE, TRUE, FALSE, $3)
        `,
        [studentId, DEFAULT_WORKSPACE_ID, userId],
      );
    });

    const surface = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);

    expect(surface?.reminders).toHaveLength(1);
    expect(surface?.reminders[0]).toMatchObject({
      type: 'low_balance',
      channel: 'email',
    });
  });

  it('hides lesson follow-up reminders by lesson key and only exposes the latest hidden reminder for undo', async () => {
    const { studentId, userId } = await seedStudent();
    const firstLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      title: 'First follow-up',
    });
    const secondLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-02T10:00:00.000Z',
      title: 'Second follow-up',
    });

    const hiddenOnce = await hideStudentLessonFollowupReminder(
      DEFAULT_WORKSPACE_ID,
      studentId,
      firstLessonId,
      userId,
    );
    expect(
      hiddenOnce.reminders.some(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === firstLessonId,
      ),
    ).toBe(false);
    expect(hiddenOnce.latestHiddenReminder).toMatchObject({
      type: 'lesson_followup',
      lessonId: firstLessonId,
      lessonSummary: {
        lessonId: firstLessonId,
        title: 'First follow-up',
      },
    });

    const hiddenTwice = await hideStudentLessonFollowupReminder(
      DEFAULT_WORKSPACE_ID,
      studentId,
      secondLessonId,
      userId,
    );
    expect(hiddenTwice.latestHiddenReminder).toMatchObject({
      type: 'lesson_followup',
      lessonId: secondLessonId,
    });

    const reloaded = await getStudentScheduleBillingSurface(DEFAULT_WORKSPACE_ID, studentId);
    expect(
      reloaded?.reminders.some(
        (reminder) =>
          reminder.type === 'lesson_followup' &&
          (reminder.lessonId === firstLessonId || reminder.lessonId === secondLessonId),
      ),
    ).toBe(false);
    expect(reloaded?.latestHiddenReminder?.lessonId).toBe(secondLessonId);

    const undone = await undoLatestHiddenStudentReminder(DEFAULT_WORKSPACE_ID, studentId, userId);
    expect(undone.latestHiddenReminder).toBeNull();
    expect(
      undone.reminders.some(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === secondLessonId,
      ),
    ).toBe(true);
    expect(
      undone.reminders.some(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === firstLessonId,
      ),
    ).toBe(false);
  });

  it('self-heals workspace business settings and updates forecast defaults', async () => {
    const settings = await getBusinessSettings(DEFAULT_WORKSPACE_ID);

    expect(settings).toMatchObject({
      workspaceId: DEFAULT_WORKSPACE_ID,
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 0,
      forecastHorizonDays: 45,
    });

    const updated = await updateBusinessSettings(DEFAULT_WORKSPACE_ID, {
      defaultCurrency: 'EUR',
      defaultLessonRateMinor: 3500,
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 500,
      topUpThreshold: 1,
    });

    expect(updated).toMatchObject({
      defaultCurrency: 'EUR',
      defaultLessonRateMinor: 3500,
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 500,
      topUpThreshold: 1,
    });

    await expect(
      updateBusinessSettings(DEFAULT_WORKSPACE_ID, { defaultLessonRateMinor: 4500 }),
    ).resolves.toMatchObject({
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 500,
    });

    await expect(
      updateBusinessSettings(DEFAULT_WORKSPACE_ID, { timezone: 'UTC+7' }),
    ).resolves.toMatchObject({
      timezone: 'Asia/Bangkok',
    });
    await expect(
      updateBusinessSettings(DEFAULT_WORKSPACE_ID, { timezone: 'Not/A_Timezone' }),
    ).rejects.toThrow('Invalid timezone');
  });

  it('aggregates active-student business schedule, reminders, alerts, and payments', async () => {
    const { studentId: alexId } = await seedStudent();
    const beaId = await seedAdditionalStudent('Bea');
    const archivedId = await seedAdditionalStudent('Archived', true);
    await insertBusinessLesson({
      studentId: alexId,
      startsAt: '2026-05-08T10:00:00.000Z',
      consumesCredit: true,
    });
    await insertBusinessLesson({
      studentId: archivedId,
      startsAt: '2026-05-08T12:00:00.000Z',
    });
    await insertBusinessCreditEvent(alexId, 3);
    await insertBusinessCreditEvent(beaId, -1);
    await insertBusinessPayment({
      studentId: alexId,
      amountMinor: 12000,
      currency: 'USD',
      receivedAt: '2026-05-07',
    });
    await insertBusinessPayment({
      studentId: beaId,
      amountMinor: 5000,
      currency: 'EUR',
      receivedAt: '2026-05-08',
    });
    await updateBusinessSettings(DEFAULT_WORKSPACE_ID, { topUpThreshold: 4 });

    const surface = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID, {
      from: '2026-05-07',
      to: '2026-05-09',
    });

    expect(surface.lessons.map((lesson) => lesson.studentName)).toEqual(['Alex']);
    expect(surface.recentPayments.map((payment) => payment.currency)).toEqual(['EUR', 'USD']);
    expect(surface.creditAlerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studentId: beaId,
          severity: 'urgent',
          remainingCredits: -1,
        }),
        expect.objectContaining({
          studentId: alexId,
          lowBalanceThreshold: 4,
          remainingCredits: 3,
        }),
      ]),
    );
    expect(surface.reminders.map((reminder) => reminder.studentName)).toContain('Bea');
    expect(surface.reminders.map((reminder) => reminder.studentName)).toContain('Alex');
  });

  it('includes overdue lesson homework follow-ups in the business reminder queue outside the selected date range', async () => {
    const { studentId } = await seedStudent();
    const lessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      consumesCredit: true,
    });

    const surface = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID);

    expect(surface.lessons.some((lesson) => lesson.id === lessonId)).toBe(false);

    expect(
      surface.reminders.find(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === lessonId,
      ),
    ).toMatchObject({
      studentId,
      studentName: 'Alex',
      actionIntent: 'complete_lesson_and_start_assignment',
      lessonStatus: 'scheduled',
      lessonConsumesCredit: true,
    });

    const jobId = await insertSucceededHomeworkJob({ studentId, lessonId });
    await insertFailedHomeworkJob({ studentId, lessonId });
    const surfaceAfterPublish = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID);

    expect(
      surfaceAfterPublish.reminders.some(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === lessonId,
      ),
    ).toBe(false);
    expect(jobId).toBeTruthy();
  });

  it('shares hidden lesson follow-up reminders with the business reminder queue', async () => {
    const { studentId, userId } = await seedStudent();
    const lessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      title: 'Shared hidden follow-up',
    });

    await hideStudentLessonFollowupReminder(DEFAULT_WORKSPACE_ID, studentId, lessonId, userId);
    const surface = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID);

    expect(
      surface.reminders.some(
        (reminder) => reminder.type === 'lesson_followup' && reminder.lessonId === lessonId,
      ),
    ).toBe(false);
    expect(surface.latestHiddenReminder).toMatchObject({
      type: 'lesson_followup',
      lessonId,
      studentId,
      lessonSummary: {
        lessonId,
        title: 'Shared hidden follow-up',
      },
    });
  });

  it('caps business follow-up reminders after suppressing already published overdue lessons', async () => {
    const { studentId } = await seedStudent();
    const overdueUnpublishedLessonId = await insertBusinessLesson({
      studentId,
      startsAt: '2000-01-01T10:00:00.000Z',
      consumesCredit: true,
    });

    for (let index = 0; index < 101; index += 1) {
      const publishedLessonId = await insertBusinessLesson({
        studentId,
        startsAt: `2001-01-${String((index % 28) + 1).padStart(2, '0')}T10:00:00.000Z`,
        consumesCredit: true,
      });
      await insertSucceededHomeworkJob({ studentId, lessonId: publishedLessonId });
    }

    const surface = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID);

    expect(
      surface.reminders.some(
        (reminder) =>
          reminder.type === 'lesson_followup' && reminder.lessonId === overdueUnpublishedLessonId,
      ),
    ).toBe(true);
  });

  it('uses the configured business timezone for schedule day ranges', async () => {
    const { studentId } = await seedStudent();
    await updateBusinessSettings(DEFAULT_WORKSPACE_ID, { timezone: 'Asia/Bangkok' });
    await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-06T18:30:00.000Z',
      consumesCredit: true,
    });

    const surface = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID, {
      from: '2026-05-07',
      to: '2026-05-07',
    });

    expect(surface.lessons).toHaveLength(1);
    expect(surface.lessons[0]).toMatchObject({
      studentId,
      startsAt: '2026-05-06T18:30:00.000Z',
    });
  });

  it('normalizes legacy offset timezone settings before reading schedule surfaces', async () => {
    const { studentId } = await seedStudent();
    await withPgClientSessionContext({ rlsBypass: true }, async (client) => {
      await client.query(
        `
        INSERT INTO workspace_business_settings (workspace_id, timezone)
        VALUES ($1, 'UTC+7')
        ON CONFLICT (workspace_id) DO UPDATE
        SET timezone = EXCLUDED.timezone
        `,
        [DEFAULT_WORKSPACE_ID],
      );
    });
    await insertBusinessLesson({
      studentId,
      startsAt: '2026-05-06T18:30:00.000Z',
      consumesCredit: true,
    });

    const surface = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID, {
      from: '2026-05-07',
      to: '2026-05-07',
    });

    expect(surface.settings.timezone).toBe('Asia/Bangkok');
    expect(surface.lessons).toHaveLength(1);
  });

  it('computes business stats from recorded payments, lesson values, workload, and excluded currencies', async () => {
    const { studentId: alexId } = await seedStudent();
    const beaId = await seedAdditionalStudent('Bea');
    const archivedId = await seedAdditionalStudent('Archived', true);
    await updateBusinessSettings(DEFAULT_WORKSPACE_ID, {
      defaultCurrency: 'USD',
      defaultLessonRateMinor: 4000,
      noShowRateBasisPoints: 1000,
      cancellationRateBasisPoints: 500,
    });
    await insertBusinessLesson({
      studentId: alexId,
      startsAt: '2026-05-03T10:00:00.000Z',
      status: 'completed',
      consumesCredit: true,
      durationMinutes: 75,
    });
    await insertBusinessLesson({
      studentId: alexId,
      startsAt: '2026-05-04T10:00:00.000Z',
      status: 'no_show',
    });
    await insertBusinessLesson({
      studentId: archivedId,
      startsAt: '2026-05-05T10:00:00.000Z',
      status: 'completed',
      consumesCredit: true,
    });
    await insertBusinessLesson({
      studentId: beaId,
      startsAt: addDays(3),
      status: 'scheduled',
      durationMinutes: 45,
      consumesCredit: false,
    });
    await insertBusinessLesson({
      studentId: alexId,
      startsAt: addDays(4),
      status: 'scheduled',
      durationMinutes: 90,
      consumesCredit: true,
    });
    await insertBusinessLesson({
      studentId: beaId,
      startsAt: '2026-05-06T10:00:00.000Z',
      status: 'completed',
      consumesCredit: false,
      durationMinutes: 30,
    });
    await insertBusinessPayment({
      studentId: alexId,
      amountMinor: 12000,
      currency: 'USD',
      receivedAt: '2026-05-02',
    });
    await insertBusinessPayment({
      studentId: beaId,
      amountMinor: 5000,
      currency: 'EUR',
      receivedAt: '2026-05-02',
    });

    const stats = await getBusinessStatsSurface(DEFAULT_WORKSPACE_ID, { month: '2026-05' });

    expect(stats.collectedMinor).toBe(12000);
    expect(stats.earnedMinor).toBe(4000);
    expect(stats.completedLessons).toBe(2);
    expect(stats.taughtMinutes).toBe(105);
    expect(stats.noShowLessons).toBe(1);
    expect(stats.scheduledGrossMinor).toBe(4000);
    expect(stats.scheduledLessons).toBe(2);
    expect(stats.scheduledMinutes).toBe(135);
    expect(stats.riskAdjustmentMinor).toBe(600);
    expect(stats.forecastMinor).toBe(3400);
    expect(stats.excludedCurrencies).toEqual([
      { currency: 'EUR', amountMinor: 5000, paymentCount: 1 },
    ]);
  });

  it('keeps monthly payment history through archive and restore without mixing currencies or workspaces', async () => {
    const { studentId } = await seedStudent();
    const foreign = await seedWorkspaceTutor('foreign');
    const foreignStudentId = await seedStudentInWorkspace(foreign.workspaceId, 'Foreign');
    await updateBusinessSettings(DEFAULT_WORKSPACE_ID, { defaultCurrency: 'USD' });
    for (const payment of [
      { amountMinor: 12000, currency: 'USD', receivedAt: '2026-05-01' },
      { amountMinor: 5000, currency: 'EUR', receivedAt: '2026-05-31' },
      { amountMinor: 900, currency: 'USD', receivedAt: '2026-04-30' },
      { amountMinor: 900, currency: 'EUR', receivedAt: '2026-06-01' },
      { amountMinor: 900, currency: 'USD', receivedAt: '2026-05-02', voidedAt: '2026-05-03' },
      { amountMinor: 900, currency: 'EUR', receivedAt: '2026-05-02', voidedAt: '2026-05-03' },
    ]) {
      await insertBusinessPayment({ studentId, ...payment });
    }
    for (const currency of ['USD', 'EUR']) {
      await insertBusinessPayment({
        studentId: foreignStudentId,
        workspaceId: foreign.workspaceId,
        amountMinor: 77700,
        currency,
        receivedAt: '2026-05-02',
      });
    }
    const expectPaymentHistory = async () => {
      const stats = await getBusinessStatsSurface(DEFAULT_WORKSPACE_ID, { month: '2026-05' });
      expect(stats.collectedMinor).toBe(12000);
      expect(stats.excludedCurrencies).toEqual([
        { currency: 'EUR', amountMinor: 5000, paymentCount: 1 },
      ]);
    };
    await expectPaymentHistory();
    expect(
      await archiveStudent({ id: studentId, workspaceId: DEFAULT_WORKSPACE_ID }),
    ).not.toBeNull();
    await expectPaymentHistory();
    const schedule = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID);
    expect(schedule.reminders.some((reminder) => reminder.studentId === studentId)).toBe(false);
    expect(await restoreStudent(studentId, { workspaceId: DEFAULT_WORKSPACE_ID })).not.toBeNull();
    await expectPaymentHistory();
  });

  it.each([-1, 0, 1])(
    'offers an optional top-up discussion for a balance of %i without demanding payment',
    async (remaining) => {
      const { studentId } = await seedStudent();
      if (remaining !== 0) await insertBusinessCreditEvent(studentId, remaining);
      const surface = await getBusinessScheduleSurface(DEFAULT_WORKSPACE_ID);
      const reminder = surface.reminders.find(
        (item) =>
          item.studentId === studentId && ['payment_followup', 'low_balance'].includes(item.type),
      );
      expect(reminder).toMatchObject({
        remainingCredits: remaining,
        copyText: `Hi Alex, your lesson balance is ${remaining} credit${Math.abs(remaining) === 1 ? '' : 's'}. Would you like to discuss a top-up?`,
      });
    },
  );

  it('uses the configured business timezone for monthly lesson stats', async () => {
    const { studentId } = await seedStudent();
    await updateBusinessSettings(DEFAULT_WORKSPACE_ID, {
      defaultLessonRateMinor: 4000,
      timezone: 'Asia/Bangkok',
    });
    await insertBusinessLesson({
      studentId,
      startsAt: '2026-04-30T18:30:00.000Z',
      status: 'completed',
      consumesCredit: true,
      durationMinutes: 60,
    });

    const stats = await getBusinessStatsSurface(DEFAULT_WORKSPACE_ID, { month: '2026-05' });

    expect(stats.completedLessons).toBe(1);
    expect(stats.earnedMinor).toBe(4000);
    expect(stats.taughtMinutes).toBe(60);
  });

  it('returns planning boundaries as configured business-timezone dates', async () => {
    vi.setSystemTime(new Date('2026-05-07T23:30:00.000Z'));
    await updateBusinessSettings(DEFAULT_WORKSPACE_ID, {
      timezone: 'Asia/Bangkok',
      forecastHorizonDays: 45,
    });

    const stats = await getBusinessStatsSurface(DEFAULT_WORKSPACE_ID, { month: '2026-05' });

    expect(stats.forecastFrom).toBe('2026-05-08');
    expect(stats.forecastTo).toBe('2026-06-22');
  });
});

function addDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}
