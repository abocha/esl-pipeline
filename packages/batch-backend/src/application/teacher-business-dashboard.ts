import type { PoolClient } from 'pg';

import type {
  BusinessCreditAlertDto,
  BusinessLessonDto,
  BusinessPaymentSummaryDto,
  BusinessReminderDto,
  BusinessScheduleSurfaceResponse,
  BusinessSettingsDto,
  BusinessStatsCurrencyExclusionDto,
  BusinessStatsPipelineItemDto,
  BusinessStatsSurfaceResponse,
  StudentLessonStatus,
  UpdateBusinessSettingsRequest,
} from '@esl-pipeline/contracts';

import { withPgClient } from '../infrastructure/db.js';
import { materializeWorkspaceLessonRecurrencesWithClient } from './student-schedule-billing.js';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_CURRENCY = 'USD';
const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_TIMEZONE = 'UTC';
const DEFAULT_FORECAST_HORIZON_DAYS = 45;
const DEFAULT_TOP_UP_THRESHOLD = 2;
const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEZONE_ALIASES = new Map<string, string>([
  ['GMT', 'UTC'],
  ['UTC+7', 'Asia/Bangkok'],
  ['GMT+7', 'Asia/Bangkok'],
]);

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
  recurrence_rule_id: string | null;
  recurrence_slot_id: string | null;
  recurrence_occurrence_key: string | null;
  recurrence_origin: 'manual' | 'generated';
  recurrence_override_kind: 'manual_edit' | 'manual_reschedule' | 'manual_cancel' | null;
  created_at: Date;
  updated_at: Date;
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

