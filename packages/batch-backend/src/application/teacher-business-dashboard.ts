import type { PoolClient } from 'pg';

import type {
  BusinessCreditAlertDto,
  BusinessLatestHiddenReminderDto,
  BusinessLessonDto,
  BusinessPaymentSummaryDto,
  BusinessReminderDto,
  BusinessScheduleSurfaceResponse,
  BusinessSettingsDto,
  BusinessStatsCurrencyExclusionDto,
  BusinessStatsPipelineItemDto,
  BusinessStatsSurfaceResponse,
  StudentLessonHomeworkDto,
  StudentLessonHomeworkStatus,
  StudentLessonStatus,
  StudentReminderLessonSummaryDto,
  UpdateBusinessSettingsRequest,
} from '@esl-pipeline/contracts';

import { ACTIVE_ASSIGNMENT_SESSION_SQL } from '../domain/assignment-session-repository.js';
import {
  normalizeWorkspaceTimezone,
  postgresWorkspaceTimezone,
} from '../domain/workspace-timezone.js';
import { withPgClient } from '../infrastructure/db.js';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_FORECAST_HORIZON_DAYS = 45;
const DEFAULT_TOP_UP_THRESHOLD = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

interface BusinessSettingsRow {
  workspace_id: string;
  default_currency: string;
  default_lesson_rate_minor: number;
  default_lesson_duration_minutes: number;
  timezone: string;
  forecast_horizon_days: number;
  no_show_rate_basis_points: number;
  cancellation_rate_basis_points: number;
  top_up_threshold: number;
  updated_at: Date;
}

