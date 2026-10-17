import { CalendarDays, ChevronDown, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  type BusinessScheduleSurface,
  getBusinessScheduleSurface,
  hideStudentLessonFollowupReminder,
  undoLatestHiddenStudentReminder,
  updateStudentLesson,
} from '../../utils/api';
import { BusinessInfoHint } from './BusinessInfoHint';
import { formatDate, formatDateTime, formatMoney } from './business-format';

function formatReminderLessonDetail(
  summary?: BusinessScheduleSurface['reminders'][number]['lessonSummary'] | null,
  timezone?: string,
): string {
  if (!summary) return 'Lesson no longer available';
  const topic = summary.title?.trim();
  const date = summary.startsAt ? formatDateTime(summary.startsAt, timezone) : 'Not scheduled yet';
  return topic ? `${date} · ${topic}` : date;
}
export const BusinessSchedulePage: React.FC = () => {
  const navigate = useNavigate();
  const [fromOverride, setFromOverride] = useState<string | undefined>();
  const [toOverride, setToOverride] = useState<string | undefined>();
  const [surface, setSurface] = useState<BusinessScheduleSurface | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingLessonId, setSavingLessonId] = useState<string | null>(null);
  const [showOlderFollowups, setShowOlderFollowups] = useState(false);
  const [openLessonActionsId, setOpenLessonActionsId] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLElement>(null);
  const latestLoadRequestRef = useRef(0);
  const from = fromOverride ?? surface?.from ?? '';
  const to = toOverride ?? surface?.to ?? '';
  useEffect(() => {
    if (openLessonActionsId === null) return;
    const menu = surfaceRef.current?.querySelector<HTMLElement>(
      '.business-status-actions:has(> button[aria-expanded="true"])',
    );
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu?.contains(event.target)) {
        setOpenLessonActionsId(null);
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      menu?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
      setOpenLessonActionsId(null);
    };
    document.addEventListener('pointerdown', dismissOutside);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [openLessonActionsId]);
  const load = useCallback(async () => {
    const requestId = latestLoadRequestRef.current + 1;
    latestLoadRequestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const range =
        fromOverride === undefined && toOverride === undefined
          ? {}
          : { from: fromOverride, to: toOverride };
      const nextSurface = await getBusinessScheduleSurface(range);
      if (latestLoadRequestRef.current !== requestId) return;
      setSurface(nextSurface);
    } catch (loadError: unknown) {
      if (latestLoadRequestRef.current !== requestId) return;
      setError(loadError instanceof Error ? loadError.message : 'Business schedule failed.');
    } finally {
      if (latestLoadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [fromOverride, toOverride]);
  useEffect(() => {
    void load();
    return () => {
      latestLoadRequestRef.current += 1;
    };
  }, [load]);
  const runLessonStatus = async (
    lesson: NonNullable<BusinessScheduleSurface['lessons'][number]>,
    status: 'scheduled' | 'completed' | 'no_show' | 'canceled',
  ) => {
    surfaceRef.current
      ?.querySelector<HTMLElement>('.business-status-actions > button[aria-expanded="true"]')
      ?.focus();
    setOpenLessonActionsId(null);
    setSavingLessonId(lesson.id);
    setError(null);
    try {
      await updateStudentLesson(lesson.studentId, lesson.id, {
        status,
        consumesCredit: status === 'completed',
      });
      await load();
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to update lesson.');
    } finally {
      setSavingLessonId(null);
    }
  };
  const runStartHomeworkFromReminder = async (
    reminder: NonNullable<BusinessScheduleSurface['reminders'][number]>,
  ) => {
    if (!reminder.lessonId) return;
    setSavingLessonId(reminder.lessonId);
    setError(null);
    try {
      navigateToLessonAssignment(reminder.studentId, reminder.lessonId);
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to update lesson.');
    } finally {
      setSavingLessonId(null);
    }
  };
  const navigateToLessonAssignment = (studentId: string, lessonId: string) => {
    navigate(
      `/?studentId=${encodeURIComponent(studentId)}&lessonId=${encodeURIComponent(lessonId)}`,
    );
  };
  const canAddHomeworkForLesson = (lesson: BusinessScheduleSurface['lessons'][number]) => {
    if (lesson.homework.status !== 'not_started') return false;
    if (lesson.status === 'completed') return true;
    if (lesson.status !== 'scheduled') return false;
    const endsAt = new Date(lesson.startsAt).getTime() + lesson.durationMinutes * 60 * 1000;
    return Number.isFinite(endsAt) && endsAt <= Date.now();
  };
  const runHideReminder = async (
    reminder: NonNullable<BusinessScheduleSurface['reminders'][number]>,
  ) => {
    if (!reminder.lessonId) return;
    setSavingLessonId(reminder.lessonId);
    setError(null);
    try {
      await hideStudentLessonFollowupReminder(reminder.studentId, reminder.lessonId);
      await load();
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to hide reminder.');
    } finally {
      setSavingLessonId(null);
    }
  };
  const runUndoHiddenReminder = async () => {
    const latest = surface?.latestHiddenReminder;
    if (!latest) return;
    setSavingLessonId(latest.lessonId);
    setError(null);
    try {
      await undoLatestHiddenStudentReminder(latest.studentId);
      await load();
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to undo reminder.');
    } finally {
      setSavingLessonId(null);
    }
  };
  if (loading && !surface) {
    return (
      <section className="business-dashboard-surface">
        <header className="business-agenda-heading">
          <h2>Schedule</h2>
        </header>
        <p className="business-empty">Loading business schedule...</p>
      </section>
    );
  }
  if (!surface) {
    return (
      <section className="business-dashboard-surface">
        <header className="business-agenda-heading">
          <h2>Schedule</h2>
        </header>
        <div className="business-empty" role="alert">
          <p>{error ?? 'Schedule unavailable.'}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </section>
    );
  }
  const timezone = surface.settings.timezone;
  const dayKey = (value: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(value));
  const todayKey = dayKey(surface.generatedAt);
  const days = new Map<string, BusinessScheduleSurface['lessons']>();
  for (const lesson of surface.lessons) {
    const key = dayKey(lesson.startsAt);
    const items = days.get(key) ?? [];
    items.push(lesson);
    days.set(key, items);
  }
  const followups = surface.reminders.filter((item) => item.type === 'lesson_followup');
  const otherReminders = surface.reminders.filter((item) => item.type !== 'lesson_followup');
  const visibleFollowups = showOlderFollowups ? followups : followups.slice(0, 4);
  const retainedPeriodNotice = `Showing lessons for ${surface.from} – ${surface.to}.`;
  return (
    <section ref={surfaceRef} className="business-dashboard-surface" aria-busy={loading}>
      <div className="business-agenda-heading">
        <div className="business-schedule-title">
          <h2>Schedule</h2>
          <Link
            className="business-timezone"
            to="/business/settings"
            aria-label={`Timezone: ${timezone}. Change in Business settings.`}
          >
            {timezone}
          </Link>
        </div>
        <form
          className="business-period-picker"
          aria-label="Schedule date range"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <div className="business-period-fields">
            <input
              aria-label="From"
              id="business-schedule-from"
              name="from"
              title="First day"
              type="date"
              value={from}
              onChange={(event) => {
                setFromOverride(event.target.value);
                setToOverride(to);
              }}
            />
            <span className="business-period-separator" aria-hidden="true">
              –
            </span>
            <input
              aria-label="To"
              id="business-schedule-to"
              name="to"
              title="Last day"
              type="date"
              value={to}
              onChange={(event) => {
                setFromOverride(from);
                setToOverride(event.target.value);
              }}
            />
          </div>
          <button
            type="submit"
            className="business-picker-action"
            aria-label="Refresh"
            title="Refresh schedule"
            disabled={loading}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="business-picker-action"
            aria-label="Today & next"
            title="Today & next"
            onClick={() => {
              setFromOverride(undefined);
              setToOverride(undefined);
              if (fromOverride === undefined && toOverride === undefined) void load();
            }}
          >
            <CalendarDays size={14} aria-hidden="true" />
          </button>
        </form>
      </div>
      {error ? (
        <p className="business-dashboard-error" role="alert">
          {error} {retainedPeriodNotice}
        </p>
      ) : from !== surface.from || to !== surface.to ? (
        <p className="business-muted" role="status">
          {retainedPeriodNotice}
        </p>
      ) : null}
      <section aria-label="Lesson agenda" className="business-agenda">
        {from <= todayKey && to >= todayKey && !days.has(todayKey) ? (
          <p className="business-today-empty">No lessons today.</p>
        ) : null}
        {Array.from(days, ([key, lessons]) => (
          <section className="business-day" key={key}>
            <h3>
              {key === todayKey
                ? 'Today'
                : new Intl.DateTimeFormat('en-US', {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    timeZone: timezone,
                  }).format(new Date(lessons[0]!.startsAt))}
            </h3>
            <div>
              {lessons.map((lesson) => (
                <article
                  key={lesson.id}
                  className="business-lesson-row"
                  aria-label={`${lesson.studentName}, ${formatDateTime(lesson.startsAt, timezone)}`}
                >
                  <time dateTime={lesson.startsAt}>
                    {new Intl.DateTimeFormat('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: timezone,
                    }).format(new Date(lesson.startsAt))}
                  </time>
                  <div className="business-lesson-identity">
                    <Link to={lesson.studentScheduleBillingPath}>{lesson.studentName}</Link>
                    <span>
                      {lesson.durationMinutes} min · {lesson.status.replaceAll('_', ' ')}
                      {lesson.homework.status === 'not_planned' ? ' · No homework planned' : ''}
                    </span>
                  </div>
                  <div className="business-lesson-actions">
                    {lesson.homework.transcriptResultSessionId ? (
                      <Link
                        to={`/?sessionId=${encodeURIComponent(lesson.homework.transcriptResultSessionId)}`}
                      >
                        View transcript
                      </Link>
                    ) : lesson.homework.htmlUrl ? (
                      <a href={lesson.homework.htmlUrl} target="_blank" rel="noreferrer">
                        Open homework
                      </a>
                    ) : canAddHomeworkForLesson(lesson) ? (
                      <button
                        type="button"
                        onClick={() => navigateToLessonAssignment(lesson.studentId, lesson.id)}
                      >
                        Add homework
                      </button>
                    ) : lesson.homework.assignmentSessionId ? (
                      <Link
                        to={`/?sessionId=${encodeURIComponent(lesson.homework.assignmentSessionId)}`}
                      >
                        Continue assignment
                      </Link>
                    ) : null}
                    <div
                      className="business-status-actions"
                      onBlur={(event) => {
                        if (
                          event.relatedTarget &&
                          !event.currentTarget.contains(event.relatedTarget)
                        ) {
                          setOpenLessonActionsId(null);
                        }
                      }}
                    >
                      <button
                        type="button"
                        aria-expanded={openLessonActionsId === lesson.id}
                        aria-controls={`business-actions-${lesson.id}`}
                        aria-label={`Lesson actions for ${lesson.studentName}`}
                        onClick={(event) => {
                          event.preventDefault();
                          setOpenLessonActionsId((current) =>
                            current === lesson.id ? null : lesson.id,
                          );
                        }}
                      >
                        Actions
                        <ChevronDown size={14} aria-hidden="true" />
                      </button>
                      {openLessonActionsId === lesson.id ? (
                        <div id={`business-actions-${lesson.id}`}>
                          {lesson.status === 'scheduled' ? (
                            <>
                              <div className="business-complete-action">
                                <button
                                  type="button"
                                  disabled={savingLessonId !== null}
                                  aria-describedby={`business-complete-hint-${lesson.id}`}
                                  onClick={() => void runLessonStatus(lesson, 'completed')}
                                >
                                  Complete
                                </button>
                                <BusinessInfoHint
                                  id={`business-complete-hint-${lesson.id}`}
                                  label="completing a lesson"
                                >
                                  Completing uses 1 lesson credit.
                                </BusinessInfoHint>
                              </div>
                              <button
                                type="button"
                                disabled={savingLessonId !== null}
                                onClick={() => void runLessonStatus(lesson, 'no_show')}
                              >
                                No-show
                              </button>
                              <button
                                type="button"
                                disabled={savingLessonId !== null}
                                onClick={() => void runLessonStatus(lesson, 'canceled')}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={savingLessonId !== null}
                                onClick={() => void runLessonStatus(lesson, 'scheduled')}
                              >
                                Restore
                              </button>
                              {lesson.creditEventId ? (
                                <small>Restoring returns the consumed credit.</small>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
        {!surface.lessons.length ? (
          <p className="business-muted">No lessons in this range.</p>
        ) : null}
      </section>
      <section className="business-followups" aria-labelledby="business-followups-title">
        <header className="business-section-heading">
          <h2 id="business-followups-title">Unfinished lesson follow-up</h2>
          <span>{followups.length}</span>
        </header>
        {visibleFollowups.map((reminder) => (
          <article
            key={`${reminder.studentId}-${reminder.lessonId}`}
            className="business-followup-row"
          >
            <div>
              <Link to={reminder.studentScheduleBillingPath}>{reminder.studentName}</Link>
              <span>{formatReminderLessonDetail(reminder.lessonSummary, timezone)}</span>
            </div>
            <div className="business-actions">
              {reminder.actionIntent === 'complete_lesson_and_start_assignment' &&
              reminder.lessonId ? (
                <>
                  <button
                    type="button"
                    aria-label={`Open lesson for ${reminder.studentName}`}
                    disabled={savingLessonId !== null}
                    onClick={() => void runStartHomeworkFromReminder(reminder)}
                  >
                    Open lesson
                  </button>
                  <button
                    type="button"
                    className="business-quiet"
                    disabled={savingLessonId !== null}
                    onClick={() => void runHideReminder(reminder)}
                  >
                    Hide
                  </button>
                </>
              ) : null}
            </div>
          </article>
        ))}
        {!followups.length ? (
          <p className="business-muted">No unfinished lesson follow-up.</p>
        ) : null}
        {followups.length > 4 ? (
          <button
            type="button"
            className="business-text-button"
            onClick={() => setShowOlderFollowups(!showOlderFollowups)}
          >
            {showOlderFollowups
              ? 'Show fewer'
              : `Show ${followups.length - 4} older ${followups.length === 5 ? 'follow-up' : 'follow-ups'}`}
          </button>
        ) : null}
        {surface.latestHiddenReminder ? (
          <div className="business-hidden-reminder">
            <span>
              Hidden: {surface.latestHiddenReminder.studentName} ·{' '}
              {formatReminderLessonDetail(surface.latestHiddenReminder.lessonSummary, timezone)}
            </span>
            <button
              type="button"
              disabled={savingLessonId !== null}
              onClick={() => void runUndoHiddenReminder()}
            >
              Undo hide
            </button>
          </div>
        ) : null}
      </section>
      <details className="business-disclosure">
        <summary>
          Credits &amp; bookings <span>{otherReminders.length}</span>
        </summary>
        <p className="business-muted">
          Review balances and future bookings. Low credits do not necessarily mean a payment is due.
        </p>
        {otherReminders.map((reminder) => (
          <div key={`${reminder.studentId}-${reminder.type}`} className="business-followup-row">
            <div>
              <Link to={reminder.studentScheduleBillingPath}>{reminder.studentName}</Link>
              <span>
                {reminder.type === 'no_next_lesson'
                  ? 'No next lesson booked'
                  : `${reminder.remainingCredits} lesson credits remaining`}
              </span>
            </div>
            <details className="business-message">
              <summary>Message draft</summary>
              <textarea
                aria-label={`Reminder copy for ${reminder.studentName}`}
                id={`business-reminder-${reminder.studentId}-${reminder.type}`}
                name="reminderCopy"
                readOnly
                value={reminder.copyText}
              />
            </details>
          </div>
        ))}
        {!otherReminders.length ? (
          <p className="business-muted">No booking or credit suggestions.</p>
        ) : null}
      </details>
      <details className="business-disclosure">
        <summary>
          Recent payments <span>{surface.recentPayments.length}</span>
        </summary>
        {surface.recentPayments.map((payment, index) => (
          <Link
            key={`${payment.studentId}-${payment.receivedAt}-${index}`}
            className="business-payment-row"
            to={payment.studentScheduleBillingPath}
          >
            <strong>{payment.studentName}</strong>
            <span>{formatDate(payment.receivedAt)}</span>
            <b>{formatMoney(payment.amountMinor, payment.currency)}</b>
          </Link>
        ))}
        {!surface.recentPayments.length ? (
          <p className="business-muted">No recent payments.</p>
        ) : null}
      </details>
    </section>
  );
};
