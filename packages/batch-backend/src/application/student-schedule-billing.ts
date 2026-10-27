import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import type {
  AddStudentPackageRequest,
  RecordStudentPaymentRequest,
  StudentCreditEventDto,
  StudentCreditSummaryDto,
  StudentLatestHiddenReminderDto,
  StudentLessonDto,
  StudentLessonHomeworkDto,
  StudentLessonHomeworkStatus,
  StudentLessonPageResponse,
  StudentLessonPlanDto,
  StudentLessonStatus,
  StudentLessonWindow,
  StudentLessonWindowsDto,
  StudentPaymentRecordDto,
  StudentReminderLessonSummaryDto,
  StudentReminderRecommendationDto,
  StudentScheduleBillingSurfaceResponse,
  UpdateStudentLessonPlanRequest,
  UpdateStudentLessonRequest,
} from '@esl-pipeline/contracts';

import { ACTIVE_ASSIGNMENT_SESSION_SQL } from '../domain/assignment-session-repository.js';
import { setStudentActivityActor } from '../domain/student-activity-recording.js';
import { withPgClient } from '../infrastructure/db.js';
import { normalizeBusinessTimezone } from './teacher-business-dashboard.js';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_DURATION_MINUTES = 60;
const AUTOMATIC_UNTITLED_LESSON_TITLE = 'Untitled lesson';
const DEFAULT_LOW_BALANCE_THRESHOLD = 2;

interface StudentContext {
  id: string;
  name: string;
  workspaceId: string | null;
}

interface LessonRow {
  id: string;
  student_id: string;
  workspace_id: string | null;
  starts_at: Date;
  timezone: string;
  duration_minutes: number;
  status: StudentLessonStatus;
  consumes_credit: boolean;
  title: string | null;
  notes: string | null;
  credit_event_id: string | null;
  schedule_origin_history: Record<string, unknown>;
  calendar_lesson_id: string | null;
  calendar_event_url: string | null;
  created_at: Date;
  updated_at: Date;
  homework_status: StudentLessonHomeworkStatus;
  transcript_result_session_id: string | null;
  homework_assignment_session_id: string | null;
  homework_prompt_package_id: string | null;
  homework_draft_id: string | null;
  homework_job_id: string | null;
  homework_memory_entry_id: string | null;
  homework_html_url: string | null;
  homework_updated_at: Date | null;
}

interface CreditEventRow {
  id: string;
  student_id: string;
  workspace_id: string | null;
  event_type: StudentCreditEventDto['eventType'];
  quantity_delta: number;
  source_lesson_id: string | null;
  source_payment_id: string | null;
  note: string | null;
  voided_at: Date | null;
  created_at: Date;
}

interface PaymentRow {
  id: string;
  student_id: string;
  workspace_id: string | null;
  amount_minor: number;
  currency: string;
  method: string | null;
  received_at: Date | string;
  external_url: string | null;
  note: string | null;
  voided_at: Date | null;
  created_at: Date;
}

interface LessonPlanRow {
  student_id: string;
  workspace_id: string | null;
  timezone: string;
  default_duration_minutes: number;
  scheduling_notes: string | null;
  updated_at: Date;
}

interface ReminderPreferences {
  preferredChannel: 'manual' | 'telegram' | 'email';
  lowBalanceThreshold: number;
  enableUpcomingLesson: boolean;
  enableLowBalance: boolean;
  enablePaymentFollowup: boolean;
  hiddenLessonFollowupKeys: Set<string>;
  latestHiddenLessonFollowupKey: string | null;
  latestHiddenLessonFollowupLessonId: string | null;
  latestHiddenLessonFollowupAt: Date | null;
}

export class StudentScheduleBillingError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_request',
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const LESSON_HOMEWORK_SELECT = `
  student_lessons.*,
  calendar_lesson_link.lesson_id AS calendar_lesson_id,
  calendar_lesson_link.event_url AS calendar_event_url,
  CASE
    WHEN lesson_homework_memory.id IS NOT NULL THEN 'memory_ready'
    WHEN lesson_published_job.id IS NOT NULL THEN 'published'
    WHEN lesson_active_job.id IS NOT NULL THEN 'publishing'
    WHEN lesson_assignment_session.draft_id IS NOT NULL THEN 'draft_in_progress'
    WHEN lesson_assignment_session.id IS NOT NULL THEN 'session_in_progress'
    WHEN lesson_transcript_result.id IS NOT NULL THEN 'not_planned'
    ELSE 'not_started'
  END AS homework_status,
  lesson_assignment_session.id AS homework_assignment_session_id,
  CASE WHEN lesson_assignment_session.id IS NULL
    AND lesson_published_job.id IS NULL AND lesson_active_job.id IS NULL
    AND lesson_homework_memory.id IS NULL THEN lesson_transcript_result.id
    ELSE NULL END AS transcript_result_session_id,
  COALESCE(
    lesson_homework_memory.prompt_package_id,
    lesson_published_job.prompt_package_id,
    lesson_active_job.prompt_package_id,
    lesson_assignment_session.prompt_package_id
  ) AS homework_prompt_package_id,
  COALESCE(
    lesson_homework_memory.draft_id,
    lesson_published_job.draft_id,
    lesson_active_job.draft_id,
    lesson_assignment_session.draft_id
  ) AS homework_draft_id,
  COALESCE(lesson_published_job.id, lesson_active_job.id) AS homework_job_id,
  lesson_homework_memory.id AS homework_memory_entry_id,
  lesson_published_job.html_url AS homework_html_url,
  COALESCE(
    lesson_homework_memory.generated_at,
    lesson_published_job.updated_at,
    lesson_active_job.updated_at,
    lesson_assignment_session.updated_at,
    lesson_transcript_result.updated_at
  ) AS homework_updated_at
`;

