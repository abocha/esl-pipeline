import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { type BusinessStatsSurface, getBusinessStatsSurface } from '../../utils/api';
import { formatDateRange, formatHours, formatMoney } from './business-format';

export const BusinessStatsPage: React.FC = () => {
  const [monthOverride, setMonthOverride] = useState<string | undefined>();
  const [surface, setSurface] = useState<BusinessStatsSurface | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latestLoadRequestRef = useRef(0);
  const month = monthOverride ?? surface?.month ?? '';

  const load = useCallback(async () => {
    const requestId = latestLoadRequestRef.current + 1;
    latestLoadRequestRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const params = monthOverride === undefined ? {} : { month: monthOverride };
      const nextSurface = await getBusinessStatsSurface(params);
      if (latestLoadRequestRef.current !== requestId) return;
      setSurface(nextSurface);
    } catch (loadError: unknown) {
      if (latestLoadRequestRef.current !== requestId) return;
      setError(loadError instanceof Error ? loadError.message : 'Business stats failed.');
    } finally {
      if (latestLoadRequestRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [monthOverride]);

  useEffect(() => {
    void load();
    return () => {
      latestLoadRequestRef.current += 1;
    };
  }, [load]);

  if (loading && !surface) {
    return <section className="business-empty">Loading business stats...</section>;
  }

  const completedLessonValue =
    surface && surface.settings.defaultLessonRateMinor > 0
      ? formatMoney(surface.earnedMinor, surface.currency)
      : 'Set rate';
  const scheduledLessonValue =
    surface && surface.settings.defaultLessonRateMinor > 0
      ? formatMoney(surface.scheduledGrossMinor, surface.currency)
      : 'Set rate';
  const planningRange = surface
    ? formatDateRange(surface.forecastFrom, surface.forecastTo)
    : 'planning horizon';

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
          Month
          <input
            type="month"
            value={month}
            onChange={(event) => setMonthOverride(event.target.value)}
          />
        </label>
        <button type="submit">Refresh</button>
      </form>

      <div className="business-metric-grid">
        <Metric
          label="Recorded payments"
          value={surface ? formatMoney(surface.collectedMinor, surface.currency) : '-'}
          detail={`selected month · ${surface?.currency ?? 'configured currency'}`}
        />
        <Metric
          label="Completed lesson value"
          value={surface ? completedLessonValue : '-'}
          detail="selected month · chargeable lessons · workspace default rate"
        />
        <Metric
          label="Scheduled lesson value"
          value={surface ? scheduledLessonValue : '-'}
          detail={`future scheduled chargeable · ${planningRange} · workspace default rate`}
        />
        <Metric
          label="Taught"
          value={surface ? formatHours(surface.taughtMinutes) : '-'}
          detail={`selected month · ${surface?.completedLessons ?? 0} lessons`}
        />
      </div>

      {surface?.excludedCurrencies.length ? (
        <div className="business-warning-box">
          <strong>Excluded currencies from recorded payments</strong>
          {surface.excludedCurrencies.map((item) => (
            <span key={item.currency}>
              {formatMoney(item.amountMinor, item.currency)} across {item.paymentCount} payments
            </span>
          ))}
        </div>
      ) : null}
      <p className="business-muted">
        Lesson values are default-rate measures, not payment records, per-student/package pricing,
        or revenue projections.
      </p>

      <div className="business-dashboard-grid">
        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Workload</span>
            <h2>Lessons and hours</h2>
            <p className="business-muted">
              Planning horizon: {planningRange} · all future scheduled lessons
            </p>
          </header>
          <dl className="business-definition-list">
            <div>
              <dt>Taught hours</dt>
              <dd>{surface ? formatHours(surface.taughtMinutes) : '-'}</dd>
            </div>
            <div>
              <dt>Scheduled hours</dt>
              <dd>{surface ? formatHours(surface.scheduledMinutes) : '-'}</dd>
            </div>
            <div>
              <dt>No-shows / canceled</dt>
              <dd>
                {surface?.noShowLessons ?? 0} / {surface?.canceledLessons ?? 0}
              </dd>
            </div>
          </dl>
        </article>

        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Credit watch</span>
            <h2>Students nearing their credit threshold</h2>
          </header>
          <div className="business-list">
            {surface?.pipeline.length ? (
              surface.pipeline.map((item) => (
                <Link
                  key={item.studentId}
                  className={`business-alert business-alert-${item.severity}`}
                  to={item.studentScheduleBillingPath}
                >
                  <strong>{item.studentName}</strong>
                  <span>
                    {item.remainingCredits} credits · {item.upcomingChargeableLessons} upcoming
                  </span>
                </Link>
              ))
            ) : (
              <p className="business-muted">No students currently near their credit threshold.</p>
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
