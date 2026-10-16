import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import {
  type BusinessScheduleSurface,
  getBusinessScheduleSurface,
  hideStudentLessonFollowupReminder,
  undoLatestHiddenStudentReminder,
  updateStudentLesson,
} from '../../utils/api';
import { formatDate, formatDateTime, formatMoney } from './business-format';

function formatReminderLessonDetail(
  summary?: BusinessScheduleSurface['reminders'][number]['lessonSummary'] | null,
  timezone?: string,
): string {
  if (!summary) return 'Lesson no longer available';
  const topic = summary.title?.trim() ? summary.title.trim() : 'Untitled lesson';
  const date = summary.startsAt ? formatDateTime(summary.startsAt, timezone) : 'Not scheduled yet';
  return `${date} · ${topic} · Lesson ${summary.lessonId}`;
}

export const BusinessSchedulePage: React.FC = () => {
  const navigate = useNavigate();
  const [fromOverride, setFromOverride] = useState<string | undefined>();
  const [toOverride, setToOverride] = useState<string | undefined>();
  const [surface, setSurface] = useState<BusinessScheduleSurface | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingLessonId, setSavingLessonId] = useState<string | null>(null);
  const latestLoadRequestRef = useRef(0);
  const from = fromOverride ?? surface?.from ?? '';
  const to = toOverride ?? surface?.to ?? '';

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
    return <section className="business-empty">Loading business schedule...</section>;
  }

  return (
    <section className="business-dashboard-surface">
      {error ? (
        <p className="business-dashboard-error" role="alert">
          {error}
        </p>
      ) : null}

      <form
        className="business-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <label>
          From
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFromOverride(event.target.value);
              setToOverride(to);
            }}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setFromOverride(from);
              setToOverride(event.target.value);
            }}
          />
        </label>
        <button type="submit">Refresh</button>
      </form>
      {surface ? (
        <p className="business-muted">Times shown in {surface.settings.timezone}</p>
      ) : null}

      <div className="business-metric-grid">
        <Metric label="Today" value={String(surface?.today.length ?? 0)} detail="lessons" />
        <Metric label="Agenda" value={String(surface?.lessons.length ?? 0)} detail="in range" />
        <Metric
          label="Reminders"
          value={String(surface?.reminders.length ?? 0)}
          detail="open follow-ups"
        />
        <Metric
          label="Credit alerts"
          value={String(surface?.creditAlerts.length ?? 0)}
          detail="need attention"
        />
      </div>

      <div className="business-dashboard-grid">
        <article className="business-panel business-panel-wide">
          <header>
            <span className="business-dashboard-kicker">Agenda</span>
            <h2>Lessons</h2>
          </header>
          <div className="business-list">
            {surface?.lessons.length ? (
              surface.lessons.map((lesson) => (
                <article key={lesson.id} className="business-list-row">
                  <div>
                    <strong>{lesson.studentName}</strong>
                    <span>
                      {formatDateTime(lesson.startsAt, surface?.settings.timezone)} ·{' '}
                      {lesson.durationMinutes} min · {lesson.status}
                      {lesson.homework.status === 'not_planned' ? ' · No homework planned' : ''}
                    </span>
                  </div>
                  <div className="business-actions">
                    <Link to={lesson.studentScheduleBillingPath}>Open</Link>
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
                        onClick={() => navigateToLessonAssignment(lesson.studentId, lesson.id)}
                      >
                        Add homework
                      </button>
                    ) : null}
                    {lesson.status === 'scheduled' ? (
                      <>
                        <button
                          type="button"
                          disabled={savingLessonId === lesson.id}
                          onClick={() => void runLessonStatus(lesson, 'completed')}
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          disabled={savingLessonId === lesson.id}
                          onClick={() => void runLessonStatus(lesson, 'no_show')}
                        >
                          No-show
                        </button>
                        <button
                          type="button"
                          disabled={savingLessonId === lesson.id}
                          onClick={() => void runLessonStatus(lesson, 'canceled')}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={savingLessonId === lesson.id}
                        onClick={() => void runLessonStatus(lesson, 'scheduled')}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <p className="business-muted">No lessons in this range.</p>
            )}
          </div>
        </article>

        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Reminder Queue</span>
            <h2>Copy-ready</h2>
          </header>
          <div className="business-list">
            {surface?.reminders.length ? (
              surface.reminders.map((reminder) => (
                <article
                  key={`${reminder.studentId}-${reminder.type}-${reminder.lessonId ?? 'none'}`}
                  className="business-note"
                >
                  <strong>{reminder.studentName}</strong>
                  <span>{reminder.title}</span>
                  {reminder.lessonSummary ? (
                    <small>
                      {formatReminderLessonDetail(
                        reminder.lessonSummary,
                        surface?.settings.timezone,
                      )}
                    </small>
                  ) : null}
                  {reminder.actionIntent === 'complete_lesson_and_start_assignment' &&
                  reminder.lessonId ? (
                    <div className="business-actions">
                      <button
                        type="button"
                        aria-label="Add homework from reminder"
                        disabled={savingLessonId === reminder.lessonId}
                        onClick={() => void runStartHomeworkFromReminder(reminder)}
                      >
                        Add homework
                      </button>
                      <button
                        type="button"
                        disabled={savingLessonId === reminder.lessonId}
                        onClick={() => void runHideReminder(reminder)}
                      >
                        Hide
                      </button>
                    </div>
                  ) : (
                    <textarea
                      aria-label={`Reminder copy for ${reminder.studentName}`}
                      readOnly
                      value={reminder.copyText}
                    />
                  )}
                </article>
              ))
            ) : (
              <p className="business-muted">No open follow-ups.</p>
            )}
            {surface?.latestHiddenReminder ? (
              <div className="business-hidden-reminder">
                <span>
                  Hidden:{' '}
                  {formatReminderLessonDetail(
                    surface.latestHiddenReminder.lessonSummary,
                    surface.settings.timezone,
                  )}
                </span>
                <button
                  type="button"
                  disabled={savingLessonId === surface.latestHiddenReminder.lessonId}
                  onClick={() => void runUndoHiddenReminder()}
                >
                  Undo hide
                </button>
              </div>
            ) : null}
          </div>
        </article>

        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Credit alerts</span>
            <h2>Needs action</h2>
          </header>
          <div className="business-list">
            {surface?.creditAlerts.length ? (
              surface.creditAlerts.map((alert) => (
                <Link
                  key={alert.studentId}
                  className={`business-alert business-alert-${alert.severity}`}
                  to={alert.studentScheduleBillingPath}
                >
                  <strong>{alert.studentName}</strong>
                  <span>
                    {alert.remainingCredits} credits · {alert.upcomingChargeableLessons} upcoming
                  </span>
                </Link>
              ))
            ) : (
              <p className="business-muted">No credit alerts.</p>
            )}
          </div>
        </article>

        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Recent Payments</span>
            <h2>Recorded</h2>
          </header>
          <div className="business-list">
            {surface?.recentPayments.length ? (
              surface.recentPayments.map((payment) => (
                <Link
                  key={`${payment.studentId}-${payment.receivedAt}-${payment.amountMinor}`}
                  className="business-list-row"
                  to={payment.studentScheduleBillingPath}
                >
                  <div>
                    <strong>{payment.studentName}</strong>
                    <span>{formatDate(payment.receivedAt)}</span>
                  </div>
                  <b>{formatMoney(payment.amountMinor, payment.currency)}</b>
                </Link>
              ))
            ) : (
              <p className="business-muted">No recent payments.</p>
            )}
          </div>
        </article>
      </div>
    </section>
  );
};

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <article className="business-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