const LESSON_HOMEWORK_JOINS = `
  LEFT JOIN calendar_lesson_bindings calendar_lesson_link ON calendar_lesson_link.lesson_id = student_lessons.id
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, draft_id, updated_at
    FROM assignment_sessions
    WHERE lesson_id = student_lessons.id
      AND ${ACTIVE_ASSIGNMENT_SESSION_SQL}
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  ) lesson_assignment_session ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, updated_at
    FROM assignment_sessions
    WHERE lesson_id = student_lessons.id
      AND homework_intent = 'none' AND transcript_completed_at IS NOT NULL
    ORDER BY transcript_completed_at DESC, updated_at DESC, id DESC
    LIMIT 1
  ) lesson_transcript_result ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, draft_id, html_url,
           COALESCE(finished_at, updated_at, created_at) AS updated_at
    FROM jobs
    WHERE lesson_id = student_lessons.id
      AND state = 'succeeded'
    ORDER BY COALESCE(finished_at, updated_at, created_at) DESC, id DESC
    LIMIT 1
  ) lesson_published_job ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, draft_id,
           COALESCE(finished_at, updated_at, created_at) AS updated_at
    FROM jobs
    WHERE lesson_id = student_lessons.id
      AND state IN ('queued', 'running', 'awaiting_approval')
    ORDER BY COALESCE(finished_at, updated_at, created_at) DESC, id DESC
    LIMIT 1
  ) lesson_active_job ON TRUE
  LEFT JOIN LATERAL (
    SELECT id, prompt_package_id, draft_id, job_id, generated_at
    FROM homework_memory_entries
    WHERE lesson_id = student_lessons.id
      AND status = 'ready'
    ORDER BY generated_at DESC, created_at DESC, id DESC
    LIMIT 1
  ) lesson_homework_memory ON TRUE
`;

export async function getStudentScheduleBillingSurface(
  workspaceId: string,
  studentId: string,
): Promise<StudentScheduleBillingSurfaceResponse | null> {
  return withPgClient(async (client) => {
    const context = await getAuthorizedStudentContext(client, workspaceId, studentId);
    if (!context) return null;
    return getSurfaceForContext(client, context);
  });
}

export async function getStudentLesson(
  workspaceId: string,
  studentId: string,
  lessonId: string,
): Promise<StudentLessonDto | null> {
  return withPgClient(async (client) => {
    const context = await getAuthorizedStudentContext(client, workspaceId, studentId);
    if (!context) return null;
    const result = await client.query<LessonRow>(
      `SELECT ${LESSON_HOMEWORK_SELECT} FROM student_lessons
       ${LESSON_HOMEWORK_JOINS}
       WHERE student_id = $1 AND ${workspacePredicate('workspace_id', '$2', '$3')}
         AND student_lessons.id = $4::uuid AND schedule_hidden_at IS NULL`,
      [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID, lessonId],
    );
    return result.rows[0] ? mapLesson(result.rows[0]) : null;
  });
}

const lessonCursorSchema = z
  .object({
    studentId: z.string(),
    workspaceId: z.string(),
    window: z.enum(['recent', 'upcoming']),
    timezone: z.string(),
    date: z.iso.date(),
    startsAt: z.iso.datetime(),
    id: z.string().uuid(),
  })
  .strict();
type LessonCursor = z.infer<typeof lessonCursorSchema>;

export async function getStudentLessonPage(
  workspaceId: string,
  studentId: string,
  window: StudentLessonWindow,
  cursor: string,
): Promise<StudentLessonPageResponse | null> {
  return withPgClient(async (client) => {
    const context = await getAuthorizedStudentContext(client, workspaceId, studentId);
    if (!context) return null;
    let decoded: LessonCursor;
    try {
      if (cursor.length > 2048) throw new Error('Oversized cursor');
      decoded = lessonCursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
    } catch {
      throw new StudentScheduleBillingError('invalid_request', 400, 'Invalid lesson cursor');
    }
    const timezone = await getScheduleTimezone(client, context);
    if (
      decoded.studentId !== studentId ||
      decoded.workspaceId !== workspaceId ||
      decoded.window !== window ||
      decoded.timezone !== timezone
    ) {
      throw new StudentScheduleBillingError(
        'invalid_request',
        400,
        'Lesson window changed. Refresh lessons.',
      );
    }
    return readLessonPage(client, context, { timezone, date: decoded.date }, window, 10, decoded);
  });
}

async function getScheduleTimezone(client: PoolClient, context: StudentContext): Promise<string> {
  const result = await client.query<{ timezone: string }>(
    'SELECT timezone FROM workspace_business_settings WHERE workspace_id = $1',
    [context.workspaceId],
  );
  return normalizeBusinessTimezone(result.rows[0]?.timezone ?? DEFAULT_TIMEZONE);
}

async function getLessonWindows(
  client: PoolClient,
  context: StudentContext,
): Promise<StudentLessonWindowsDto> {
  const timezone = await getScheduleTimezone(client, context);
  const result = await client.query<{ date: string }>(
    "SELECT to_char($1::timestamptz AT TIME ZONE $2, 'YYYY-MM-DD') AS date",
    [new Date(), timezone],
  );
  const date = result.rows[0]?.date;
  if (!date) throw new Error('Lesson date unavailable');
  const boundary = { timezone, date };
  const today = await client.query<LessonRow>(
    `SELECT ${LESSON_HOMEWORK_SELECT} FROM student_lessons ${LESSON_HOMEWORK_JOINS}
     WHERE student_id = $1 AND ${workspacePredicate('workspace_id', '$2', '$3')}
       AND schedule_hidden_at IS NULL
       AND starts_at >= ($4::date::timestamp AT TIME ZONE $5)
       AND starts_at < (($4::date + 1)::timestamp AT TIME ZONE $5)
     ORDER BY starts_at ASC, id ASC`,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID, boundary.date, timezone],
  );
  return {
    ...boundary,
    today: today.rows.map(mapLesson),
    recent: await readLessonPage(client, context, boundary, 'recent', 10),
    upcoming: await readLessonPage(client, context, boundary, 'upcoming', 3),
  };
}

