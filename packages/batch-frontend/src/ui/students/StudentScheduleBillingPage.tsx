import { BookOpen, CalendarDays, ChevronDown, Pencil, Plus, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router-dom';

import type { StudentLessonWindow } from '@esl-pipeline/contracts';

import { useWorkspaceSettings, useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import {
  addStudentPackage,
  adjustStudentCredits,
  getStudentLesson,
  getStudentLessonPage,
  getStudentScheduleBillingSurface,
  hideStudentLessonFollowupReminder,
  recordStudentPayment,
  type StudentScheduleBillingSurface,
  undoLatestHiddenStudentReminder,
  updateStudentLesson,
  updateStudentLessonPlan,
} from '../../utils/api';
import { normalizeTimezone, timezoneName } from '../../utils/timezones';
import { formatPlainDate, formatTutorTime } from '../../utils/tutor-time';
import { CalendarSchedulingPanel } from '../calendar/CalendarSchedulingPanel';
import { StudioV2Dialog } from '../studio-v2/StudioV2Dialog';
import { LoadingPlaceholder, PageLoading } from '../system/LoadingPlaceholder';
import { lessonChargeLabel, lessonHasEnded, useLessonChargeReview } from './LessonChargeReview';
import { useStudentAreaContext } from './StudentAreaContext';
import {
  StudentAreaActionLink,
  StudentAreaEmptyState,
  StudentAreaMetricCard,
  StudentAreaPanel,
  StudentAreaSectionLabel,
  StudentAreaStatusPill,
} from './StudentAreaDesignSystem';
import { StudentBillingActivity } from './StudentBillingActivity';
import { StudentBillingEntryDialog } from './StudentBillingEntryDialog';
import { StudentCreditAdjustmentDialog } from './StudentCreditAdjustmentDialog';
import './StudentScheduleBillingPage.css';
import './StudentScheduleBillingV2.css';

function formatDateTime(value: string | null | undefined, timezone: string | null): string {
  return formatTutorTime(value, timezone);
}

function formatMoney(amountMinor: number, currency: string): string {
  return `${currency} ${(amountMinor / 100).toLocaleString('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })}`;
}

function formatCredits(value: number): string {
  return `${value} lesson credit${Math.abs(value) === 1 ? '' : 's'}`;
}

function formatReminderLessonDetail(
  summary: StudentScheduleBillingSurface['reminders'][number]['lessonSummary'] | null | undefined,
  timezone: string | null,
): string {
  if (!summary) return 'Lesson no longer available';
  const topic = summary.title?.trim() ? summary.title.trim() : 'Untitled lesson';
  const date = formatDateTime(summary.startsAt, timezone);
  return `${date} · ${topic} · Lesson ${summary.lessonId}`;
}

function LessonOperations({
  split,
  heading,
  metadata,
  children,
}: {
  split: boolean;
  heading: React.ReactNode;
  metadata: React.ReactNode;
  children: React.ReactNode;
}) {
  return split ? (
    <details className="student-operations-lesson-details">
      <summary>
        {heading}
        <span className="student-operations-lesson-toggle">
          Details <ChevronDown size={16} aria-hidden="true" />
        </span>
      </summary>
      <div className="student-operations-lesson-body">
        <div className="student-operations-lesson-meta">{metadata}</div>
        {children}
      </div>
    </details>
  ) : (
    <>
      {heading}
      {metadata}
      {children}
    </>
  );
}

function DiscardChangesPrompt({
  label,
  onKeepEditing,
  onDiscard,
}: {
  label: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
}) {
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepEditingRef.current?.focus(), []);
  return (
    <div className="student-operations-v2-discard" role="group" aria-label={label}>
      <strong>Discard unsaved changes?</strong>
      <div className="studio-v2-dialog__actions">
        <button
          ref={keepEditingRef}
          type="button"
          className="product-button product-button--secondary"
          onClick={onKeepEditing}
        >
          Keep editing
        </button>
        <button type="button" className="product-button product-button--danger" onClick={onDiscard}>
          Discard changes
        </button>
      </div>
    </div>
  );
}

export const StudentScheduleBillingPage: React.FC = () => {
  const { studentId } = useStudentAreaContext();
  return <StudentScheduleBillingContent key={studentId} />;
};

/** One controller stays mounted while the Schedule and Billing sibling routes change. */
export const StudentScheduleBillingLayout: React.FC = () => {
  const { studentId } = useStudentAreaContext();
  return (
    <>
      <StudentScheduleBillingContent key={studentId} split />
      <Outlet />
    </>
  );
};

const StudentScheduleBillingContent: React.FC<{ split?: boolean }> = ({ split = false }) => {
  const location = useLocation();
  const billingRoute = useMatch('/students/:studentId/billing');
  const billing = split && Boolean(billingRoute);
  const pageClassName = `student-schedule-billing-page student-area-theme${split ? ' student-operations-v2' : ''}`;
  const { student, studentId, studentLoading } = useStudentAreaContext();
  const navigate = useNavigate();
  const studentName = student?.student ?? 'this student';
  const { requestChargeReview, chargeReview } = useLessonChargeReview(studentId);
  const [surface, setSurface] = useState<StudentScheduleBillingSurface | null>(null);
  const tutorTimezone = useWorkspaceTimezone();
  const { reconcileTimezone } = useWorkspaceSettings();
  const workspaceTimezone = tutorTimezone ?? surface?.lessonWindows.timezone ?? null;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [billingDialog, setBillingDialog] = useState<'entry' | 'defaults' | 'adjustment' | null>(
    null,
  );
  const [billingDialogError, setBillingDialogError] = useState<string | null>(null);
  const [confirmPlanDiscard, setConfirmPlanDiscard] = useState(false);
  const planDurationRef = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const active = useRef(true);
  const actionPending = useRef<Promise<void> | null>(null);
  const pageRequests = useRef({ recent: false, upcoming: false });
  const [pageState, setPageState] = useState<
    Record<StudentLessonWindow, { loading: boolean; error: string | null }>
  >({
    recent: { loading: false, error: null },
    upcoming: { loading: false, error: null },
  });

  const resetPages = useCallback(() => {
    epoch.current += 1;
    pageRequests.current = { recent: false, upcoming: false };
    setPageState({
      recent: { loading: false, error: null },
      upcoming: { loading: false, error: null },
    });
  }, []);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      epoch.current += 1;
    };
  }, []);
  const [planForm, setPlanForm] = useState({
    defaultDurationMinutes: '60',
    schedulingNotes: '',
  });
  const [packageForm, setPackageForm] = useState({
    lessons: '8',
    amountMajor: '',
    currency: 'USD',
    method: '',
    note: '',
  });
  const [paymentForm, setPaymentForm] = useState({
    amountMajor: '',
    currency: 'USD',
    method: '',
    note: '',
  });
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [confirmLessonDiscard, setConfirmLessonDiscard] = useState(false);
  const [lessonEditError, setLessonEditError] = useState<string | null>(null);
  const editLessonTrigger = useRef<HTMLButtonElement>(null);
  const lessonNotesRef = useRef<HTMLTextAreaElement>(null);
  const [lessonEditForm, setLessonEditForm] = useState<{
    notes: string;
    consumesCredit: boolean | null;
  }>({
    notes: '',
    consumesCredit: true,
  });
  useEffect(() => {
    if (editingLessonId === null) {
      editLessonTrigger.current?.focus();
      editLessonTrigger.current = null;
    } else if (split) {
      lessonNotesRef.current?.focus();
    }
  }, [editingLessonId, split]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!studentId) return;
      resetPages();
      const requestEpoch = epoch.current;
      setSaving(null);
      setRefreshing(true);
      setError(null);
      try {
        const nextSurface = await getStudentScheduleBillingSurface(studentId);
        if (!active || requestEpoch !== epoch.current) return;
        await reconcileTimezone(nextSurface.lessonWindows.timezone);
        if (!active || requestEpoch !== epoch.current) return;
        setSurface(nextSurface);
        if (!split)
          setPlanForm({
            defaultDurationMinutes: String(nextSurface.lessonPlan.defaultDurationMinutes),
            schedulingNotes: nextSurface.lessonPlan.schedulingNotes ?? '',
          });
      } catch (loadError: unknown) {
        if (!active || requestEpoch !== epoch.current) return;
        setError(loadError instanceof Error ? loadError.message : 'Schedule and billing failed.');
      } finally {
        if (active && requestEpoch === epoch.current) {
          setRefreshing(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [studentId, refreshVersion, resetPages, tutorTimezone, reconcileTimezone, split]);

  const loadPage = async (window: StudentLessonWindow) => {
    const cursor = surface?.lessonWindows[window].nextCursor;
    if (!cursor || pageRequests.current[window]) return;
    pageRequests.current[window] = true;
    const requestEpoch = epoch.current;
    setPageState((current) => ({ ...current, [window]: { loading: true, error: null } }));
    try {
      const page = await getStudentLessonPage(studentId, window, cursor);
      if (!active.current || requestEpoch !== epoch.current) return;
      setSurface((current) => {
        if (!current || current.lessonWindows[window].nextCursor !== cursor) return current;
        const previous = current.lessonWindows[window].items;
        const ids = new Set(previous.map((lesson) => lesson.id));
        return {
          ...current,
          lessonWindows: {
            ...current.lessonWindows,
            [window]: {
              ...page,
              items: [...previous, ...page.items.filter((lesson) => !ids.has(lesson.id))],
            },
          },
        };
      });
    } catch (failure) {
      if (!active.current || requestEpoch !== epoch.current) return;
      setPageState((current) => ({
        ...current,
        [window]: {
          loading: false,
          error: failure instanceof Error ? failure.message : 'Unable to load lessons.',
        },
      }));
    } finally {
      if (active.current && requestEpoch === epoch.current) {
        pageRequests.current[window] = false;
        setPageState((current) => ({
          ...current,
          [window]: { ...current[window], loading: false },
        }));
      }
    }
  };

  const runAction = async (
    key: string,
    action: () => Promise<StudentScheduleBillingSurface>,
    setFailureMessage: React.Dispatch<React.SetStateAction<string | null>> = setError,
  ): Promise<boolean> => {
    while (actionPending.current) await actionPending.current;
    if (!active.current) return false;
    let finishAction!: () => void;
    actionPending.current = new Promise((resolve) => {
      finishAction = resolve;
    });
    setSaving(key);
    resetPages();
    setRefreshing(false);
    const requestEpoch = epoch.current;
    setFailureMessage(null);
    try {
      const nextSurface = await action();
      await reconcileTimezone(nextSurface.lessonWindows.timezone);
      if (!active.current || requestEpoch !== epoch.current) return false;
      setSurface(nextSurface);
      return true;
    } catch (actionError: unknown) {
      if (active.current && requestEpoch === epoch.current)
        setFailureMessage(actionError instanceof Error ? actionError.message : 'Action failed.');
      return false;
    } finally {
      actionPending.current = null;
      finishAction();
      if (active.current && requestEpoch === epoch.current) setSaving(null);
    }
  };

  const navigateToLessonAssignment = (lessonId: string) => {
    navigate(
      `/?studentId=${encodeURIComponent(studentId)}&lessonId=${encodeURIComponent(lessonId)}`,
    );
  };

  const canAddHomeworkForLesson = (lesson: StudentScheduleBillingSurface['lessons'][number]) => {
    if (lesson.homework.status !== 'not_started') return false;
    if (lesson.status === 'completed') return true;
    if (lesson.status !== 'scheduled') return false;
    if (split) return true;
    const endsAt = new Date(lesson.startsAt).getTime() + lesson.durationMinutes * 60 * 1000;
    return Number.isFinite(endsAt) && endsAt <= Date.now();
  };

  const startHomeworkForLesson = async (
    lessonId: string,
  ): Promise<StudentScheduleBillingSurface> => {
    if (!lessonId) {
      throw new Error('Lesson follow-up is missing lesson context.');
    }
    if (!surface) {
      throw new Error('Schedule surface is not loaded.');
    }
    const lesson =
      [
        ...surface.lessonWindows.today,
        ...surface.lessonWindows.recent.items,
        ...surface.lessonWindows.upcoming.items,
      ].find((item) => item.id === lessonId) ?? (await getStudentLesson(studentId, lessonId));
    if (
      lesson.status === 'scheduled' &&
      lessonHasEnded(lesson) &&
      !(await requestChargeReview(studentId, lesson))
    )
      return surface;
    navigateToLessonAssignment(lessonId);
    return surface;
  };

  const completeLesson = (lesson: StudentScheduleBillingSurface['lessons'][number]) => {
    void runAction(lesson.id, () => {
      const complete = (reviewed: typeof lesson) =>
        updateStudentLesson(studentId, reviewed.id, {
          status: 'completed',
          expectedStatus: 'scheduled',
          expectedPlannedCharge: reviewed.plannedCharge,
        });
      if (lesson.plannedCharge != null) return complete(lesson);
      return requestChargeReview(studentId, lesson).then((reviewed) =>
        reviewed ? complete(reviewed) : surface!,
      );
    });
  };

  const startHomeworkFromReminder = async (
    reminder: StudentScheduleBillingSurface['reminders'][number],
  ): Promise<StudentScheduleBillingSurface> => {
    return startHomeworkForLesson(reminder.lessonId ?? '');
  };

  const hideReminder = async (
    reminder: StudentScheduleBillingSurface['reminders'][number],
  ): Promise<StudentScheduleBillingSurface> => {
    if (!reminder.lessonId) {
      throw new Error('Lesson follow-up is missing lesson context.');
    }
    return hideStudentLessonFollowupReminder(studentId, reminder.lessonId);
  };

  if (
    (refreshing && !surface) ||
    (split && studentLoading && !student) ||
    (surface &&
      tutorTimezone &&
      normalizeTimezone(surface.lessonWindows.timezone) !== tutorTimezone)
  ) {
    if (!error && split) return <PageLoading page={billing ? 'billing' : 'schedule'} />;
    return (
      <section className={pageClassName}>
        {error ? (
          <>
            <StudentAreaEmptyState>{error}</StudentAreaEmptyState>
            <button type="button" onClick={() => setRefreshVersion((value) => value + 1)}>
              Retry schedule
            </button>
          </>
        ) : (
          <LoadingPlaceholder label="Loading schedule and billing" />
        )}
      </section>
    );
  }

  if (!surface) {
    return (
      <section className={pageClassName}>
        <StudentAreaEmptyState>
          {error ?? 'Schedule and billing is unavailable.'}
        </StudentAreaEmptyState>
        <button type="button" onClick={() => setRefreshVersion((value) => value + 1)}>
          Retry schedule
        </button>
      </section>
    );
  }

  const scheduleTimezone = tutorTimezone ?? surface.lessonWindows.timezone;
  const timezoneDisplay = timezoneName(scheduleTimezone);
  const refreshLessons = (
    <button
      type="button"
      className={split ? 'student-area-icon-button' : undefined}
      aria-label={split ? 'Refresh lessons' : undefined}
      title={split ? 'Refresh lessons' : undefined}
      disabled={Boolean(saving) || refreshing}
      onClick={() => setRefreshVersion((value) => value + 1)}
    >
      {split ? <RefreshCw size={16} aria-hidden="true" /> : 'Refresh lessons'}
    </button>
  );
  const creditTone = surface.creditSummary.isNegative
    ? 'warning'
    : surface.creditSummary.isLow
      ? 'attention'
      : 'success';

  const openBillingDialog = (dialog: 'entry' | 'defaults' | 'adjustment') => {
    if (dialog === 'defaults') {
      setConfirmPlanDiscard(false);
      setPlanForm({
        defaultDurationMinutes: String(surface.lessonPlan.defaultDurationMinutes),
        schedulingNotes: surface.lessonPlan.schedulingNotes ?? '',
      });
    }
    setError(null);
    setBillingDialogError(null);
    setBillingDialog(dialog);
  };
  const closeBillingDialog = () => {
    setBillingDialog(null);
    setBillingDialogError(null);
    setConfirmPlanDiscard(false);
  };
  const requestClosePlan = () => {
    const edited =
      planForm.defaultDurationMinutes !== String(surface.lessonPlan.defaultDurationMinutes) ||
      planForm.schedulingNotes !== (surface.lessonPlan.schedulingNotes ?? '');
    if (edited) setConfirmPlanDiscard(true);
    else closeBillingDialog();
  };
  const closeLessonEditor = () => {
    setConfirmLessonDiscard(false);
    setLessonEditError(null);
    setEditingLessonId(null);
  };
  const planFormContent = (
    <form
      className={
        split
          ? 'student-schedule-billing-form student-operations-v2-plan-form studio-v2-dialog__body'
          : 'student-schedule-billing-form'
      }
      onSubmit={async (event) => {
        event.preventDefault();
        if (confirmPlanDiscard) return;
        const updated = await runAction(
          'plan',
          () =>
            updateStudentLessonPlan(studentId, {
              defaultDurationMinutes: Number(planForm.defaultDurationMinutes),
              schedulingNotes: planForm.schedulingNotes || null,
            }),
          split ? setBillingDialogError : setError,
        );
        if (split && updated) closeBillingDialog();
      }}
    >
      <label>
        {split ? 'Default duration (minutes)' : 'Default duration'}
        <input
          ref={planDurationRef}
          type="number"
          min="1"
          max="1440"
          required={split}
          disabled={split && Boolean(saving)}
          value={planForm.defaultDurationMinutes}
          onChange={(event) =>
            setPlanForm({ ...planForm, defaultDurationMinutes: event.target.value })
          }
        />
      </label>
      <label>
        {split ? 'Scheduling notes' : 'Operational notes'}
        <textarea
          value={planForm.schedulingNotes}
          disabled={split && Boolean(saving)}
          onChange={(event) => setPlanForm({ ...planForm, schedulingNotes: event.target.value })}
        />
      </label>
      {split && billingDialogError && (
        <p className="student-schedule-billing-error" role="alert">
          {billingDialogError}
        </p>
      )}
      {split ? (
        confirmPlanDiscard ? (
          <DiscardChangesPrompt
            label="Unsaved lesson defaults"
            onKeepEditing={() => {
              setConfirmPlanDiscard(false);
              planDurationRef.current?.focus();
            }}
            onDiscard={closeBillingDialog}
          />
        ) : (
          <div className="studio-v2-dialog__actions">
            <button
              type="button"
              className="product-button product-button--quiet"
              disabled={Boolean(saving)}
              onClick={requestClosePlan}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="product-button product-button--primary"
              disabled={Boolean(saving)}
            >
              {saving === 'plan' ? 'Saving…' : 'Save defaults'}
            </button>
          </div>
        )
      ) : (
        <button type="submit" disabled={Boolean(saving)}>
          Save defaults
        </button>
      )}
    </form>
  );
  const submitPackage = () =>
    runAction('package', () =>
      addStudentPackage(studentId, {
        lessons: Number(packageForm.lessons),
        note: packageForm.note || null,
        payment: packageForm.amountMajor.trim()
          ? {
              amountMinor: Math.round(Number(packageForm.amountMajor) * 100),
              currency: packageForm.currency.toUpperCase(),
              method: packageForm.method || null,
              note: packageForm.note || null,
            }
          : null,
      }),
    );
  const packageFormContent = (
    <form
      className="student-schedule-billing-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submitPackage();
      }}
    >
      <label>
        Lessons
        <input
          min="1"
          type="number"
          value={packageForm.lessons}
          onChange={(event) => setPackageForm({ ...packageForm, lessons: event.target.value })}
        />
      </label>
      <label>
        Amount
        <input
          inputMode="decimal"
          placeholder="120.00"
          value={packageForm.amountMajor}
          onChange={(event) => setPackageForm({ ...packageForm, amountMajor: event.target.value })}
        />
      </label>
      <label>
        Currency
        <input
          maxLength={3}
          value={packageForm.currency}
          onChange={(event) =>
            setPackageForm({ ...packageForm, currency: event.target.value.toUpperCase() })
          }
        />
      </label>
      <label>
        Method
        <input
          placeholder="Bank transfer"
          value={packageForm.method}
          onChange={(event) => setPackageForm({ ...packageForm, method: event.target.value })}
        />
      </label>
      <label className="student-schedule-billing-wide">
        Note
        <textarea
          value={packageForm.note}
          onChange={(event) => setPackageForm({ ...packageForm, note: event.target.value })}
        />
      </label>
      <button type="submit" disabled={Boolean(saving)}>
        Add package
      </button>
    </form>
  );
  const packagePanel = (
    <StudentAreaPanel className="student-schedule-billing-panel">
      <header>
        <StudentAreaSectionLabel>Package And Payment</StudentAreaSectionLabel>
        <p>Add paid lesson credits and optionally record the matching payment.</p>
      </header>
      {packageFormContent}
    </StudentAreaPanel>
  );
  const submitPayment = () =>
    runAction('payment', () =>
      recordStudentPayment(studentId, {
        amountMinor: Math.round(Number(paymentForm.amountMajor) * 100),
        currency: paymentForm.currency.toUpperCase(),
        method: paymentForm.method || null,
        note: paymentForm.note || null,
      }),
    );
  const paymentFormContent = (
    <form
      className="student-schedule-billing-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submitPayment();
      }}
    >
      <label>
        Amount
        <input
          inputMode="decimal"
          value={paymentForm.amountMajor}
          onChange={(event) => setPaymentForm({ ...paymentForm, amountMajor: event.target.value })}
        />
      </label>
      <label>
        Currency
        <input
          maxLength={3}
          value={paymentForm.currency}
          onChange={(event) =>
            setPaymentForm({ ...paymentForm, currency: event.target.value.toUpperCase() })
          }
        />
      </label>
      <label>
        Method
        <input
          value={paymentForm.method}
          onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}
        />
      </label>
      <label className="student-schedule-billing-wide">
        Note
        <textarea
          value={paymentForm.note}
          onChange={(event) => setPaymentForm({ ...paymentForm, note: event.target.value })}
        />
      </label>
      <button type="submit" disabled={Boolean(saving)}>
        Record payment
      </button>
    </form>
  );
  const lowBalanceReminder = surface.reminders.find((reminder) => reminder.type === 'low_balance');
  const visibleReminders = split
    ? surface.reminders.filter((reminder) => {
        if (!billing)
          return reminder.type === 'no_next_lesson' || reminder.type === 'lesson_followup';
        if (reminder.type === 'low_balance') return true;
        return (
          reminder.type === 'payment_followup' &&
          !(
            lowBalanceReminder &&
            lowBalanceReminder.actionIntent === reminder.actionIntent &&
            lowBalanceReminder.channel === reminder.channel &&
            lowBalanceReminder.message === reminder.message &&
            lowBalanceReminder.copyText === reminder.copyText
          )
        );
      })
    : surface.reminders;

  const calendarPanel = surface.workspaceId && (
    <CalendarSchedulingPanel
      key={studentId}
      workspaceId={surface.workspaceId}
      studentId={studentId}
      studentName={studentName}
      email={student?.email ?? null}
      timezone={scheduleTimezone}
      presentationActive={!billing}
      routeHash={location.hash}
      defaultDurationMinutes={surface.lessonPlan.defaultDurationMinutes}
      onLedgerRefresh={async () => {
        const refreshed = await runAction('calendar-refresh', () =>
          getStudentScheduleBillingSurface(studentId),
        );
        if (!refreshed) throw new Error('Unable to refresh lessons after Calendar sync.');
      }}
    />
  );

  return (
    <section className={pageClassName}>
      {chargeReview}
      {error ? (
        <p className="student-schedule-billing-error" role="alert">
          {error}
        </p>
      ) : null}

      {!split ? (
        <div className="student-schedule-billing-grid">
          <StudentAreaMetricCard
            eyebrow="Next lesson"
            value={
              surface.nextLesson
                ? formatDateTime(surface.nextLesson.startsAt, workspaceTimezone)
                : 'Not scheduled'
            }
            detail={
              surface.nextLesson
                ? `${surface.nextLesson.durationMinutes} min`
                : 'Check Google Calendar setup and sync below.'
            }
          />
          <StudentAreaMetricCard
            eyebrow="Lesson credits"
            value={formatCredits(surface.creditSummary.remaining)}
            detail={`${surface.creditSummary.purchased} purchased, ${surface.creditSummary.consumed} used`}
            tone={creditTone}
          />
          <StudentAreaMetricCard
            eyebrow="Latest payment"
            value={
              surface.payments[0]
                ? formatMoney(surface.payments[0].amountMinor, surface.payments[0].currency)
                : 'Not tracked'
            }
            detail={
              surface.payments[0]
                ? formatPlainDate(surface.payments[0].receivedAt)
                : 'Record payment with a package.'
            }
          />
        </div>
      ) : null}

      {split ? (
        <header className="student-operations-v2-heading">
          <h1>{billing ? 'Billing' : 'Schedule'}</h1>
          {billing ? (
            <button
              type="button"
              className="product-button product-button--primary"
              onClick={() => openBillingDialog('entry')}
            >
              <Plus size={16} aria-hidden="true" />
              Add billing entry
            </button>
          ) : (
            <div className="student-schedule-heading-actions">
              <p>
                Time zone: {timezoneDisplay} ·{' '}
                <time dateTime={surface.lessonWindows.date}>{surface.lessonWindows.date}</time>
              </p>
              {refreshLessons}
            </div>
          )}
        </header>
      ) : null}
      {split ? (
        <div hidden={!billing} className="student-operations-v2-billing">
          <section
            className={`student-operations-v2-credit student-operations-v2-credit-${creditTone}`}
            aria-label="Lesson credits"
          >
            <div className="student-operations-v2-credit-overview">
              <div>
                <strong>{surface.creditSummary.remaining}</strong>
                <h2>Lesson credits</h2>
              </div>
              <button
                type="button"
                className="product-button product-button--secondary"
                onClick={() => openBillingDialog('adjustment')}
              >
                Adjust credits
              </button>
            </div>
            <p className="student-operations-v2-credit-detail">
              {surface.creditSummary.purchased} purchased · {surface.creditSummary.consumed} used
              {surface.creditSummary.adjustments !== 0
                ? ` · ${surface.creditSummary.adjustments} adjusted`
                : ''}
            </p>
            <div className="student-operations-v2-credit-footer">
              <Link
                to={{
                  pathname: `/students/${encodeURIComponent(studentId)}/schedule`,
                  search: location.search,
                }}
              >
                <CalendarDays size={16} aria-hidden="true" />
                View schedule
              </Link>
              <button
                type="button"
                className="product-button product-button--quiet student-operations-v2-defaults"
                aria-label="Edit lesson defaults"
                onClick={() => openBillingDialog('defaults')}
              >
                Lesson defaults
                <span>{surface.lessonPlan.defaultDurationMinutes} min</span>
                <Pencil size={16} aria-hidden="true" />
              </button>
            </div>
          </section>
        </div>
      ) : null}
      <div hidden={billing} className="student-operations-schedule-region">
        {!split && (
          <div className="student-schedule-billing-window-heading">
            <p>
              Time zone: {timezoneDisplay} · {surface.lessonWindows.date}
            </p>
            {refreshLessons}
          </div>
        )}
        {split ? calendarPanel : null}
        {(
          [
            {
              key: 'today',
              title: 'Today',
              items: surface.lessonWindows.today,
              empty: 'No lessons today.',
            },
            {
              key: 'recent',
              title: 'Recent lessons',
              items: surface.lessonWindows.recent.items,
              empty: 'No earlier lessons.',
            },
            {
              key: 'upcoming',
              title:
                surface.lessonWindows.upcoming.items.length > 3
                  ? 'Upcoming occurrences'
                  : 'Upcoming · Next 3 occurrences',
              items: surface.lessonWindows.upcoming.items,
              empty: 'No upcoming occurrences.',
            },
          ] as const
        )
          .slice()
          .sort((a, b) =>
            split
              ? ['today', 'upcoming', 'recent'].indexOf(a.key) -
                ['today', 'upcoming', 'recent'].indexOf(b.key)
              : 0,
          )
          .map((group) => (
            <StudentAreaPanel key={group.key} className="student-schedule-billing-panel">
              <header>
                {split ? (
                  <h2 className="student-area-section-label">{group.title}</h2>
                ) : (
                  <StudentAreaSectionLabel>{group.title}</StudentAreaSectionLabel>
                )}
                {!split && group.key === 'today' ? (
                  <p>Credits are consumed only when a completed lesson is marked chargeable.</p>
                ) : null}
                {!split ? (
                  <p>Time zone: {timezoneDisplay}. Change the time zone in Business settings.</p>
                ) : null}
              </header>
              {group.items.length === 0 ? (
                split ? (
                  <p className="student-operations-v2-empty-lessons">{group.empty}</p>
                ) : (
                  <StudentAreaEmptyState>{group.empty}</StudentAreaEmptyState>
                )
              ) : (
                <div className="student-schedule-billing-list">
                  {group.items.map((lesson) => (
                    <article key={lesson.id} className="student-schedule-billing-list-row">
                      <LessonOperations
                        split={split}
                        heading={
                          <>
                            <span className="student-operations-lesson-title">
                              <strong>
                                {lesson.title || formatDateTime(lesson.startsAt, workspaceTimezone)}
                              </strong>
                              <small>
                                {formatDateTime(lesson.startsAt, workspaceTimezone)} ·{' '}
                                {lesson.durationMinutes} min
                              </small>
                            </span>
                            <StudentAreaStatusPill
                              tone={
                                lesson.status === 'completed'
                                  ? 'success'
                                  : lesson.status === 'scheduled'
                                    ? 'quiet'
                                    : 'attention'
                              }
                            >
                              {lesson.status.replace('_', ' ')}
                              {group.key === 'today' && lesson.status === 'scheduled'
                                ? Date.now() >= new Date(lesson.startsAt).getTime() &&
                                  Date.now() <
                                    new Date(lesson.startsAt).getTime() +
                                      lesson.durationMinutes * 60000
                                  ? ' · In progress'
                                  : Date.now() < new Date(lesson.startsAt).getTime()
                                    ? ' · Later today'
                                    : ' · Elapsed'
                                : ''}
                            </StudentAreaStatusPill>
                          </>
                        }
                        metadata={
                          <>
                            <StudentAreaStatusPill tone="quiet">
                              {lesson.schedulingSource === 'calendar'
                                ? 'Google Calendar'
                                : 'Historical / unmanaged'}
                            </StudentAreaStatusPill>
                            <StudentAreaStatusPill
                              tone={
                                lesson.homework.status === 'published' ||
                                lesson.homework.status === 'memory_ready'
                                  ? 'success'
                                  : lesson.homework.status === 'not_started' ||
                                      lesson.homework.status === 'not_planned'
                                    ? 'quiet'
                                    : 'attention'
                              }
                            >
                              {lesson.homework.status === 'not_planned'
                                ? 'No homework planned'
                                : `homework ${lesson.homework.status.replaceAll('_', ' ')}`}
                            </StudentAreaStatusPill>
                          </>
                        }
                      >
                        <div className="student-schedule-billing-actions">
                          {lesson.homework.transcriptResultSessionId ? (
                            <Link
                              to={`/?sessionId=${encodeURIComponent(lesson.homework.transcriptResultSessionId)}`}
                            >
                              View transcript
                            </Link>
                          ) : null}
                          {lesson.homework.htmlUrl ? (
                            <a href={lesson.homework.htmlUrl} target="_blank" rel="noreferrer">
                              {split ? <BookOpen size={16} aria-hidden="true" /> : null} Open
                              homework
                            </a>
                          ) : null}
                          {canAddHomeworkForLesson(lesson) ? (
                            <button
                              className={
                                split ? 'product-button product-button--secondary' : undefined
                              }
                              type="button"
                              disabled={Boolean(saving)}
                              onClick={() => {
                                void runAction(lesson.id, () => startHomeworkForLesson(lesson.id));
                              }}
                            >
                              {split ? <BookOpen size={16} aria-hidden="true" /> : null}
                              {split && lesson.status === 'scheduled'
                                ? lessonHasEnded(lesson)
                                  ? 'Complete & add homework'
                                  : 'Prepare homework'
                                : 'Add homework'}
                            </button>
                          ) : null}
                          {lesson.status === 'scheduled' ? (
                            <>
                              <button
                                className={
                                  split ? 'product-button product-button--primary' : undefined
                                }
                                type="button"
                                disabled={
                                  Boolean(saving) ||
                                  new Date(lesson.startsAt).getTime() > Date.now()
                                }
                                title={
                                  new Date(lesson.startsAt).getTime() > Date.now()
                                    ? 'Available once the lesson starts'
                                    : lesson.plannedCharge == null
                                      ? 'Review lesson charge'
                                      : lessonChargeLabel(lesson)
                                }
                                onClick={() => {
                                  void completeLesson(lesson);
                                }}
                              >
                                Complete
                              </button>
                              <button
                                className={
                                  split ? 'product-button product-button--quiet' : undefined
                                }
                                type="button"
                                disabled={
                                  Boolean(saving) ||
                                  new Date(lesson.startsAt).getTime() > Date.now()
                                }
                                title="No charge"
                                onClick={() => {
                                  void runAction(lesson.id, () =>
                                    updateStudentLesson(studentId, lesson.id, {
                                      status: 'no_show',
                                      consumesCredit: false,
                                      expectedStatus: 'scheduled',
                                    }),
                                  );
                                }}
                              >
                                No-show
                              </button>
                            </>
                          ) : null}
                          {lesson.calendarEventUrl ? (
                            <a href={lesson.calendarEventUrl} target="_blank" rel="noreferrer">
                              Open in Google
                            </a>
                          ) : null}
                          <button
                            className={
                              split ? 'product-button product-button--secondary' : undefined
                            }
                            type="button"
                            disabled={Boolean(saving) || (split && editingLessonId !== null)}
                            onClick={(event) => {
                              editLessonTrigger.current = event.currentTarget;
                              setConfirmLessonDiscard(false);
                              setLessonEditError(null);
                              setEditingLessonId(lesson.id);
                              setLessonEditForm({
                                notes: lesson.notes ?? '',
                                consumesCredit:
                                  lesson.status === 'scheduled'
                                    ? lesson.plannedCharge
                                    : lesson.consumesCredit,
                              });
                            }}
                          >
                            Edit
                          </button>
                        </div>
                        {editingLessonId === lesson.id ? (
                          <form
                            className="student-schedule-billing-edit-form"
                            onSubmit={async (event) => {
                              event.preventDefault();
                              if (saving || confirmLessonDiscard) return;
                              const updated = await runAction(
                                lesson.id,
                                () =>
                                  updateStudentLesson(studentId, lesson.id, {
                                    notes: lessonEditForm.notes || null,
                                    ...(lesson.status === 'scheduled'
                                      ? {
                                          ...(lessonEditForm.consumesCredit === null
                                            ? {}
                                            : { plannedCharge: lessonEditForm.consumesCredit }),
                                          expectedStatus: 'scheduled' as const,
                                          expectedPlannedCharge: lesson.plannedCharge,
                                        }
                                      : {
                                          consumesCredit:
                                            lessonEditForm.consumesCredit ?? lesson.consumesCredit,
                                        }),
                                  }),
                                split ? setLessonEditError : setError,
                              );
                              if (updated) closeLessonEditor();
                            }}
                          >
                            <label>
                              {split ? 'Notes' : 'Operational notes'}
                              <textarea
                                ref={lessonNotesRef}
                                disabled={Boolean(saving)}
                                value={lessonEditForm.notes}
                                onChange={(event) =>
                                  setLessonEditForm({
                                    ...lessonEditForm,
                                    notes: event.target.value,
                                  })
                                }
                              />
                            </label>
                            {lesson.status === 'scheduled' && lesson.plannedCharge === null ? (
                              <label>
                                Lesson charge
                                <select
                                  disabled={Boolean(saving)}
                                  value={
                                    lessonEditForm.consumesCredit === null
                                      ? ''
                                      : String(lessonEditForm.consumesCredit)
                                  }
                                  onChange={(event) =>
                                    setLessonEditForm({
                                      ...lessonEditForm,
                                      consumesCredit:
                                        event.target.value === ''
                                          ? null
                                          : event.target.value === 'true',
                                    })
                                  }
                                >
                                  <option value="">Not set</option>
                                  <option value="true">1 lesson credit</option>
                                  <option value="false">No charge</option>
                                </select>
                              </label>
                            ) : (
                              <label
                                className={split ? 'student-operations-v2-chargeable' : undefined}
                              >
                                {!split && 'Chargeable'}
                                <input
                                  type="checkbox"
                                  disabled={Boolean(saving)}
                                  checked={lessonEditForm.consumesCredit === true}
                                  onChange={(event) =>
                                    setLessonEditForm({
                                      ...lessonEditForm,
                                      consumesCredit: event.target.checked,
                                    })
                                  }
                                />
                                {split && 'Chargeable lesson'}
                              </label>
                            )}
                            {lessonEditError && (
                              <p className="student-schedule-billing-error" role="alert">
                                {lessonEditError}
                              </p>
                            )}
                            {split ? (
                              confirmLessonDiscard ? (
                                <DiscardChangesPrompt
                                  label="Unsaved lesson changes"
                                  onKeepEditing={() => {
                                    setConfirmLessonDiscard(false);
                                    lessonNotesRef.current?.focus();
                                  }}
                                  onDiscard={closeLessonEditor}
                                />
                              ) : (
                                <div className="student-operations-v2-lesson-editor-actions">
                                  <button
                                    type="button"
                                    className="product-button product-button--quiet"
                                    disabled={Boolean(saving)}
                                    onClick={() => {
                                      const currentCharge =
                                        lesson.status === 'scheduled'
                                          ? lesson.plannedCharge
                                          : lesson.consumesCredit;
                                      if (
                                        lessonEditForm.notes !== (lesson.notes ?? '') ||
                                        lessonEditForm.consumesCredit !== currentCharge
                                      ) {
                                        setConfirmLessonDiscard(true);
                                      } else {
                                        closeLessonEditor();
                                      }
                                    }}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="submit"
                                    className="product-button product-button--primary"
                                    disabled={Boolean(saving)}
                                  >
                                    {saving === lesson.id ? 'Saving…' : 'Save'}
                                  </button>
                                </div>
                              )
                            ) : (
                              <>
                                <button type="submit" disabled={Boolean(saving)}>
                                  Save
                                </button>
                                <button type="button" onClick={closeLessonEditor}>
                                  Close
                                </button>
                              </>
                            )}
                          </form>
                        ) : null}
                      </LessonOperations>
                    </article>
                  ))}
                </div>
              )}
              {group.key !== 'today' ? (
                <div className="student-schedule-billing-paging">
                  {pageState[group.key].error ? (
                    <p role="alert">{pageState[group.key].error}</p>
                  ) : null}
                  {surface.lessonWindows[group.key].nextCursor ? (
                    <button
                      type="button"
                      disabled={pageState[group.key].loading || Boolean(saving) || refreshing}
                      onClick={() => {
                        void loadPage(group.key as StudentLessonWindow);
                      }}
                    >
                      {pageState[group.key].loading
                        ? 'Loading lessons…'
                        : pageState[group.key].error
                          ? 'Retry ' +
                            (group.key === 'recent' ? 'older lessons' : 'upcoming occurrences')
                          : group.key === 'recent'
                            ? 'Load older lessons'
                            : 'Load more upcoming occurrences'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </StudentAreaPanel>
          ))}
        {split ? (
          <footer className="student-operations-v2-schedule-footer">
            <span>{formatCredits(surface.creditSummary.remaining)}</span>
            <Link
              to={{
                pathname: `/students/${encodeURIComponent(studentId)}/billing`,
                search: location.search,
              }}
            >
              View billing
            </Link>
          </footer>
        ) : null}
      </div>
      {!split && (
        <details className="student-schedule-billing-management">
          <summary>Manage schedule, defaults and packages</summary>
          {calendarPanel}
          <div className="student-schedule-billing-columns">
            <StudentAreaPanel className="student-schedule-billing-panel">
              <StudentAreaSectionLabel>Lesson defaults and notes</StudentAreaSectionLabel>
              {planFormContent}
            </StudentAreaPanel>
            {packagePanel}
          </div>
        </details>
      )}

      {billing && (
        <StudentBillingActivity
          payments={surface.payments}
          creditEvents={surface.creditEvents}
          timezone={workspaceTimezone ?? surface.lessonWindows.timezone}
          studentId={studentId}
          lessonTitles={
            new Map(
              [
                ...surface.lessons,
                ...surface.lessonWindows.today,
                ...surface.lessonWindows.recent.items,
                ...surface.lessonWindows.upcoming.items,
              ].flatMap((lesson) => (lesson.title ? [[lesson.id, lesson.title] as const] : [])),
            )
          }
        />
      )}
      {!split && (
        <StudentAreaPanel className="student-schedule-billing-panel">
          <header>
            <StudentAreaSectionLabel>Payment History</StudentAreaSectionLabel>
            <p>
              Recorded payments are factual ledger entries, separate from lesson-credit packages.
            </p>
          </header>
          <details>
            <summary>Record a payment</summary>
            {paymentFormContent}
          </details>
          <div className="student-schedule-billing-list">
            {surface.payments.map((payment) => (
              <article key={payment.id} className="student-schedule-billing-list-row compact">
                <span>
                  <strong>{formatMoney(payment.amountMinor, payment.currency)}</strong>
                  <small>
                    {formatPlainDate(payment.receivedAt)}
                    {payment.method ? ` · ${payment.method}` : ''}
                  </small>
                </span>
                {payment.note ? <small>{payment.note}</small> : null}
              </article>
            ))}
          </div>
        </StudentAreaPanel>
      )}
      {!split || visibleReminders.length > 0 || (surface.latestHiddenReminder && !billing) ? (
        <StudentAreaPanel className="student-schedule-billing-panel">
          <header>
            {split ? (
              <h2 className="student-area-section-label">Follow-ups</h2>
            ) : (
              <StudentAreaSectionLabel>Reminders</StudentAreaSectionLabel>
            )}
            {!split ? <p>Manual follow-ups; some include actions.</p> : null}
          </header>
          {visibleReminders.length === 0 ? (
            <StudentAreaEmptyState>No operational reminders are needed.</StudentAreaEmptyState>
          ) : (
            <div className="student-schedule-billing-list">
              {visibleReminders.map((reminder) => (
                <article
                  key={`${reminder.type}-${reminder.lessonId ?? 'none'}`}
                  className="student-schedule-billing-reminder"
                >
                  <StudentAreaStatusPill
                    tone={reminder.severity === 'urgent' ? 'warning' : 'attention'}
                  >
                    {reminder.channel}
                  </StudentAreaStatusPill>
                  <span>
                    <strong>{reminder.title}</strong>
                    <small>{reminder.message}</small>
                    {reminder.lessonSummary ? (
                      <small className="student-schedule-billing-reminder-detail">
                        {formatReminderLessonDetail(reminder.lessonSummary, workspaceTimezone)}
                      </small>
                    ) : null}
                  </span>
                  {reminder.actionIntent === 'complete_lesson_and_start_assignment' &&
                  reminder.lessonId ? (
                    <>
                      <button
                        type="button"
                        aria-label="Add homework from reminder"
                        disabled={Boolean(saving)}
                        onClick={() => {
                          void runAction(reminder.lessonId ?? reminder.type, () =>
                            startHomeworkFromReminder(reminder),
                          );
                        }}
                      >
                        Add homework
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(saving)}
                        onClick={() => {
                          void runAction(`hide-${reminder.lessonId}`, () => hideReminder(reminder));
                        }}
                      >
                        Hide
                      </button>
                    </>
                  ) : (
                    <textarea
                      aria-label={`Reminder copy for ${studentName}`}
                      readOnly
                      value={reminder.copyText}
                    />
                  )}
                </article>
              ))}
            </div>
          )}
          {surface.latestHiddenReminder && !billing ? (
            <div className="student-schedule-billing-hidden-reminder">
              <span>
                Hidden:{' '}
                {formatReminderLessonDetail(
                  surface.latestHiddenReminder.lessonSummary,
                  workspaceTimezone,
                )}
              </span>
              <button
                type="button"
                disabled={Boolean(saving)}
                onClick={() => {
                  void runAction('undo-hidden-reminder', () =>
                    undoLatestHiddenStudentReminder(studentId),
                  );
                }}
              >
                Undo hide
              </button>
            </div>
          ) : null}
          {!split ? (
            <StudentAreaActionLink to={`/students/${encodeURIComponent(studentId)}/overview`}>
              Back to overview
            </StudentAreaActionLink>
          ) : null}
        </StudentAreaPanel>
      ) : null}
      {split && (
        <StudentBillingEntryDialog
          open={billing && billingDialog === 'entry'}
          initialCurrency={surface.payments[0]?.currency ?? 'USD'}
          timezone={scheduleTimezone}
          saving={Boolean(saving)}
          error={billingDialogError}
          onClose={closeBillingDialog}
          onSave={async (entry) => {
            const saved = await runAction(
              entry.kind,
              () =>
                entry.kind === 'package'
                  ? addStudentPackage(studentId, entry.body)
                  : recordStudentPayment(studentId, entry.body),
              setBillingDialogError,
            );
            if (saved) closeBillingDialog();
            return saved;
          }}
        />
      )}
      {billing && billingDialog === 'defaults' ? (
        <StudioV2Dialog
          title="Edit lesson defaults"
          onClose={requestClosePlan}
          closeDisabled={Boolean(saving)}
        >
          {planFormContent}
        </StudioV2Dialog>
      ) : null}
      {billing && billingDialog === 'adjustment' && (
        <StudentCreditAdjustmentDialog
          balance={surface.creditSummary.remaining}
          saving={Boolean(saving)}
          error={billingDialogError}
          onClose={closeBillingDialog}
          onSave={async (adjustment) => {
            const saved = await runAction(
              'adjustment',
              () => adjustStudentCredits(studentId, adjustment),
              setBillingDialogError,
            );
            if (saved) closeBillingDialog();
          }}
        />
      )}
    </section>
  );
};