interface BusinessLessonRow {
  id: string;
  student_id: string;
  student_name: string;
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

interface BusinessLessonLocalDateRow extends BusinessLessonRow {
  local_date: string;
}

interface BusinessLessonWithLocalDate {
  lesson: BusinessLessonDto;
  localDate: string;
}

interface StudentCreditStateRow {
  student_id: string;
  student_name: string;
  remaining: string | number | null;
  low_balance_threshold: number | null;
  next_lesson_at: Date | null;
  upcoming_chargeable_lessons: string | number | null;
}

interface PaymentSummaryRow {
  student_id: string;
  student_name: string;
  amount_minor: number;
  currency: string;
  received_at: string;
  method: string | null;
}

interface BusinessReminderSuppressionRow {
  student_id: string;
  student_name: string;
  workspace_id: string | null;
  hidden_lesson_followup_keys: string[];
  latest_hidden_lesson_followup_lesson_id: string | null;
  latest_hidden_lesson_followup_at: Date | null;
}

export class TeacherBusinessDashboardError extends Error {
  constructor(
    readonly code: 'invalid_request',
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const BUSINESS_LESSON_HOMEWORK_SELECT = `
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

const BUSINESS_LESSON_HOMEWORK_JOINS = `
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

export async function getBusinessSettings(workspaceId: string): Promise<BusinessSettingsDto> {
  return withPgClient(async (client) => getBusinessSettingsForWorkspace(client, workspaceId));
}

export async function updateBusinessSettings(
  workspaceId: string,
  params: UpdateBusinessSettingsRequest,
  actorUserId?: string | null,
): Promise<BusinessSettingsDto> {
  return withPgClient(async (client) => {
    const current = await getBusinessSettingsForWorkspace(client, workspaceId);
    const next = {
      defaultCurrency: params.defaultCurrency?.toUpperCase() ?? current.defaultCurrency,
      defaultLessonRateMinor: params.defaultLessonRateMinor ?? current.defaultLessonRateMinor,
      defaultLessonDurationMinutes:
        params.defaultLessonDurationMinutes ?? current.defaultLessonDurationMinutes,
      timezone: normalizeBusinessTimezone(params.timezone ?? current.timezone),
      forecastHorizonDays: params.forecastHorizonDays ?? current.forecastHorizonDays,
      noShowRateBasisPoints: params.noShowRateBasisPoints ?? current.noShowRateBasisPoints,
      cancellationRateBasisPoints:
        params.cancellationRateBasisPoints ?? current.cancellationRateBasisPoints,
      topUpThreshold: params.topUpThreshold ?? current.topUpThreshold,
    };
    validateBusinessTimezone(next.timezone);

    await client.query(
      `
      INSERT INTO workspace_business_settings (
        workspace_id,
        default_currency,
        default_lesson_rate_minor,
        default_lesson_duration_minutes,
        timezone,
        forecast_horizon_days,
        no_show_rate_basis_points,
        cancellation_rate_basis_points,
        top_up_threshold,
        updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (workspace_id) DO UPDATE
      SET
        default_currency = EXCLUDED.default_currency,
        default_lesson_rate_minor = EXCLUDED.default_lesson_rate_minor,
        default_lesson_duration_minutes = EXCLUDED.default_lesson_duration_minutes,
        timezone = EXCLUDED.timezone,
        forecast_horizon_days = EXCLUDED.forecast_horizon_days,
        no_show_rate_basis_points = EXCLUDED.no_show_rate_basis_points,
        cancellation_rate_basis_points = EXCLUDED.cancellation_rate_basis_points,
        top_up_threshold = EXCLUDED.top_up_threshold,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()
      `,
      [
        workspaceId,
        next.defaultCurrency,
        next.defaultLessonRateMinor,
        next.defaultLessonDurationMinutes,
        next.timezone,
        next.forecastHorizonDays,
        next.noShowRateBasisPoints,
        next.cancellationRateBasisPoints,
        next.topUpThreshold,
        actorUserId ?? null,
      ],
    );
    return getBusinessSettingsForWorkspace(client, workspaceId);
  });
}

export async function getBusinessScheduleSurface(
  workspaceId: string,
  params: { from?: string; to?: string } = {},
): Promise<BusinessScheduleSurfaceResponse> {
  return withPgClient(async (client) => {
    const settings = await getBusinessSettingsForWorkspace(client, workspaceId);
    const from = params.from ?? toDateInputInTimeZone(new Date(), settings.timezone);
    const to = params.to ?? addDaysToDateInput(from, 7);
    const range = parseDateRange(from, to, 90);
    const lessonItems = await listBusinessLessons(
      client,
      range.fromDate,
      range.toDate,
      settings.timezone,
      workspaceId,
    );
    const lessons = lessonItems.map((item) => item.lesson);
    const reminderSuppressions = await listBusinessReminderSuppressions(client, workspaceId);
    const hiddenFollowupKeys = new Set(
      reminderSuppressions.flatMap((row) => row.hidden_lesson_followup_keys ?? []),
    );
    const lessonFollowups = (await listOverdueBusinessLessonFollowups(client, workspaceId)).filter(
      (lesson) => !hiddenFollowupKeys.has(getBusinessLessonFollowupSuppressionKey(lesson)),
    );
    const creditStates = await listStudentCreditStates(
      client,
      range.fromInstant,
      range.toExclusiveInstant,
      settings.topUpThreshold,
      workspaceId,
    );
    const recentPayments = await listRecentPayments(client, workspaceId);
    const today = toDateInputInTimeZone(new Date(), settings.timezone);

    return {
      workspaceId,
      from,
      to,
      generatedAt: new Date().toISOString(),
      settings,
      today: lessonItems.filter((item) => item.localDate === today).map((item) => item.lesson),
      lessons,
      reminders: buildBusinessReminders(creditStates, lessonFollowups),
      latestHiddenReminder: await getLatestBusinessHiddenReminder(
        client,
        reminderSuppressions,
        workspaceId,
      ),
      creditAlerts: buildCreditAlerts(creditStates),
      recentPayments,
    };
  });
}

export async function getBusinessStatsSurface(
  workspaceId: string,
  params: { month?: string } = {},
): Promise<BusinessStatsSurfaceResponse> {
  return withPgClient(async (client) => {
    const settings = await getBusinessSettingsForWorkspace(client, workspaceId);
    const month = params.month ?? toDateInputInTimeZone(new Date(), settings.timezone).slice(0, 7);
    const monthRange = parseMonth(month);
    const planningFrom = new Date();
    const planningTo = addDays(planningFrom, settings.forecastHorizonDays);
    const collected = await getCollectedForMonth(
      client,
      monthRange.fromDate,
      monthRange.toExclusiveDate,
      settings.defaultCurrency,
      workspaceId,
    );
    const excludedCurrencies = await getExcludedCurrenciesForMonth(
      client,
      monthRange.fromDate,
      monthRange.toExclusiveDate,
      settings.defaultCurrency,
      workspaceId,
    );
    const lessonStats = await getLessonStatsForMonth(
      client,
      monthRange.fromDate,
      monthRange.toExclusiveDate,
      settings.timezone,
      workspaceId,
    );
    const planningLessons = await listPlanningLessons(
      client,
      planningFrom,
      planningTo,
      workspaceId,
    );
    const creditStates = await listStudentCreditStates(
      client,
      planningFrom,
      planningTo,
      settings.topUpThreshold,
      workspaceId,
    );

    const scheduledChargeableLessons = planningLessons.filter((lesson) => lesson.consumesCredit);
    const scheduledGrossMinor = scheduledChargeableLessons.length * settings.defaultLessonRateMinor;
    const riskRateBasisPoints = Math.min(
      10000,
      settings.noShowRateBasisPoints + settings.cancellationRateBasisPoints,
    );
    const riskAdjustmentMinor = Math.round((scheduledGrossMinor * riskRateBasisPoints) / 10000);
    const forecastMinor = Math.max(0, scheduledGrossMinor - riskAdjustmentMinor);
    const pipeline = buildPipelineItems(creditStates);

    return {
      workspaceId,
      month,
      generatedAt: new Date().toISOString(),
      settings,
      currency: settings.defaultCurrency,
      collectedMinor: collected,
      earnedMinor: lessonStats.completedChargeableLessons * settings.defaultLessonRateMinor,
      scheduledGrossMinor,
      forecastMinor,
      riskAdjustmentMinor,
      completedLessons: lessonStats.completedLessons,
      taughtMinutes: lessonStats.taughtMinutes,
      scheduledLessons: planningLessons.length,
      scheduledMinutes: planningLessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
      noShowLessons: lessonStats.noShowLessons,
      canceledLessons: lessonStats.canceledLessons,
      forecastFrom: toDateInputInTimeZone(planningFrom, settings.timezone),
      forecastTo: toDateInputInTimeZone(planningTo, settings.timezone),
      excludedCurrencies,
      pipeline,
      risks: pipeline.filter((item) => item.severity === 'urgent'),
    };
  });
}

async function getBusinessSettingsForWorkspace(
  client: PoolClient,
  workspaceId: string,
): Promise<BusinessSettingsDto> {
  if (workspaceId === DEFAULT_WORKSPACE_ID) {
    await ensureDefaultWorkspace(client);
  }
  await client.query(
    `
    INSERT INTO workspace_business_settings (workspace_id)
    VALUES ($1)
    ON CONFLICT (workspace_id) DO NOTHING
    `,
    [workspaceId],
  );
  const result = await client.query<BusinessSettingsRow>(
    `
    SELECT *
    FROM workspace_business_settings
    WHERE workspace_id = $1
    `,
    [workspaceId],
  );
  const row = result.rows[0];
  return {
    workspaceId,
    defaultCurrency: row?.default_currency ?? DEFAULT_CURRENCY,
    defaultLessonRateMinor: row?.default_lesson_rate_minor ?? 0,
    defaultLessonDurationMinutes: row?.default_lesson_duration_minutes ?? DEFAULT_DURATION_MINUTES,
    timezone: normalizeBusinessTimezone(row?.timezone ?? DEFAULT_TIMEZONE),
    forecastHorizonDays: row?.forecast_horizon_days ?? DEFAULT_FORECAST_HORIZON_DAYS,
    noShowRateBasisPoints: row?.no_show_rate_basis_points ?? 0,
    cancellationRateBasisPoints: row?.cancellation_rate_basis_points ?? 0,
    topUpThreshold: row?.top_up_threshold ?? DEFAULT_TOP_UP_THRESHOLD,
    updatedAt: row?.updated_at ? row.updated_at.toISOString() : null,
  };
}

async function listBusinessLessons(
  client: PoolClient,
  fromDate: string,
  toDate: string,
  timezone: string,
  workspaceId: string,
): Promise<BusinessLessonWithLocalDate[]> {
  const result = await client.query<BusinessLessonLocalDateRow>(
    `
    SELECT
      ${BUSINESS_LESSON_HOMEWORK_SELECT},
      students.student AS student_name,
      (student_lessons.starts_at AT TIME ZONE $3)::date::text AS local_date
    FROM student_lessons
    ${BUSINESS_LESSON_HOMEWORK_JOINS}
    JOIN students ON students.id = student_lessons.student_id
    WHERE ${workspacePredicate('student_lessons.workspace_id', '$4', '$5')}
      AND ${workspacePredicate('students.workspace_id', '$4', '$5')}
      AND students.archived_at IS NULL
      AND student_lessons.schedule_hidden_at IS NULL
      AND (student_lessons.starts_at AT TIME ZONE $3)::date >= $1::date
      AND (student_lessons.starts_at AT TIME ZONE $3)::date <= $2::date
    ORDER BY student_lessons.starts_at ASC, student_lessons.id ASC
    `,
    [fromDate, toDate, postgresWorkspaceTimezone(timezone), workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows.map((row) => ({
    lesson: mapBusinessLesson(row),
    localDate: row.local_date,
  }));
}

async function listPlanningLessons(
  client: PoolClient,
  from: Date,
  toExclusive: Date,
  workspaceId: string,
): Promise<BusinessLessonDto[]> {
  const result = await client.query<BusinessLessonRow>(
    `
    SELECT
      ${BUSINESS_LESSON_HOMEWORK_SELECT},
      students.student AS student_name
    FROM student_lessons
    ${BUSINESS_LESSON_HOMEWORK_JOINS}
    JOIN students ON students.id = student_lessons.student_id
    WHERE ${workspacePredicate('student_lessons.workspace_id', '$3', '$4')}
      AND ${workspacePredicate('students.workspace_id', '$3', '$4')}
      AND students.archived_at IS NULL
      AND student_lessons.schedule_hidden_at IS NULL
      AND student_lessons.status = 'scheduled'
      AND student_lessons.starts_at >= $1
      AND student_lessons.starts_at < $2
    ORDER BY student_lessons.starts_at ASC, student_lessons.id ASC
    `,
    [from.toISOString(), toExclusive.toISOString(), workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows.map(mapBusinessLesson);
}

async function listOverdueBusinessLessonFollowups(
  client: PoolClient,
  workspaceId: string,
): Promise<BusinessLessonDto[]> {
  const result = await client.query<BusinessLessonRow>(
    `
    SELECT
      ${BUSINESS_LESSON_HOMEWORK_SELECT},
      students.student AS student_name
    FROM student_lessons
    ${BUSINESS_LESSON_HOMEWORK_JOINS}
    JOIN students ON students.id = student_lessons.student_id
    WHERE ${workspacePredicate('student_lessons.workspace_id', '$1', '$2')}
      AND ${workspacePredicate('students.workspace_id', '$1', '$2')}
      AND students.archived_at IS NULL
      AND student_lessons.schedule_hidden_at IS NULL
      AND student_lessons.status IN ('scheduled', 'completed')
      AND student_lessons.starts_at + (student_lessons.duration_minutes * INTERVAL '1 minute') <= NOW()
      AND lesson_homework_memory.id IS NULL
      AND lesson_published_job.id IS NULL
    ORDER BY student_lessons.starts_at DESC, student_lessons.id DESC
    LIMIT 100
    `,
    [workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows.map(mapBusinessLesson).filter(isBusinessLessonFollowUpDue);
}

async function listStudentCreditStates(
  client: PoolClient,
  from: Date,
  toExclusive: Date,
  topUpThreshold: number,
  workspaceId: string,
): Promise<StudentCreditStateRow[]> {
  const result = await client.query<StudentCreditStateRow>(
    `
    WITH credit_totals AS (
      SELECT
        student_id,
        COALESCE(SUM(quantity_delta), 0) AS remaining
      FROM student_credit_events
      JOIN students credit_students ON credit_students.id = student_credit_events.student_id
      WHERE student_credit_events.voided_at IS NULL
        AND ${workspacePredicate('student_credit_events.workspace_id', '$3', '$5')}
        AND ${workspacePredicate('credit_students.workspace_id', '$3', '$5')}
        AND credit_students.archived_at IS NULL
      GROUP BY student_credit_events.student_id
    ),
    upcoming AS (
      SELECT
        student_id,
        MIN(starts_at) FILTER (WHERE status = 'scheduled' AND starts_at >= NOW()) AS next_lesson_at,
        COUNT(*) FILTER (
          WHERE status = 'scheduled'
            AND consumes_credit = TRUE
            AND starts_at >= $1
            AND starts_at < $2
        ) AS upcoming_chargeable_lessons
      FROM student_lessons
      JOIN students lesson_students ON lesson_students.id = student_lessons.student_id
      WHERE ${workspacePredicate('student_lessons.workspace_id', '$3', '$5')}
        AND ${workspacePredicate('lesson_students.workspace_id', '$3', '$5')}
        AND lesson_students.archived_at IS NULL
        AND student_lessons.schedule_hidden_at IS NULL
      GROUP BY student_lessons.student_id
    )
    SELECT
      students.id AS student_id,
      students.student AS student_name,
      COALESCE(credit_totals.remaining, 0) AS remaining,
      $4::integer AS low_balance_threshold,
      upcoming.next_lesson_at,
      COALESCE(upcoming.upcoming_chargeable_lessons, 0) AS upcoming_chargeable_lessons
    FROM students
    LEFT JOIN credit_totals ON credit_totals.student_id = students.id
    LEFT JOIN upcoming ON upcoming.student_id = students.id
    WHERE ${workspacePredicate('students.workspace_id', '$3', '$5')}
      AND students.archived_at IS NULL
    ORDER BY students.student ASC, students.id ASC
    `,
    [
      from.toISOString(),
      toExclusive.toISOString(),
      workspaceId,
      topUpThreshold,
      DEFAULT_WORKSPACE_ID,
    ],
  );
  return result.rows;
}

async function listRecentPayments(
  client: PoolClient,
  workspaceId: string,
): Promise<BusinessPaymentSummaryDto[]> {
  const result = await client.query<PaymentSummaryRow>(
    `
    SELECT
      student_payment_records.student_id,
      students.student AS student_name,
      student_payment_records.amount_minor,
      student_payment_records.currency,
      student_payment_records.received_at::text AS received_at,
      student_payment_records.method
    FROM student_payment_records
    JOIN students ON students.id = student_payment_records.student_id
    WHERE ${workspacePredicate('student_payment_records.workspace_id', '$1', '$2')}
      AND ${workspacePredicate('students.workspace_id', '$1', '$2')}
      AND students.archived_at IS NULL
      AND student_payment_records.voided_at IS NULL
    ORDER BY student_payment_records.received_at DESC, student_payment_records.created_at DESC
    LIMIT 8
    `,
    [workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows.map((row) => ({
    studentId: row.student_id,
    studentName: row.student_name,
    studentScheduleBillingPath: getStudentScheduleBillingPath(row.student_id),
    amountMinor: row.amount_minor,
    currency: row.currency,
    receivedAt: row.received_at,
    method: row.method ?? null,
  }));
}

async function listBusinessReminderSuppressions(
  client: PoolClient,
  workspaceId: string,
): Promise<BusinessReminderSuppressionRow[]> {
  const result = await client.query<BusinessReminderSuppressionRow>(
    `
    SELECT
      student_reminder_preferences.student_id,
      students.student AS student_name,
      COALESCE(student_reminder_preferences.workspace_id, students.workspace_id, $2::uuid) AS workspace_id,
      student_reminder_preferences.hidden_lesson_followup_keys,
      student_reminder_preferences.latest_hidden_lesson_followup_lesson_id,
      student_reminder_preferences.latest_hidden_lesson_followup_at
    FROM student_reminder_preferences
    JOIN students ON students.id = student_reminder_preferences.student_id
    WHERE ${workspacePredicate('student_reminder_preferences.workspace_id', '$1', '$2')}
      AND ${workspacePredicate('students.workspace_id', '$1', '$2')}
      AND students.archived_at IS NULL
      AND (
        cardinality(student_reminder_preferences.hidden_lesson_followup_keys) > 0
        OR student_reminder_preferences.latest_hidden_lesson_followup_lesson_id IS NOT NULL
      )
    ORDER BY student_reminder_preferences.latest_hidden_lesson_followup_at DESC NULLS LAST
    `,
    [workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows;
}

async function getLatestBusinessHiddenReminder(
  client: PoolClient,
  rows: BusinessReminderSuppressionRow[],
  workspaceId: string,
): Promise<BusinessLatestHiddenReminderDto | null> {
  const latest = rows.find((row) => row.latest_hidden_lesson_followup_lesson_id);
  if (!latest?.latest_hidden_lesson_followup_lesson_id) return null;
  const lesson = await getBusinessLessonRow(
    client,
    latest.latest_hidden_lesson_followup_lesson_id,
    workspaceId,
  );
  return {
    type: 'lesson_followup',
    lessonId: latest.latest_hidden_lesson_followup_lesson_id,
    hiddenAt: latest.latest_hidden_lesson_followup_at
      ? latest.latest_hidden_lesson_followup_at.toISOString()
      : null,
    studentId: latest.student_id,
    studentName: latest.student_name,
    studentScheduleBillingPath: getStudentScheduleBillingPath(latest.student_id),
    lessonSummary: lesson ? mapBusinessLessonSummary(mapBusinessLesson(lesson)) : null,
  };
}

async function getBusinessLessonRow(
  client: PoolClient,
  lessonId: string,
  workspaceId: string,
): Promise<BusinessLessonRow | null> {
  const result = await client.query<BusinessLessonRow>(
    `
    SELECT
      ${BUSINESS_LESSON_HOMEWORK_SELECT},
      students.student AS student_name
    FROM student_lessons
    ${BUSINESS_LESSON_HOMEWORK_JOINS}
    JOIN students ON students.id = student_lessons.student_id
    WHERE student_lessons.id = $1
      AND ${workspacePredicate('student_lessons.workspace_id', '$2', '$3')}
      AND ${workspacePredicate('students.workspace_id', '$2', '$3')}
      AND students.archived_at IS NULL
    `,
    [lessonId, workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows[0] ?? null;
}

async function getCollectedForMonth(
  client: PoolClient,
  fromDate: string,
  toExclusiveDate: string,
  currency: string,
  workspaceId: string,
): Promise<number> {
  const result = await client.query<{ total: string | number | null }>(
    `
    SELECT COALESCE(SUM(student_payment_records.amount_minor), 0) AS total
    FROM student_payment_records
    JOIN students ON students.id = student_payment_records.student_id
    WHERE ${workspacePredicate('student_payment_records.workspace_id', '$4', '$5')}
      AND ${workspacePredicate('students.workspace_id', '$4', '$5')}
      AND student_payment_records.voided_at IS NULL
      AND student_payment_records.currency = $3
      AND student_payment_records.received_at >= $1::date
      AND student_payment_records.received_at < $2::date
    `,
    [fromDate, toExclusiveDate, currency, workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function getExcludedCurrenciesForMonth(
  client: PoolClient,
  fromDate: string,
  toExclusiveDate: string,
  currency: string,
  workspaceId: string,
): Promise<BusinessStatsCurrencyExclusionDto[]> {
  const result = await client.query<{
    currency: string;
    amount_minor: string | number | null;
    payment_count: string | number | null;
  }>(
    `
    SELECT
      student_payment_records.currency,
      COALESCE(SUM(student_payment_records.amount_minor), 0) AS amount_minor,
      COUNT(*) AS payment_count
    FROM student_payment_records
    JOIN students ON students.id = student_payment_records.student_id
    WHERE ${workspacePredicate('student_payment_records.workspace_id', '$4', '$5')}
      AND ${workspacePredicate('students.workspace_id', '$4', '$5')}
      AND student_payment_records.voided_at IS NULL
      AND student_payment_records.currency <> $3
      AND student_payment_records.received_at >= $1::date
      AND student_payment_records.received_at < $2::date
    GROUP BY student_payment_records.currency
    ORDER BY student_payment_records.currency ASC
    `,
    [fromDate, toExclusiveDate, currency, workspaceId, DEFAULT_WORKSPACE_ID],
  );
  return result.rows.map((row) => ({
    currency: row.currency,
    amountMinor: Number(row.amount_minor ?? 0),
    paymentCount: Number(row.payment_count ?? 0),
  }));
}

async function getLessonStatsForMonth(
  client: PoolClient,
  fromDate: string,
  toExclusiveDate: string,
  timezone: string,
  workspaceId: string,
): Promise<{
  completedLessons: number;
  completedChargeableLessons: number;
  taughtMinutes: number;
  noShowLessons: number;
  canceledLessons: number;
}> {
  const result = await client.query<{
    completed_lessons: string | number | null;
    completed_chargeable_lessons: string | number | null;
    taught_minutes: string | number | null;
    no_show_lessons: string | number | null;
    canceled_lessons: string | number | null;
  }>(
    `
    SELECT
      COUNT(*) FILTER (WHERE student_lessons.status = 'completed') AS completed_lessons,
      COUNT(*) FILTER (
        WHERE student_lessons.status = 'completed' AND student_lessons.consumes_credit = TRUE
      ) AS completed_chargeable_lessons,
      COALESCE(SUM(student_lessons.duration_minutes) FILTER (WHERE student_lessons.status = 'completed'), 0) AS taught_minutes,
      COUNT(*) FILTER (WHERE student_lessons.status = 'no_show') AS no_show_lessons,
      COUNT(*) FILTER (WHERE student_lessons.status = 'canceled') AS canceled_lessons
    FROM student_lessons
    JOIN students ON students.id = student_lessons.student_id
    WHERE ${workspacePredicate('student_lessons.workspace_id', '$4', '$5')}
      AND ${workspacePredicate('students.workspace_id', '$4', '$5')}
      AND students.archived_at IS NULL
      AND student_lessons.schedule_hidden_at IS NULL
      AND (student_lessons.starts_at AT TIME ZONE $3)::date >= $1::date
      AND (student_lessons.starts_at AT TIME ZONE $3)::date < $2::date
    `,
    [
      fromDate,
      toExclusiveDate,
      postgresWorkspaceTimezone(timezone),
      workspaceId,
      DEFAULT_WORKSPACE_ID,
    ],
  );
  const row = result.rows[0];
  return {
    completedLessons: Number(row?.completed_lessons ?? 0),
    completedChargeableLessons: Number(row?.completed_chargeable_lessons ?? 0),
    taughtMinutes: Number(row?.taught_minutes ?? 0),
    noShowLessons: Number(row?.no_show_lessons ?? 0),
    canceledLessons: Number(row?.canceled_lessons ?? 0),
  };
}

function buildBusinessReminders(
  states: StudentCreditStateRow[],
  lessonFollowups: BusinessLessonDto[],
): BusinessReminderDto[] {
  const reminders: BusinessReminderDto[] = [];
  for (const lesson of lessonFollowups) {
    reminders.push({
      studentId: lesson.studentId,
      studentName: lesson.studentName,
      studentScheduleBillingPath: lesson.studentScheduleBillingPath,
      lessonId: lesson.id,
      remainingCredits: 0,
      type: 'lesson_followup',
      channel: 'manual',
      actionIntent: 'complete_lesson_and_start_assignment',
      severity: 'attention',
      lessonStatus: lesson.status,
      lessonConsumesCredit: lesson.consumesCredit,
      lessonSummary: mapBusinessLessonSummary(lesson),
      title: 'Finish lesson follow-up',
      message: 'The scheduled lesson time has passed and homework is not published yet.',
      copyText: `Complete ${lesson.studentName}'s lesson record and start the homework assignment.`,
    });
  }
  for (const state of states) {
    const remaining = Number(state.remaining ?? 0);
    const threshold = Number(state.low_balance_threshold ?? DEFAULT_TOP_UP_THRESHOLD);
    if (!state.next_lesson_at) {
      reminders.push({
        studentId: state.student_id,
        studentName: state.student_name,
        studentScheduleBillingPath: getStudentScheduleBillingPath(state.student_id),
        remainingCredits: remaining,
        type: 'no_next_lesson',
        channel: 'manual',
        actionIntent: 'copy_text',
        severity: 'attention',
        title: 'Schedule the next lesson',
        message: 'No upcoming lesson is scheduled.',
        copyText: `Hi ${state.student_name}, let's schedule our next English lesson.`,
      });
    }
    if (remaining <= threshold) {
      reminders.push({
        studentId: state.student_id,
        studentName: state.student_name,
        studentScheduleBillingPath: getStudentScheduleBillingPath(state.student_id),
        remainingCredits: remaining,
        type: remaining <= 0 ? 'payment_followup' : 'low_balance',
        channel: 'manual',
        actionIntent: 'copy_text',
        severity: remaining < 0 ? 'urgent' : 'attention',
        title: remaining < 0 ? 'Balance is negative' : 'Lesson credits are low',
        message: `${remaining} lesson credit${Math.abs(remaining) === 1 ? '' : 's'} remaining.`,
        copyText: `Hi ${state.student_name}, your lesson balance is ${remaining} credit${Math.abs(remaining) === 1 ? '' : 's'}. Would you like to discuss a top-up?`,
      });
    }
  }
  return reminders.sort(
    (left, right) => severityRank(right.severity) - severityRank(left.severity),
  );
}

function buildCreditAlerts(states: StudentCreditStateRow[]): BusinessCreditAlertDto[] {
  return states
    .filter(
      (state) =>
        Number(state.remaining ?? 0) <=
        Number(state.low_balance_threshold ?? DEFAULT_TOP_UP_THRESHOLD),
    )
    .map((state) => {
      const remaining = Number(state.remaining ?? 0);
      return {
        studentId: state.student_id,
        studentName: state.student_name,
        studentScheduleBillingPath: getStudentScheduleBillingPath(state.student_id),
        remainingCredits: remaining,
        lowBalanceThreshold: Number(state.low_balance_threshold ?? DEFAULT_TOP_UP_THRESHOLD),
        severity: remaining < 0 ? 'urgent' : 'attention',
        upcomingChargeableLessons: Number(state.upcoming_chargeable_lessons ?? 0),
      };
    });
}

function buildPipelineItems(states: StudentCreditStateRow[]): BusinessStatsPipelineItemDto[] {
  return states
    .filter((state) => {
      const remaining = Number(state.remaining ?? 0);
      const upcoming = Number(state.upcoming_chargeable_lessons ?? 0);
      const threshold = Number(state.low_balance_threshold ?? DEFAULT_TOP_UP_THRESHOLD);
      return remaining <= threshold || remaining - upcoming <= threshold;
    })
    .map((state) => {
      const remaining = Number(state.remaining ?? 0);
      const upcoming = Number(state.upcoming_chargeable_lessons ?? 0);
      return {
        studentId: state.student_id,
        studentName: state.student_name,
        studentScheduleBillingPath: getStudentScheduleBillingPath(state.student_id),
        remainingCredits: remaining,
        upcomingChargeableLessons: upcoming,
        severity: remaining < 0 || remaining - upcoming < 0 ? 'urgent' : 'attention',
      };
    });
}

function mapBusinessLesson(row: BusinessLessonRow): BusinessLessonDto {
  return {
    id: row.id,
    studentId: row.student_id,
    studentName: row.student_name,
    studentScheduleBillingPath: getStudentScheduleBillingPath(row.student_id),
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
    homework: mapBusinessLessonHomework(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapBusinessLessonHomework(row: BusinessLessonRow): StudentLessonHomeworkDto {
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

function mapBusinessLessonSummary(lesson: BusinessLessonDto): StudentReminderLessonSummaryDto {
  return {
    lessonId: lesson.id,
    startsAt: lesson.startsAt,
    durationMinutes: lesson.durationMinutes,
    title: lesson.title ?? null,
  };
}

function getBusinessLessonFollowupSuppressionKey(lesson: BusinessLessonDto): string {
  return [
    lesson.workspaceId ?? DEFAULT_WORKSPACE_ID,
    lesson.studentId,
    lesson.id,
    'lesson_followup',
  ].join(':');
}

function isBusinessLessonFollowUpDue(lesson: BusinessLessonDto): boolean {
  if (!['scheduled', 'completed'].includes(lesson.status)) return false;
  if (['published', 'memory_ready', 'not_planned'].includes(lesson.homework.status)) {
    return false;
  }
  const endsAt = new Date(lesson.startsAt).getTime() + lesson.durationMinutes * 60 * 1000;
  return endsAt <= Date.now();
}

function workspacePredicate(column: string, workspaceParam: string, defaultParam: string): string {
  return `(
    ${column} = ${workspaceParam}::uuid
    OR (${column} IS NULL AND ${workspaceParam}::uuid = ${defaultParam}::uuid)
  )`;
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

function getStudentScheduleBillingPath(studentId: string): string {
  return `/students/${encodeURIComponent(studentId)}/schedule-billing`;
}

function parseDateRange(
  fromInput: string,
  toInput: string,
  maxDays: number,
): {
  fromDate: string;
  toDate: string;
  fromInstant: Date;
  toExclusiveInstant: Date;
} {
  const fromInstant = parseDateInput(fromInput);
  const toInclusive = parseDateInput(toInput);
  const toExclusiveInstant = addDays(toInclusive, 1);
  if (toExclusiveInstant.getTime() <= fromInstant.getTime()) {
    throw new TeacherBusinessDashboardError('invalid_request', 400, 'Invalid date range');
  }
  if (toExclusiveInstant.getTime() - fromInstant.getTime() > maxDays * DAY_MS) {
    throw new TeacherBusinessDashboardError('invalid_request', 400, 'Date range is too large');
  }
  return {
    fromDate: fromInput,
    toDate: toInput,
    fromInstant,
    toExclusiveInstant,
  };
}

function parseMonth(value: string): { fromDate: string; toExclusiveDate: string } {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new TeacherBusinessDashboardError('invalid_request', 400, 'Invalid month');
  }
  const [yearText, monthText] = value.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new TeacherBusinessDashboardError('invalid_request', 400, 'Invalid month');
  }
  const nextMonth = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    fromDate: `${value}-01`,
    toExclusiveDate: toDateInput(nextMonth),
  };
}

function parseDateInput(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TeacherBusinessDashboardError('invalid_request', 400, 'Invalid date');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new TeacherBusinessDashboardError('invalid_request', 400, 'Invalid date');
  }
  return date;
}

function toDateInput(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toDateInputInTimeZone(value: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const partMap = new Map(parts.map((part) => [part.type, part.value]));
  return `${partMap.get('year')}-${partMap.get('month')}-${partMap.get('day')}`;
}

function addDaysToDateInput(value: string, days: number): string {
  return toDateInput(addDays(parseDateInput(value), days));
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS);
}

function validateBusinessTimezone(timezone: string): void {
  normalizeBusinessTimezone(timezone);
}

export function normalizeBusinessTimezone(timezone: string): string {
  try {
    return normalizeWorkspaceTimezone(timezone);
  } catch {
    throw new TeacherBusinessDashboardError('invalid_request', 400, 'Invalid timezone');
  }
}

function severityRank(value: 'info' | 'attention' | 'urgent'): number {
  return value === 'urgent' ? 2 : value === 'attention' ? 1 : 0;
}