async function readLessonPage(
  client: PoolClient,
  context: StudentContext,
  boundary: { timezone: string; date: string },
  window: StudentLessonWindow,
  limit: number,
  cursor?: LessonCursor,
): Promise<StudentLessonPageResponse> {
  const recent = window === 'recent';
  const order = recent ? 'DESC' : 'ASC';
  const result = await client.query<LessonRow & { paging_starts_at: string }>(
    `SELECT ${LESSON_HOMEWORK_SELECT},
       to_char(starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS paging_starts_at
     FROM student_lessons ${LESSON_HOMEWORK_JOINS}
     WHERE student_id = $1 AND ${workspacePredicate('workspace_id', '$2', '$3')}
       AND schedule_hidden_at IS NULL
       AND starts_at ${recent ? '< ($4::date::timestamp' : '>= (($4::date + 1)::timestamp'} AT TIME ZONE $5)
       AND ($6::timestamptz IS NULL OR (starts_at, student_lessons.id) ${recent ? '<' : '>'} ($6::timestamptz, $7::uuid))
     ORDER BY starts_at ${order}, id ${order}
     LIMIT $8`,
    [
      context.id,
      context.workspaceId,
      DEFAULT_WORKSPACE_ID,
      boundary.date,
      boundary.timezone,
      cursor?.startsAt ?? null,
      cursor?.id ?? null,
      limit + 1,
    ],
  );
  const rows = result.rows.slice(0, limit);
  const last = rows.at(-1);
  return {
    items: rows.map(mapLesson),
    nextCursor:
      result.rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              ...boundary,
              studentId: context.id,
              workspaceId: context.workspaceId ?? DEFAULT_WORKSPACE_ID,
              window,
              startsAt: last.paging_starts_at,
              id: last.id,
            } satisfies LessonCursor),
          ).toString('base64url')
        : null,
  };
}

export async function hideStudentLessonFollowupReminder(
  workspaceId: string,
  studentId: string,
  lessonId: string,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    await setStudentActivityActor(client, actorUserId);
    const context = await requireAuthorizedStudentContext(client, workspaceId, studentId);
    const lesson = await getLessonRow(client, context, lessonId);
    if (!lesson) {
      throw new StudentScheduleBillingError('not_found', 404, 'Lesson not found');
    }
    await upsertReminderSuppression(client, context, {
      suppressionKey: getLessonFollowupSuppressionKey(context, lesson.id),
      lessonId: lesson.id,
      actorUserId: actorUserId ?? null,
    });
    return getSurfaceForContext(client, context);
  });
}

export async function undoLatestHiddenStudentReminder(
  workspaceId: string,
  studentId: string,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    await setStudentActivityActor(client, actorUserId);
    const context = await requireAuthorizedStudentContext(client, workspaceId, studentId);
    const prefs = await getReminderPreferences(client, context);
    if (!prefs.latestHiddenLessonFollowupKey) {
      return getSurfaceForContext(client, context);
    }
    await client.query(
      `
      UPDATE student_reminder_preferences
      SET hidden_lesson_followup_keys = array_remove(hidden_lesson_followup_keys, $2),
          latest_hidden_lesson_followup_key = NULL,
          latest_hidden_lesson_followup_lesson_id = NULL,
          latest_hidden_lesson_followup_at = NULL,
          updated_by = $3,
          updated_at = NOW()
      WHERE student_id = $1
        AND ${workspacePredicate('workspace_id', '$4', '$5')}
      `,
      [
        context.id,
        prefs.latestHiddenLessonFollowupKey,
        actorUserId ?? null,
        context.workspaceId,
        DEFAULT_WORKSPACE_ID,
      ],
    );
    return getSurfaceForContext(client, context);
  });
}

export async function updateStudentLessonPlan(
  workspaceId: string,
  studentId: string,
  params: UpdateStudentLessonPlanRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    await setStudentActivityActor(client, actorUserId);
    const context = await requireAuthorizedStudentContext(client, workspaceId, studentId);
    const result = await client.query(
      `
      INSERT INTO student_lesson_plans (
        student_id,
        workspace_id,
        timezone,
        default_duration_minutes,
        scheduling_notes,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (student_id) DO UPDATE
      SET
        workspace_id = EXCLUDED.workspace_id,
        timezone = EXCLUDED.timezone,
        default_duration_minutes = EXCLUDED.default_duration_minutes,
        scheduling_notes = EXCLUDED.scheduling_notes,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      WHERE ${workspacePredicate('student_lesson_plans.workspace_id', '$7', '$8')}
      RETURNING student_id
      `,
      [
        studentId,
        context.workspaceId,
        params.timezone ?? DEFAULT_TIMEZONE,
        params.defaultDurationMinutes ?? DEFAULT_DURATION_MINUTES,
        params.schedulingNotes ?? null,
        actorUserId ?? null,
        context.workspaceId,
        DEFAULT_WORKSPACE_ID,
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new StudentScheduleBillingError('not_found', 404, 'Lesson plan not found');
    }
    return getSurfaceForContext(client, context);
  });
}

export async function completeElapsedScheduledLessonForHomework(
  workspaceId: string,
  studentId: string,
  lessonId: string,
  actorUserId?: string | null,
): Promise<boolean> {
  return withPgTransaction(async (client) => {
    await setStudentActivityActor(client, actorUserId);
    const context = await requireAuthorizedStudentContext(client, workspaceId, studentId);
    // Read status only after taking the shared lesson lock: a competing completion or
    // cancellation must not be overwritten using the pre-lock scheduled state.
    await client.query(
      'SELECT id FROM student_lessons WHERE id = $1 AND student_id = $2 FOR UPDATE',
      [lessonId, context.id],
    );
    const existing = await getLessonRow(client, context, lessonId);
    if (!existing || existing.status !== 'scheduled' || !isLessonHomeworkFollowUpDue(existing)) {
      return false;
    }

    await client.query(
      `
      UPDATE student_lessons
      SET
        status = 'completed',
        consumes_credit = true,
        updated_by = $3,
        completed_by = CASE
          WHEN status <> 'completed' THEN $3
          ELSE completed_by
        END,
        updated_at = NOW()
      WHERE id = $1
        AND student_id = $2
      `,
      [lessonId, context.id, actorUserId ?? null],
    );
    await reconcileLessonCreditEvent(client, lessonId, actorUserId ?? null);
    return true;
  });
}

