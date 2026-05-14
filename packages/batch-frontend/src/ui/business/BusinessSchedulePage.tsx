import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import {
  type BusinessScheduleSurface,
  getBusinessScheduleSurface,
  updateStudentLesson,
} from '../../utils/api';
import {
  addDaysInput,
  formatDate,
  formatDateTime,
  formatMoney,
  todayInput,
} from './business-format';

export const BusinessSchedulePage: React.FC = () => {
  const [from, setFrom] = useState(todayInput);
  const [to, setTo] = useState(() => addDaysInput(7));
  const [surface, setSurface] = useState<BusinessScheduleSurface | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingLessonId, setSavingLessonId] = useState<string | null>(null);
  const latestLoadRequestRef = useRef(0);

  const load = useCallback(
    async (range = { from, to }) => {
      const requestId = latestLoadRequestRef.current + 1;
      latestLoadRequestRef.current = requestId;
      setLoading(true);
      setError(null);
      try {
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
    },
    [from, to],
  );

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
      await load({ from, to });
    } catch (actionError: unknown) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to update lesson.');
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
          void load({ from, to });
        }}
      >
        <label>
          From
          <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <button type="submit">Refresh</button>
      </form>

      <div className="business-metric-grid">
        <Metric label="Today" value={String(surface?.today.length ?? 0)} detail="lessons" />
        <Metric label="Agenda" value={String(surface?.lessons.length ?? 0)} detail="in range" />
        <Metric
          label="Reminders"
          value={String(surface?.reminders.length ?? 0)}
          detail="ready to send"
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
            <span className="business-dashboard-kicker">Week Agenda</span>
            <h2>Lessons</h2>
          </header>
          <div className="business-list">
            {surface?.lessons.length ? (
              surface.lessons.map((lesson) => (
                <article key={lesson.id} className="business-list-row">
                  <div>
                    <strong>{lesson.studentName}</strong>
                    <span>
                      {formatDateTime(lesson.startsAt)} · {lesson.durationMinutes} min ·{' '}
                      {lesson.status}
                    </span>
                  </div>
                  <div className="business-actions">
                    <Link to={lesson.studentScheduleBillingPath}>Open</Link>
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
                <article key={`${reminder.studentId}-${reminder.type}`} className="business-note">
                  <strong>{reminder.studentName}</strong>
                  <span>{reminder.title}</span>
                  <textarea readOnly value={reminder.copyText} />
                </article>
              ))
            ) : (
              <p className="business-muted">No reminders ready.</p>
            )}
          </div>
        </article>

        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Payment And Credit Alerts</span>
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
