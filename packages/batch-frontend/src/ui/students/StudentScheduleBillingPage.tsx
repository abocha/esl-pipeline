import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import type { StudentLessonWindow } from '@esl-pipeline/contracts';

import { useWorkspaceSettings, useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import {
  addStudentPackage,
  getStudentLessonPage,
  getStudentScheduleBillingSurface,
  hideStudentLessonFollowupReminder,
  recordStudentPayment,
  type StudentScheduleBillingSurface,
  undoLatestHiddenStudentReminder,
  updateStudentLesson,
  updateStudentLessonPlan,
} from '../../utils/api';
import { normalizeTimezone } from '../../utils/timezones';
import { formatPlainDate, formatTutorTime } from '../../utils/tutor-time';
import { CalendarSchedulingPanel } from '../calendar/CalendarSchedulingPanel';
import { useStudentAreaContext } from './StudentAreaContext';
import {
  StudentAreaActionLink,
  StudentAreaEmptyState,
  StudentAreaMetricCard,
  StudentAreaPanel,
  StudentAreaSectionLabel,
  StudentAreaStatusPill,
} from './StudentAreaDesignSystem';
import './StudentScheduleBillingPage.css';

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

export const StudentScheduleBillingPage: React.FC = () => {
  const { studentId } = useStudentAreaContext();
  return <StudentScheduleBillingContent key={studentId} />;
};

const StudentScheduleBillingContent: React.FC = () => {
  const { student, studentId } = useStudentAreaContext();
  const navigate = useNavigate();
  const studentName = student?.student ?? 'this student';
  const [surface, setSurface] = useState<StudentScheduleBillingSurface | null>(null);
  const tutorTimezone = useWorkspaceTimezone();
  const { reconcileTimezone } = useWorkspaceSettings();
  const workspaceTimezone = tutorTimezone ?? surface?.lessonWindows.timezone ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
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
  const [lessonEditForm, setLessonEditForm] = useState({
    notes: '',
    consumesCredit: true,
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!studentId) return;
      resetPages();
      const requestEpoch = epoch.current;
      setSaving(null);
      setLoading(refreshVersion === 0);
      setRefreshing(true);
      setError(null);
      try {
        const nextSurface = await getStudentScheduleBillingSurface(studentId);
        if (!active || requestEpoch !== epoch.current) return;
        await reconcileTimezone(nextSurface.lessonWindows.timezone);
        if (!active || requestEpoch !== epoch.current) return;
        setSurface(nextSurface);
        setPlanForm({
          defaultDurationMinutes: String(nextSurface.lessonPlan.defaultDurationMinutes),
          schedulingNotes: nextSurface.lessonPlan.schedulingNotes ?? '',
        });
      } catch (loadError: unknown) {
        if (!active || requestEpoch !== epoch.current) return;
        setError(loadError instanceof Error ? loadError.message : 'Schedule and billing failed.');
      } finally {
        if (active && requestEpoch === epoch.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [studentId, refreshVersion, resetPages, tutorTimezone, reconcileTimezone]);

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
    setError(null);
    try {
      const nextSurface = await action();
      await reconcileTimezone(nextSurface.lessonWindows.timezone);
      if (!active.current || requestEpoch !== epoch.current) return false;
      setSurface(nextSurface);
      return true;
    } catch (actionError: unknown) {
      if (active.current && requestEpoch === epoch.current)
        setError(actionError instanceof Error ? actionError.message : 'Action failed.');
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
    navigateToLessonAssignment(lessonId);
    return surface;
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
    loading ||
    (surface &&
      tutorTimezone &&
      normalizeTimezone(surface.lessonWindows.timezone) !== tutorTimezone)
  ) {
    return (
      <section className="student-schedule-billing-page student-area-theme">
        <StudentAreaEmptyState>{error ?? 'Loading schedule and billing...'}</StudentAreaEmptyState>
        {error ? (
          <button type="button" onClick={() => setRefreshVersion((value) => value + 1)}>
            Retry schedule
          </button>
        ) : null}
      </section>
    );
  }

  if (!surface) {
    return (
      <section className="student-schedule-billing-page student-area-theme">
        <StudentAreaEmptyState>
          {error ?? 'Schedule and billing is unavailable.'}
        </StudentAreaEmptyState>
        <button type="button" onClick={() => setRefreshVersion((value) => value + 1)}>
          Retry schedule
        </button>
      </section>
    );
  }

  const creditTone = surface.creditSummary.isNegative
    ? 'warning'
    : surface.creditSummary.isLow
      ? 'attention'
      : 'success';

  return (
    <section className="student-schedule-billing-page student-area-theme">
      {error ? (
        <p className="student-schedule-billing-error" role="alert">
          {error}
        </p>
      ) : null}

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

      <div className="student-schedule-billing-window-heading">
        <p>
          Lesson times: {workspaceTimezone} · {surface.lessonWindows.date}
        </p>
        <button
          type="button"
          disabled={Boolean(saving) || refreshing}
          onClick={() => setRefreshVersion((value) => value + 1)}
        >
          Refresh lessons
        </button>
      </div>
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
      ).map((group) => (
        <StudentAreaPanel key={group.key} className="student-schedule-billing-panel">
          <header>
            <StudentAreaSectionLabel>{group.title}</StudentAreaSectionLabel>
            {group.key === 'today' ? (
              <p>Credits are consumed only when a completed lesson is marked chargeable.</p>
            ) : null}
            <p>Lesson times: {workspaceTimezone}. Change the timezone in Business settings.</p>
          </header>
          {group.items.length === 0 ? (
            <StudentAreaEmptyState>{group.empty}</StudentAreaEmptyState>
          ) : (
            <div className="student-schedule-billing-list">
              {group.items.map((lesson) => (
                <article key={lesson.id} className="student-schedule-billing-list-row">
                  <span>
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
                          new Date(lesson.startsAt).getTime() + lesson.durationMinutes * 60000
                        ? ' · In progress'
                        : Date.now() < new Date(lesson.startsAt).getTime()
                          ? ' · Later today'
                          : ' · Elapsed'
                      : ''}
                  </StudentAreaStatusPill>
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
                        Open homework
                      </a>
                    ) : null}
                    {canAddHomeworkForLesson(lesson) ? (
                      <button
                        type="button"
                        disabled={Boolean(saving)}
                        onClick={() => {
                          void runAction(lesson.id, () => startHomeworkForLesson(lesson.id));
                        }}
                      >
                        Add homework
                      </button>
                    ) : null}
                    {lesson.status === 'scheduled' ? (
                      <>
                        <button
                          type="button"
                          disabled={Boolean(saving)}
                          onClick={() => {
                            void runAction(lesson.id, () =>
                              updateStudentLesson(studentId, lesson.id, {
                                status: 'completed',
                                consumesCredit: true,
                              }),
                            );
                          }}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          disabled={Boolean(saving)}
                          onClick={() => {
                            void runAction(lesson.id, () =>
                              updateStudentLesson(studentId, lesson.id, {
                                status: 'no_show',
                                consumesCredit: false,
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
                      type="button"
                      disabled={Boolean(saving)}
                      onClick={() => {
                        setEditingLessonId(lesson.id);
                        setLessonEditForm({
                          notes: lesson.notes ?? '',
                          consumesCredit: lesson.consumesCredit,
                        });
                      }}
                    >
                      Edit
                    </button>
                  </div>
                  {editingLessonId === lesson.id ? (
                    <form
                      className="student-schedule-billing-edit-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void runAction(lesson.id, () =>
                          updateStudentLesson(studentId, lesson.id, {
                            notes: lessonEditForm.notes || null,
                            consumesCredit: lessonEditForm.consumesCredit,
                          }).then((nextSurface) => {
                            setEditingLessonId(null);
                            return nextSurface;
                          }),
                        );
                      }}
                    >
                      <label>
                        Operational notes
                        <textarea
                          value={lessonEditForm.notes}
                          onChange={(event) =>
                            setLessonEditForm({ ...lessonEditForm, notes: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Chargeable
                        <input
                          type="checkbox"
                          checked={lessonEditForm.consumesCredit}
                          onChange={(event) =>
                            setLessonEditForm({
                              ...lessonEditForm,
                              consumesCredit: event.target.checked,
                            })
                          }
                        />
                      </label>
                      <button type="submit" disabled={Boolean(saving)}>
                        Save
                      </button>
                      <button type="button" onClick={() => setEditingLessonId(null)}>
                        Close
                      </button>
                    </form>
                  ) : null}
                </article>
              ))}
            </div>
          )}
          {group.key !== 'today' ? (
            <div className="student-schedule-billing-paging">
              {pageState[group.key].error ? <p role="alert">{pageState[group.key].error}</p> : null}
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
      <details className="student-schedule-billing-management">
        <summary>Manage schedule, defaults and packages</summary>
        {surface.workspaceId && workspaceTimezone ? (
          <CalendarSchedulingPanel
            key={studentId}
            workspaceId={surface.workspaceId}
            studentId={studentId}
            studentName={studentName}
            email={student?.email ?? null}
            timezone={workspaceTimezone}
            defaultDurationMinutes={surface.lessonPlan.defaultDurationMinutes}
            onLedgerRefresh={async () => {
              const refreshed = await runAction('calendar-refresh', () =>
                getStudentScheduleBillingSurface(studentId),
              );
              if (!refreshed) throw new Error('Unable to refresh lessons after Calendar sync.');
            }}
          />
        ) : null}
        <div className="student-schedule-billing-columns">
          <StudentAreaPanel className="student-schedule-billing-panel">
            <StudentAreaSectionLabel>Lesson defaults and notes</StudentAreaSectionLabel>
            <form
              className="student-schedule-billing-form"
              onSubmit={(event) => {
                event.preventDefault();
                void runAction('plan', () =>
                  updateStudentLessonPlan(studentId, {
                    defaultDurationMinutes: Number(planForm.defaultDurationMinutes),
                    schedulingNotes: planForm.schedulingNotes || null,
                  }),
                );
              }}
            >
              <label>
                Default duration
                <input
                  type="number"
                  min="1"
                  max="1440"
                  value={planForm.defaultDurationMinutes}
                  onChange={(event) =>
                    setPlanForm({ ...planForm, defaultDurationMinutes: event.target.value })
                  }
                />
              </label>
              <label>
                Operational notes
                <textarea
                  value={planForm.schedulingNotes}
                  onChange={(event) =>
                    setPlanForm({ ...planForm, schedulingNotes: event.target.value })
                  }
                />
              </label>
              <button type="submit" disabled={Boolean(saving)}>
                Save defaults
              </button>
            </form>
          </StudentAreaPanel>

          <StudentAreaPanel className="student-schedule-billing-panel">
            <header>
              <StudentAreaSectionLabel>Package And Payment</StudentAreaSectionLabel>
              <p>Add paid lesson credits and optionally record the matching payment.</p>
            </header>
            <form
              className="student-schedule-billing-form"
              onSubmit={(event) => {
                event.preventDefault();
                const amountMajor = packageForm.amountMajor.trim();
                void runAction('package', () =>
                  addStudentPackage(studentId, {
                    lessons: Number(packageForm.lessons),
                    note: packageForm.note || null,
                    payment: amountMajor
                      ? {
                          amountMinor: Math.round(Number(amountMajor) * 100),
                          currency: packageForm.currency.toUpperCase(),
                          method: packageForm.method || null,
                          note: packageForm.note || null,
                        }
                      : null,
                  }),
                );
              }}
            >
              <label>
                Lessons
                <input
                  min="1"
                  type="number"
                  value={packageForm.lessons}
                  onChange={(event) =>
                    setPackageForm({ ...packageForm, lessons: event.target.value })
                  }
                />
              </label>
              <label>
                Amount
                <input
                  inputMode="decimal"
                  placeholder="120.00"
                  value={packageForm.amountMajor}
                  onChange={(event) =>
                    setPackageForm({ ...packageForm, amountMajor: event.target.value })
                  }
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
                  onChange={(event) =>
                    setPackageForm({ ...packageForm, method: event.target.value })
                  }
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
          </StudentAreaPanel>
        </div>
      </details>

      <StudentAreaPanel className="student-schedule-billing-panel">
        <header>
          <StudentAreaSectionLabel>Payment History</StudentAreaSectionLabel>
          <p>Recorded payments are factual ledger entries, separate from lesson-credit packages.</p>
        </header>
        <details>
          <summary>Record a payment</summary>
          <form
            className="student-schedule-billing-form"
            onSubmit={(event) => {
              event.preventDefault();
              void runAction('payment', () =>
                recordStudentPayment(studentId, {
                  amountMinor: Math.round(Number(paymentForm.amountMajor) * 100),
                  currency: paymentForm.currency.toUpperCase(),
                  method: paymentForm.method || null,
                  note: paymentForm.note || null,
                }),
              );
            }}
          >
            <label>
              Amount
              <input
                inputMode="decimal"
                value={paymentForm.amountMajor}
                onChange={(event) =>
                  setPaymentForm({ ...paymentForm, amountMajor: event.target.value })
                }
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

      <StudentAreaPanel className="student-schedule-billing-panel">
        <header>
          <StudentAreaSectionLabel>Reminders</StudentAreaSectionLabel>
          <p>Manual follow-ups; some include actions.</p>
        </header>
        {surface.reminders.length === 0 ? (
          <StudentAreaEmptyState>No operational reminders are needed.</StudentAreaEmptyState>
        ) : (
          <div className="student-schedule-billing-list">
            {surface.reminders.map((reminder) => (
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
        {surface.latestHiddenReminder ? (
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
        <StudentAreaActionLink to={`/students/${encodeURIComponent(studentId)}/overview`}>
          Back to overview
        </StudentAreaActionLink>
      </StudentAreaPanel>
    </section>
  );
};