export async function applyGeneratedLessonTitleIfPlaceholder(params: {
  studentId: string;
  lessonId: string;
  title: string | null | undefined;
}): Promise<boolean> {
  const title = params.title?.trim();
  if (!title) {
    return false;
  }

  return withPgTransaction(async (client) => {
    await client.query("SELECT set_config('app.student_activity_origin', 'generated_title', true)");
    const context = await requireTrustedStudentContextById(client, params.studentId);
    const result = await client.query(
      `
      UPDATE student_lessons
      SET
        title = $3,
        updated_at = NOW()
      WHERE id = $1
        AND student_id = $2
        AND (
          title IS NULL
          OR btrim(title) = ''
          OR title = $4
        )
      RETURNING id
      `,
      [params.lessonId, context.id, title, AUTOMATIC_UNTITLED_LESSON_TITLE],
    );
    return (result.rowCount ?? 0) > 0;
  });
}

export async function updateStudentLesson(
  workspaceId: string,
  studentId: string,
  lessonId: string,
  params: UpdateStudentLessonRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  if (
    Object.keys(params).some((key) => !['status', 'consumesCredit', 'notes'].includes(key)) ||
    (params.status !== undefined && !['completed', 'no_show'].includes(params.status))
  ) {
    throw new StudentScheduleBillingError(
      'invalid_request',
      400,
      'Edit lesson timing and cancellations in Google Calendar',
    );
  }
  return withPgTransaction(async (client) => {
    await setStudentActivityActor(client, actorUserId);
    const context = await requireAuthorizedStudentContext(client, workspaceId, studentId);
    await client.query(
      'SELECT id FROM student_lessons WHERE id = $1 AND student_id = $2 FOR UPDATE',
      [lessonId, context.id],
    );
    const existing = await getLessonRow(client, context, lessonId);
    if (!existing) {
      throw new StudentScheduleBillingError('not_found', 404, 'Lesson not found');
    }

    const nextStatus = params.status ?? existing.status;
    await client.query(
      `
      UPDATE student_lessons
      SET
        status = $3,
        consumes_credit = $4,
        notes = $5,
        updated_by = $6,
        completed_by = CASE
          WHEN $3 = 'completed' AND status <> 'completed' THEN $6
          WHEN $3 <> 'completed' THEN NULL
          ELSE completed_by
        END,
        updated_at = NOW()
      WHERE id = $1
        AND student_id = $2
      `,
      [
        lessonId,
        studentId,
        nextStatus,
        params.consumesCredit ?? existing.consumes_credit,
        params.notes === undefined ? existing.notes : params.notes,
        actorUserId ?? null,
      ],
    );
    await reconcileLessonCreditEvent(client, lessonId, actorUserId ?? null);
    return getSurfaceForContext(client, context);
  });
}

export async function addStudentPackage(
  workspaceId: string,
  studentId: string,
  params: AddStudentPackageRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    await setStudentActivityActor(client, actorUserId);
    const context = await requireAuthorizedStudentContext(client, workspaceId, studentId);
    let paymentId: string | null = null;
    if (params.payment) {
      paymentId = randomUUID();
      await insertPayment(client, context, paymentId, params.payment, actorUserId ?? null);
    }
    await insertCreditEvent(client, {
      context,
      eventType: 'credit_added',
      quantityDelta: params.lessons,
      sourceLessonId: null,
      sourcePaymentId: paymentId,
      note: params.note ?? null,
      actorUserId: actorUserId ?? null,
    });
    return getSurfaceForContext(client, context);
  });
}

export async function adjustStudentCredits(
  workspaceId: string,
  studentId: string,
  params: { quantityDelta: number; note?: string | null },
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    await setStudentActivityActor(client, actorUserId);
    const context = await requireAuthorizedStudentContext(client, workspaceId, studentId);
    await insertCreditEvent(client, {
      context,
      eventType: 'credit_adjusted',
      quantityDelta: params.quantityDelta,
      sourceLessonId: null,
      sourcePaymentId: null,
      note: params.note ?? null,
      actorUserId: actorUserId ?? null,
    });
    return getSurfaceForContext(client, context);
  });
}

export async function recordStudentPayment(
  workspaceId: string,
  studentId: string,
  params: RecordStudentPaymentRequest,
  actorUserId?: string | null,
): Promise<StudentScheduleBillingSurfaceResponse> {
  return withPgTransaction(async (client) => {
    await setStudentActivityActor(client, actorUserId);
    const context = await requireAuthorizedStudentContext(client, workspaceId, studentId);
    await insertPayment(client, context, randomUUID(), params, actorUserId ?? null);
    return getSurfaceForContext(client, context);
  });
}