export class TeacherBusinessDashboardError extends Error {
  constructor(
    readonly code: 'invalid_request',
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getBusinessSettings(): Promise<BusinessSettingsDto> {
  return withPgClient(async (client) =>
    getBusinessSettingsForWorkspace(client, DEFAULT_WORKSPACE_ID),
  );
}

export async function updateBusinessSettings(
  params: UpdateBusinessSettingsRequest,
  actorUserId?: string | null,
): Promise<BusinessSettingsDto> {
  return withPgClient(async (client) => {
    await ensureDefaultWorkspace(client);
    const current = await getBusinessSettingsForWorkspace(client, DEFAULT_WORKSPACE_ID);
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
        DEFAULT_WORKSPACE_ID,
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
    return getBusinessSettingsForWorkspace(client, DEFAULT_WORKSPACE_ID);
  });
}

export async function getBusinessScheduleSurface(
  params: { from?: string; to?: string } = {},
): Promise<BusinessScheduleSurfaceResponse> {
  return withPgClient(async (client) => {
    await materializeWorkspaceLessonRecurrencesWithClient(client);
    const settings = await getBusinessSettingsForWorkspace(client, DEFAULT_WORKSPACE_ID);
    const from = params.from ?? toDateInputInTimeZone(new Date(), settings.timezone);
    const to = params.to ?? addDaysToDateInput(from, 7);
    const range = parseDateRange(from, to, 90);
    const lessonItems = await listBusinessLessons(
      client,
      range.fromDate,
      range.toDate,
      settings.timezone,
    );
    const lessons = lessonItems.map((item) => item.lesson);
    const creditStates = await listStudentCreditStates(
      client,
      range.fromInstant,
      range.toExclusiveInstant,
      settings.topUpThreshold,
    );
    const recentPayments = await listRecentPayments(client, settings.defaultCurrency);
    const today = toDateInputInTimeZone(new Date(), settings.timezone);

    return {
      workspaceId: DEFAULT_WORKSPACE_ID,
      from,
      to,
      generatedAt: new Date().toISOString(),
      settings,
      today: lessonItems.filter((item) => item.localDate === today).map((item) => item.lesson),
      lessons,
      reminders: buildBusinessReminders(creditStates),
      creditAlerts: buildCreditAlerts(creditStates),
      recentPayments,
    };
  });
}

export async function getBusinessStatsSurface(
  params: { month?: string } = {},
): Promise<BusinessStatsSurfaceResponse> {
  return withPgClient(async (client) => {
    await materializeWorkspaceLessonRecurrencesWithClient(client);
    const settings = await getBusinessSettingsForWorkspace(client, DEFAULT_WORKSPACE_ID);
    const month = params.month ?? toDateInputInTimeZone(new Date(), settings.timezone).slice(0, 7);
    const monthRange = parseMonth(month);
    const forecastFrom = new Date();
    const forecastTo = addDays(forecastFrom, settings.forecastHorizonDays);
    const collected = await getCollectedForMonth(
      client,
      monthRange.fromDate,
      monthRange.toExclusiveDate,
      settings.defaultCurrency,
    );
    const excludedCurrencies = await getExcludedCurrenciesForMonth(
      client,
      monthRange.fromDate,
      monthRange.toExclusiveDate,
      settings.defaultCurrency,
    );
    const lessonStats = await getLessonStatsForMonth(
      client,
      monthRange.fromDate,
      monthRange.toExclusiveDate,
      settings.timezone,
    );
    const forecastLessons = await listForecastLessons(client, forecastFrom, forecastTo);
    const creditStates = await listStudentCreditStates(
      client,
      forecastFrom,
      forecastTo,
      settings.topUpThreshold,
    );

    const scheduledGrossMinor = forecastLessons.length * settings.defaultLessonRateMinor;
    const riskRateBasisPoints = Math.min(
      10000,
      settings.noShowRateBasisPoints + settings.cancellationRateBasisPoints,
    );
    const riskAdjustmentMinor = Math.round((scheduledGrossMinor * riskRateBasisPoints) / 10000);
    const forecastMinor = Math.max(0, scheduledGrossMinor - riskAdjustmentMinor);
    const pipeline = buildPipelineItems(creditStates);

    return {
      workspaceId: DEFAULT_WORKSPACE_ID,
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
      scheduledLessons: forecastLessons.length,
      scheduledMinutes: forecastLessons.reduce((sum, lesson) => sum + lesson.durationMinutes, 0),
      noShowLessons: lessonStats.noShowLessons,
      canceledLessons: lessonStats.canceledLessons,
      forecastFrom: toDateInput(forecastFrom),
      forecastTo: toDateInput(forecastTo),
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
  await ensureDefaultWorkspace(client);
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
): Promise<BusinessLessonWithLocalDate[]> {
  const result = await client.query<BusinessLessonLocalDateRow>(
    `
    SELECT
      student_lessons.*,
      students.student AS student_name,
      (student_lessons.starts_at AT TIME ZONE $3)::date::text AS local_date
    FROM student_lessons
    JOIN students ON students.id = student_lessons.student_id
    WHERE COALESCE(student_lessons.workspace_id, $4::uuid) = $4::uuid
      AND students.archived_at IS NULL
      AND student_lessons.recurrence_obsolete_at IS NULL
      AND (student_lessons.starts_at AT TIME ZONE $3)::date >= $1::date
      AND (student_lessons.starts_at AT TIME ZONE $3)::date <= $2::date
    ORDER BY student_lessons.starts_at ASC, student_lessons.id ASC
    `,
    [fromDate, toDate, timezone, DEFAULT_WORKSPACE_ID],
  );
  return result.rows.map((row) => ({
    lesson: mapBusinessLesson(row),
    localDate: row.local_date,
  }));
}

async function listForecastLessons(
  client: PoolClient,
  from: Date,
  toExclusive: Date,
): Promise<BusinessLessonDto[]> {
  const result = await client.query<BusinessLessonRow>(
    `
    SELECT
      student_lessons.*,
      students.student AS student_name
    FROM student_lessons
    JOIN students ON students.id = student_lessons.student_id
    WHERE COALESCE(student_lessons.workspace_id, $3::uuid) = $3::uuid
      AND students.archived_at IS NULL
      AND student_lessons.recurrence_obsolete_at IS NULL
      AND student_lessons.status = 'scheduled'
      AND student_lessons.starts_at >= $1
      AND student_lessons.starts_at < $2
    ORDER BY student_lessons.starts_at ASC, student_lessons.id ASC
    `,
    [from.toISOString(), toExclusive.toISOString(), DEFAULT_WORKSPACE_ID],
  );
  return result.rows.map(mapBusinessLesson);
}

async function listStudentCreditStates(
  client: PoolClient,
  from: Date,
  toExclusive: Date,
  topUpThreshold: number,
): Promise<StudentCreditStateRow[]> {
  const result = await client.query<StudentCreditStateRow>(
    `
    WITH credit_totals AS (
      SELECT
        student_id,
        COALESCE(SUM(quantity_delta), 0) AS remaining
      FROM student_credit_events
      WHERE voided_at IS NULL
      GROUP BY student_id
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
      WHERE COALESCE(workspace_id, $3::uuid) = $3::uuid
        AND recurrence_obsolete_at IS NULL
      GROUP BY student_id
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
    WHERE COALESCE(students.workspace_id, $3::uuid) = $3::uuid
      AND students.archived_at IS NULL
    ORDER BY students.student ASC, students.id ASC
    `,
    [from.toISOString(), toExclusive.toISOString(), DEFAULT_WORKSPACE_ID, topUpThreshold],
  );
  return result.rows;
}

async function listRecentPayments(
  client: PoolClient,
  currency: string,
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
    WHERE COALESCE(student_payment_records.workspace_id, $2::uuid) = $2::uuid
      AND students.archived_at IS NULL
      AND student_payment_records.voided_at IS NULL
      AND student_payment_records.currency = $1
    ORDER BY student_payment_records.received_at DESC, student_payment_records.created_at DESC
    LIMIT 8
    `,
    [currency, DEFAULT_WORKSPACE_ID],
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

async function getCollectedForMonth(
  client: PoolClient,
  fromDate: string,
  toExclusiveDate: string,
  currency: string,
): Promise<number> {
  const result = await client.query<{ total: string | number | null }>(
    `
    SELECT COALESCE(SUM(student_payment_records.amount_minor), 0) AS total
    FROM student_payment_records
    JOIN students ON students.id = student_payment_records.student_id
    WHERE COALESCE(student_payment_records.workspace_id, $4::uuid) = $4::uuid
      AND students.archived_at IS NULL
      AND student_payment_records.voided_at IS NULL
      AND student_payment_records.currency = $3
      AND student_payment_records.received_at >= $1::date
      AND student_payment_records.received_at < $2::date
    `,
    [fromDate, toExclusiveDate, currency, DEFAULT_WORKSPACE_ID],
  );
  return Number(result.rows[0]?.total ?? 0);
}

async function getExcludedCurrenciesForMonth(
  client: PoolClient,
  fromDate: string,
  toExclusiveDate: string,
  currency: string,
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
    WHERE COALESCE(student_payment_records.workspace_id, $4::uuid) = $4::uuid
      AND students.archived_at IS NULL
      AND student_payment_records.voided_at IS NULL
      AND student_payment_records.currency <> $3
      AND student_payment_records.received_at >= $1::date
      AND student_payment_records.received_at < $2::date
    GROUP BY student_payment_records.currency
    ORDER BY student_payment_records.currency ASC
    `,
    [fromDate, toExclusiveDate, currency, DEFAULT_WORKSPACE_ID],
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
    WHERE COALESCE(student_lessons.workspace_id, $4::uuid) = $4::uuid
      AND students.archived_at IS NULL
      AND student_lessons.recurrence_obsolete_at IS NULL
      AND (student_lessons.starts_at AT TIME ZONE $3)::date >= $1::date
      AND (student_lessons.starts_at AT TIME ZONE $3)::date < $2::date
    `,
    [fromDate, toExclusiveDate, timezone, DEFAULT_WORKSPACE_ID],
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

function buildBusinessReminders(states: StudentCreditStateRow[]): BusinessReminderDto[] {
  const reminders: BusinessReminderDto[] = [];
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
        severity: remaining < 0 ? 'urgent' : 'attention',
        title: remaining < 0 ? 'Balance is negative' : 'Lesson credits are low',
        message: `${remaining} lesson credit${Math.abs(remaining) === 1 ? '' : 's'} remaining.`,
        copyText:
          remaining <= 0
            ? `Hi ${state.student_name}, please send payment for the next lesson package when convenient.`
            : `Hi ${state.student_name}, you have ${remaining} lesson credit${remaining === 1 ? '' : 's'} remaining. Would you like to top up?`,
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
    recurrenceRuleId: row.recurrence_rule_id ?? null,
    recurrenceSlotId: row.recurrence_slot_id ?? null,
    recurrenceOccurrenceKey: row.recurrence_occurrence_key ?? null,
    recurrenceOrigin: row.recurrence_origin ?? 'manual',
    recurrenceOverrideKind: row.recurrence_override_kind ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
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

function normalizeBusinessTimezone(timezone: string): string {
  const trimmed = timezone.trim();
  const alias = TIMEZONE_ALIASES.get(trimmed.toUpperCase());
  const normalized = alias ?? normalizeFixedOffsetTimezone(trimmed) ?? trimmed;
  try {
    toDateInputInTimeZone(new Date(), normalized);
    return normalized;
  } catch {
    throw new TeacherBusinessDashboardError('invalid_request', 400, 'Invalid timezone');
  }
}

function normalizeFixedOffsetTimezone(timezone: string): string | null {
  const match = /^(?:UTC|GMT)([+-])(\d{1,2})(?::?00)?$/i.exec(timezone.trim());
  if (!match) {
    return null;
  }
  const sign = match[1];
  const hours = Number(match[2]);
  if (!Number.isInteger(hours) || hours > 14) {
    return null;
  }
  if (hours === 0) {
    return 'UTC';
  }
  const etcSign = sign === '+' ? '-' : '+';
  return `Etc/GMT${etcSign}${hours}`;
}

function severityRank(value: 'info' | 'attention' | 'urgent'): number {
  return value === 'urgent' ? 2 : value === 'attention' ? 1 : 0;
}