async function getSurfaceForContext(
  client: PoolClient,
  context: StudentContext,
): Promise<StudentScheduleBillingSurfaceResponse> {
  const plan = await getLessonPlan(client, context);
  const nextLesson = await getNextLesson(client, context);
  const lessons = await listLessons(client, context);
  const lessonWindows = await getLessonWindows(client, context);
  const creditEvents = await listCreditEvents(client, context);
  const payments = await listPayments(client, context);
  const reminderPrefs = await getReminderPreferences(client, context);
  const elapsedHomeworkFollowups = (
    await listOverdueLessonHomeworkFollowups(client, context)
  ).filter(
    (lesson) =>
      !reminderPrefs.hiddenLessonFollowupKeys.has(
        getLessonFollowupSuppressionKey(context, lesson.id),
      ),
  );
  const creditSummary = await getCreditSummary(client, context, reminderPrefs.lowBalanceThreshold);

  return {
    studentId: context.id,
    workspaceId: context.workspaceId,
    lessonPlan: plan,
    nextLesson: nextLesson ? mapLesson(nextLesson) : null,
    lessons: lessons.map((lesson) => mapLesson(lesson)),
    lessonWindows,
    creditSummary,
    creditEvents: creditEvents.map((event) => mapCreditEvent(event)),
    payments: payments.map((payment) => mapPayment(payment)),
    latestHiddenReminder: await getLatestHiddenReminder(client, context, reminderPrefs),
    reminders: buildReminderRecommendations({
      studentName: context.name,
      nextLesson,
      elapsedHomeworkFollowups,
      creditSummary,
      preferredChannel: reminderPrefs.preferredChannel,
      enableUpcomingLesson: reminderPrefs.enableUpcomingLesson,
      enableLowBalance: reminderPrefs.enableLowBalance,
      enablePaymentFollowup: reminderPrefs.enablePaymentFollowup,
    }),
  };
}

async function getAuthorizedStudentContext(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<StudentContext | null> {
  if (workspaceId === DEFAULT_WORKSPACE_ID) {
    await ensureDefaultWorkspace(client);
  }
  const result = await client.query<{
    id: string;
    student: string;
    workspace_id: string;
  }>(
    `
    SELECT id, student, COALESCE(workspace_id, $3::uuid) AS workspace_id
    FROM students
    WHERE id = $1
      AND archived_at IS NULL
      AND (
        workspace_id = $2::uuid
        OR (workspace_id IS NULL AND $2::uuid = $3::uuid)
      )
    `,
    [studentId, workspaceId, DEFAULT_WORKSPACE_ID],
  );
  const row = result.rows[0];
  return row ? { id: row.id, name: row.student, workspaceId: row.workspace_id } : null;
}

async function requireAuthorizedStudentContext(
  client: PoolClient,
  workspaceId: string,
  studentId: string,
): Promise<StudentContext> {
  const context = await getAuthorizedStudentContext(client, workspaceId, studentId);
  if (!context) {
    throw new StudentScheduleBillingError('not_found', 404, 'Student not found');
  }
  return context;
}

async function requireTrustedStudentContextById(
  client: PoolClient,
  studentId: string,
): Promise<StudentContext> {
  await ensureDefaultWorkspace(client);
  const result = await client.query<{
    id: string;
    student: string;
    workspace_id: string;
  }>(
    `
    SELECT id, student, COALESCE(workspace_id, $2::uuid) AS workspace_id
    FROM students
    WHERE id = $1
      AND archived_at IS NULL
    `,
    [studentId, DEFAULT_WORKSPACE_ID],
  );
  const row = result.rows[0];
  if (!row) {
    throw new StudentScheduleBillingError('not_found', 404, 'Student not found');
  }
  return { id: row.id, name: row.student, workspaceId: row.workspace_id };
}

async function getLessonPlan(
  client: PoolClient,
  context: StudentContext,
): Promise<StudentLessonPlanDto> {
  const result = await client.query<LessonPlanRow>(
    `
    SELECT student_id, workspace_id, timezone, default_duration_minutes,
           scheduling_notes, updated_at
    FROM student_lesson_plans
    WHERE student_id = $1
      AND ${workspacePredicate('workspace_id', '$2', '$3')}
    `,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  const row = result.rows[0];
  return {
    studentId: context.id,
    workspaceId: row?.workspace_id ?? context.workspaceId,
    timezone: row?.timezone ?? DEFAULT_TIMEZONE,
    defaultDurationMinutes: row?.default_duration_minutes ?? DEFAULT_DURATION_MINUTES,
    schedulingNotes: row?.scheduling_notes ?? null,
    updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
  };
}

async function getReminderPreferences(
  client: PoolClient,
  context: StudentContext,
): Promise<ReminderPreferences> {
  const result = await client.query<{
    preferred_channel: 'manual' | 'telegram' | 'email';
    low_balance_threshold: number;
    enable_upcoming_lesson: boolean;
    enable_low_balance: boolean;
    enable_payment_followup: boolean;
    hidden_lesson_followup_keys: string[];
    latest_hidden_lesson_followup_key: string | null;
    latest_hidden_lesson_followup_lesson_id: string | null;
    latest_hidden_lesson_followup_at: Date | null;
  }>(
    `
    SELECT preferred_channel, low_balance_threshold, enable_upcoming_lesson,
           enable_low_balance, enable_payment_followup, hidden_lesson_followup_keys,
           latest_hidden_lesson_followup_key, latest_hidden_lesson_followup_lesson_id,
           latest_hidden_lesson_followup_at
    FROM student_reminder_preferences
    WHERE student_id = $1
      AND ${workspacePredicate('workspace_id', '$2', '$3')}
    `,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return {
    preferredChannel: result.rows[0]?.preferred_channel ?? 'manual',
    lowBalanceThreshold: result.rows[0]?.low_balance_threshold ?? DEFAULT_LOW_BALANCE_THRESHOLD,
    enableUpcomingLesson: result.rows[0]?.enable_upcoming_lesson ?? true,
    enableLowBalance: result.rows[0]?.enable_low_balance ?? true,
    enablePaymentFollowup: result.rows[0]?.enable_payment_followup ?? true,
    hiddenLessonFollowupKeys: new Set(result.rows[0]?.hidden_lesson_followup_keys ?? []),
    latestHiddenLessonFollowupKey: result.rows[0]?.latest_hidden_lesson_followup_key ?? null,
    latestHiddenLessonFollowupLessonId:
      result.rows[0]?.latest_hidden_lesson_followup_lesson_id ?? null,
    latestHiddenLessonFollowupAt: result.rows[0]?.latest_hidden_lesson_followup_at ?? null,
  };
}

async function getCreditSummary(
  client: PoolClient,
  context: StudentContext,
  lowBalanceThreshold: number,
): Promise<StudentCreditSummaryDto> {
  const result = await client.query<{
    purchased: string | number | null;
    consumed: string | number | null;
    adjustments: string | number | null;
    remaining: string | number | null;
  }>(
    `
    SELECT
      COALESCE(SUM(quantity_delta) FILTER (WHERE event_type = 'credit_added'), 0) AS purchased,
      ABS(COALESCE(SUM(quantity_delta) FILTER (WHERE event_type = 'credit_consumed'), 0)) AS consumed,
      COALESCE(SUM(quantity_delta) FILTER (WHERE event_type = 'credit_adjusted'), 0) AS adjustments,
      COALESCE(SUM(quantity_delta), 0) AS remaining
    FROM student_credit_events
    WHERE student_id = $1
      AND ${workspacePredicate('workspace_id', '$2', '$3')}
      AND voided_at IS NULL
    `,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  const row = result.rows[0];
  const purchased = Number(row?.purchased ?? 0);
  const consumed = Number(row?.consumed ?? 0);
  const adjustments = Number(row?.adjustments ?? 0);
  const remaining = Number(row?.remaining ?? 0);
  return {
    purchased,
    consumed,
    adjustments,
    remaining,
    lowBalanceThreshold,
    isLow: remaining <= lowBalanceThreshold,
    isNegative: remaining < 0,
  };
}

async function getNextLesson(
  client: PoolClient,
  context: StudentContext,
): Promise<LessonRow | null> {
  const result = await client.query<LessonRow>(
    `
    SELECT ${LESSON_HOMEWORK_SELECT}
    FROM student_lessons
    ${LESSON_HOMEWORK_JOINS}
    WHERE student_id = $1
      AND ${workspacePredicate('workspace_id', '$2', '$3')}
      AND schedule_hidden_at IS NULL
      AND status = 'scheduled'
      AND starts_at >= NOW()
    ORDER BY starts_at ASC, id ASC
    LIMIT 1
    `,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows[0] ?? null;
}

async function listLessons(client: PoolClient, context: StudentContext): Promise<LessonRow[]> {
  const result = await client.query<LessonRow>(
    `
    SELECT ${LESSON_HOMEWORK_SELECT}
    FROM student_lessons
    ${LESSON_HOMEWORK_JOINS}
    WHERE student_id = $1
      AND ${workspacePredicate('workspace_id', '$2', '$3')}
      AND schedule_hidden_at IS NULL
    ORDER BY starts_at DESC, id DESC
    LIMIT 30
    `,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows;
}

async function listOverdueLessonHomeworkFollowups(
  client: PoolClient,
  context: StudentContext,
): Promise<LessonRow[]> {
  const result = await client.query<LessonRow>(
    `
    SELECT ${LESSON_HOMEWORK_SELECT}
    FROM student_lessons
    ${LESSON_HOMEWORK_JOINS}
    WHERE student_id = $1
      AND ${workspacePredicate('workspace_id', '$2', '$3')}
      AND schedule_hidden_at IS NULL
      AND status IN ('scheduled', 'completed')
      AND starts_at + (duration_minutes * INTERVAL '1 minute') <= NOW()
      AND lesson_homework_memory.id IS NULL
      AND lesson_published_job.id IS NULL
    ORDER BY starts_at DESC, id DESC
    LIMIT 30
    `,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows.filter(isLessonHomeworkFollowUpDue);
}

async function listCreditEvents(
  client: PoolClient,
  context: StudentContext,
): Promise<CreditEventRow[]> {
  const result = await client.query<CreditEventRow>(
    `
    SELECT *
    FROM student_credit_events
    WHERE student_id = $1
      AND ${workspacePredicate('workspace_id', '$2', '$3')}
      AND voided_at IS NULL
    ORDER BY created_at DESC, id DESC
    LIMIT 50
    `,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows;
}

async function listPayments(client: PoolClient, context: StudentContext): Promise<PaymentRow[]> {
  const result = await client.query<PaymentRow>(
    `
    SELECT
      id,
      student_id,
      workspace_id,
      amount_minor,
      currency,
      method,
      received_at::text AS received_at,
      external_url,
      note,
      voided_at,
      created_at
    FROM student_payment_records
    WHERE student_id = $1
      AND ${workspacePredicate('workspace_id', '$2', '$3')}
      AND voided_at IS NULL
    ORDER BY received_at DESC, created_at DESC, id DESC
    LIMIT 20
    `,
    [context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows;
}

async function getLessonRow(
  client: PoolClient,
  context: StudentContext,
  lessonId: string,
): Promise<LessonRow | null> {
  const result = await client.query<LessonRow>(
    `
    SELECT ${LESSON_HOMEWORK_SELECT}
    FROM student_lessons
    ${LESSON_HOMEWORK_JOINS}
    WHERE student_lessons.id = $1
      AND student_lessons.student_id = $2
      AND student_lessons.schedule_hidden_at IS NULL
      AND ${workspacePredicate('student_lessons.workspace_id', '$3', '$4')}
    `,
    [lessonId, context.id, context.workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows[0] ?? null;
}

async function reconcileLessonCreditEvent(
  client: PoolClient,
  lessonId: string,
  actorUserId: string | null,
): Promise<void> {
  const result = await client.query<LessonRow>(
    'SELECT * FROM student_lessons WHERE id = $1 FOR UPDATE',
    [lessonId],
  );
  const lesson = result.rows[0];
  if (!lesson) return;

  const shouldConsume = lesson.status === 'completed' && lesson.consumes_credit;
  if (shouldConsume && !lesson.credit_event_id) {
    const eventId = await insertCreditEvent(client, {
      context: {
        id: lesson.student_id,
        name: '',
        workspaceId: lesson.workspace_id,
      },
      eventType: 'credit_consumed',
      quantityDelta: -1,
      sourceLessonId: lesson.id,
      sourcePaymentId: null,
      note: 'Lesson completed',
      actorUserId,
    });
    await client.query('UPDATE student_lessons SET credit_event_id = $2 WHERE id = $1', [
      lesson.id,
      eventId,
    ]);
  } else if (!shouldConsume && lesson.credit_event_id) {
    await client.query(
      `
      UPDATE student_credit_events
      SET voided_at = COALESCE(voided_at, NOW()),
          voided_by = $2
      WHERE id = $1
      `,
      [lesson.credit_event_id, actorUserId],
    );
    await client.query('UPDATE student_lessons SET credit_event_id = NULL WHERE id = $1', [
      lesson.id,
    ]);
  }
}

async function insertCreditEvent(
  client: PoolClient,
  params: {
    context: StudentContext;
    eventType: StudentCreditEventDto['eventType'];
    quantityDelta: number;
    sourceLessonId: string | null;
    sourcePaymentId: string | null;
    note: string | null;
    actorUserId: string | null;
  },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `
    INSERT INTO student_credit_events (
      id, student_id, workspace_id, event_type, quantity_delta,
      source_lesson_id, source_payment_id, note, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      id,
      params.context.id,
      params.context.workspaceId,
      params.eventType,
      params.quantityDelta,
      params.sourceLessonId,
      params.sourcePaymentId,
      params.note,
      params.actorUserId,
    ],
  );
  return id;
}

async function insertPayment(
  client: PoolClient,
  context: StudentContext,
  id: string,
  params: RecordStudentPaymentRequest,
  actorUserId: string | null,
): Promise<void> {
  await client.query(
    `
    INSERT INTO student_payment_records (
      id, student_id, workspace_id, amount_minor, currency, method,
      received_at, external_url, note, created_by
    )
    VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::date, CURRENT_DATE), $8, $9, $10)
    `,
    [
      id,
      context.id,
      context.workspaceId,
      params.amountMinor,
      params.currency.toUpperCase(),
      params.method ?? null,
      params.receivedAt ?? null,
      params.externalUrl ?? null,
      params.note ?? null,
      actorUserId,
    ],
  );
}

function buildReminderRecommendations(params: {
  studentName: string;
  nextLesson: LessonRow | null;
  elapsedHomeworkFollowups: LessonRow[];
  creditSummary: StudentCreditSummaryDto;
  preferredChannel: 'manual' | 'telegram' | 'email';
  enableUpcomingLesson: boolean;
  enableLowBalance: boolean;
  enablePaymentFollowup: boolean;
}): StudentReminderRecommendationDto[] {
  const recommendations: StudentReminderRecommendationDto[] = [];
  const channel = params.preferredChannel;
  if (params.enableUpcomingLesson && !params.nextLesson) {
    recommendations.push({
      type: 'no_next_lesson',
      channel,
      actionIntent: 'copy_text',
      severity: 'attention',
      title: 'Schedule the next lesson',
      message: 'No upcoming lesson is scheduled.',
      copyText: `Hi ${params.studentName}, let's schedule our next English lesson.`,
    });
  }
  if (params.enableLowBalance && params.creditSummary.isLow) {
    const remaining = params.creditSummary.remaining;
    recommendations.push({
      type: 'low_balance',
      channel,
      actionIntent: 'copy_text',
      severity: remaining < 0 ? 'urgent' : 'attention',
      title: remaining < 0 ? 'Balance is negative' : 'Lesson credits are low',
      message: `${remaining} lesson credit${Math.abs(remaining) === 1 ? '' : 's'} remaining.`,
      copyText:
        remaining < 0
          ? `Hi ${params.studentName}, your lesson balance is currently ${remaining}. Please top up when you can.`
          : `Hi ${params.studentName}, you have ${remaining} lesson credit${remaining === 1 ? '' : 's'} remaining. Would you like to top up?`,
    });
  }
  if (params.enablePaymentFollowup && params.creditSummary.remaining <= 0) {
    recommendations.push({
      type: 'payment_followup',
      channel,
      actionIntent: 'copy_text',
      severity: params.creditSummary.remaining < 0 ? 'urgent' : 'attention',
      title: 'Payment follow-up ready',
      message: 'The student needs new paid lesson credits.',
      copyText: `Hi ${params.studentName}, please send payment for the next lesson package when convenient.`,
    });
  }
  for (const lesson of params.elapsedHomeworkFollowups) {
    recommendations.push({
      type: 'lesson_followup',
      channel: 'manual',
      actionIntent: 'complete_lesson_and_start_assignment',
      lessonId: lesson.id,
      lessonStatus: lesson.status,
      lessonConsumesCredit: lesson.consumes_credit,
      lessonSummary: mapLessonSummary(lesson),
      severity: 'attention',
      title: 'Finish lesson follow-up',
      message: 'The scheduled lesson time has passed and homework is not published yet.',
      copyText: `Complete ${params.studentName}'s lesson record and start the homework assignment.`,
    });
  }
  return recommendations;
}

async function upsertReminderSuppression(
  client: PoolClient,
  context: StudentContext,
  params: {
    suppressionKey: string;
    lessonId: string;
    actorUserId: string | null;
  },
): Promise<void> {
  const result = await client.query(
    `
    INSERT INTO student_reminder_preferences (
      student_id,
      workspace_id,
      hidden_lesson_followup_keys,
      latest_hidden_lesson_followup_key,
      latest_hidden_lesson_followup_lesson_id,
      latest_hidden_lesson_followup_at,
      updated_by
    )
    VALUES ($1, $2, ARRAY[$3]::text[], $3, $4::uuid, NOW(), $5)
    ON CONFLICT (student_id) DO UPDATE
    SET workspace_id = EXCLUDED.workspace_id,
        hidden_lesson_followup_keys = CASE
          WHEN student_reminder_preferences.hidden_lesson_followup_keys @> ARRAY[$3]::text[]
            THEN student_reminder_preferences.hidden_lesson_followup_keys
          ELSE array_append(student_reminder_preferences.hidden_lesson_followup_keys, $3)
        END,
        latest_hidden_lesson_followup_key = $3,
        latest_hidden_lesson_followup_lesson_id = $4::uuid,
        latest_hidden_lesson_followup_at = NOW(),
        updated_by = $5,
        updated_at = NOW()
    WHERE ${workspacePredicate('student_reminder_preferences.workspace_id', '$6', '$7')}
    RETURNING student_id
    `,
    [
      context.id,
      context.workspaceId,
      params.suppressionKey,
      params.lessonId,
      params.actorUserId,
      context.workspaceId,
      DEFAULT_WORKSPACE_ID,
    ],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new StudentScheduleBillingError('not_found', 404, 'Reminder preferences not found');
  }
}

async function getLatestHiddenReminder(
  client: PoolClient,
  context: StudentContext,
  prefs: ReminderPreferences,
): Promise<StudentLatestHiddenReminderDto | null> {
  if (!prefs.latestHiddenLessonFollowupLessonId) return null;
  const lesson = await getLessonRow(client, context, prefs.latestHiddenLessonFollowupLessonId);
  return {
    type: 'lesson_followup',
    lessonId: prefs.latestHiddenLessonFollowupLessonId,
    hiddenAt: prefs.latestHiddenLessonFollowupAt
      ? prefs.latestHiddenLessonFollowupAt.toISOString()
      : null,
    lessonSummary: lesson ? mapLessonSummary(lesson) : null,
  };
}

function getLessonFollowupSuppressionKey(context: StudentContext, lessonId: string): string {
  return [
    context.workspaceId ?? DEFAULT_WORKSPACE_ID,
    context.id,
    lessonId,
    'lesson_followup',
  ].join(':');
}

function workspacePredicate(column: string, workspaceParam: string, defaultParam: string): string {
  return `(
    ${column} = ${workspaceParam}::uuid
    OR (${column} IS NULL AND ${workspaceParam}::uuid = ${defaultParam}::uuid)
  )`;
}

function mapLessonSummary(row: LessonRow): StudentReminderLessonSummaryDto {
  return {
    lessonId: row.id,
    startsAt: row.starts_at ? row.starts_at.toISOString() : null,
    durationMinutes: row.duration_minutes ?? null,
    title: row.title ?? null,
  };
}

async function ensureDefaultWorkspace(client: PoolClient): Promise<void> {
  await client.query(
    `
    INSERT INTO workspaces (id, name)
    VALUES ($1, 'Default workspace')
    ON CONFLICT (id) DO NOTHING
    `,
    [DEFAULT_WORKSPACE_ID],
  );
}

async function withPgTransaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
  return withPgClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

function mapLesson(row: LessonRow): StudentLessonDto {
  return {
    id: row.id,
    studentId: row.student_id,
    workspaceId: row.workspace_id ?? null,
    startsAt: row.starts_at.toISOString(),
    timezone: row.timezone,
    durationMinutes: row.duration_minutes,
    status: row.status,
    consumesCredit: row.consumes_credit,
    title: row.title ?? null,
    notes: row.notes ?? null,
    creditEventId: row.credit_event_id ?? null,
    historicalScheduleOrigin: row.schedule_origin_history ?? {},
    schedulingSource: row.calendar_lesson_id ? 'calendar' : 'unmanaged',
    calendarEventUrl: row.calendar_event_url ?? null,
    homework: mapLessonHomework(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapLessonHomework(row: LessonRow): StudentLessonHomeworkDto {
  return {
    status: row.homework_status ?? 'not_started',
    transcriptResultSessionId: row.transcript_result_session_id ?? null,
    assignmentSessionId: row.homework_assignment_session_id ?? null,
    promptPackageId: row.homework_prompt_package_id ?? null,
    draftId: row.homework_draft_id ?? null,
    jobId: row.homework_job_id ?? null,
    homeworkMemoryEntryId: row.homework_memory_entry_id ?? null,
    htmlUrl: row.homework_html_url ?? null,
    updatedAt: row.homework_updated_at ? row.homework_updated_at.toISOString() : null,
  };
}

function isLessonHomeworkFollowUpDue(lesson: LessonRow): boolean {
  if (!['scheduled', 'completed'].includes(lesson.status)) return false;
  if (['published', 'memory_ready', 'not_planned'].includes(lesson.homework_status)) {
    return false;
  }
  const endsAt = lesson.starts_at.getTime() + lesson.duration_minutes * 60 * 1000;
  return endsAt <= Date.now();
}

function mapCreditEvent(row: CreditEventRow): StudentCreditEventDto {
  return {
    id: row.id,
    studentId: row.student_id,
    workspaceId: row.workspace_id ?? null,
    eventType: row.event_type,
    quantityDelta: row.quantity_delta,
    sourceLessonId: row.source_lesson_id ?? null,
    sourcePaymentId: row.source_payment_id ?? null,
    note: row.note ?? null,
    voidedAt: row.voided_at ? row.voided_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}

function mapPayment(row: PaymentRow): StudentPaymentRecordDto {
  const receivedAt =
    row.received_at instanceof Date
      ? row.received_at.toISOString().slice(0, 10)
      : String(row.received_at);
  return {
    id: row.id,
    studentId: row.student_id,
    workspaceId: row.workspace_id ?? null,
    amountMinor: row.amount_minor,
    currency: row.currency,
    method: row.method ?? null,
    receivedAt,
    externalUrl: row.external_url ?? null,
    note: row.note ?? null,
    voidedAt: row.voided_at ? row.voided_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  };
}
