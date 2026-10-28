import { RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { useWorkspaceSettings, useWorkspaceTimezone } from '../../context/WorkspaceTimezoneContext';
import { type BusinessStatsSurface, getBusinessStatsSurface } from '../../utils/api';
import { normalizeTimezone } from '../../utils/timezones';
import { formatDateRange, formatHours, formatMoney } from './business-format';
export const BusinessStatsPage: React.FC = () => {
  const timezone = useWorkspaceTimezone();
  const { reconcileTimezone } = useWorkspaceSettings();
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
      await reconcileTimezone(nextSurface.settings.timezone);
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
  }, [monthOverride, timezone, reconcileTimezone]);
  useEffect(() => {
    void load();
    return () => {
      latestLoadRequestRef.current += 1;
    };
  }, [load]);
  if (
    (loading && !surface) ||
    (surface && timezone && normalizeTimezone(surface.settings.timezone) !== timezone)
  ) {
    return (
      <section className="business-dashboard-surface">
        <header className="business-agenda-heading">
          <h2>Stats</h2>
        </header>
        <p className="business-empty" role={error ? 'alert' : undefined}>
          {error ?? 'Loading business stats...'}
        </p>
        {error ? (
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        ) : null}
      </section>
    );
  }
  if (!surface) {
    return (
      <section className="business-dashboard-surface">
        <header className="business-agenda-heading">
          <h2>Stats</h2>
        </header>
        <div className="business-empty" role="alert">
          <p>{error ?? 'Stats unavailable.'}</p>
          <button type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      </section>
    );
  }
  const planningRange = formatDateRange(surface.forecastFrom, surface.forecastTo);
  const loadedMonth = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${surface.month}-01T00:00:00Z`));
  const retainedPeriodNotice = `Showing stats for ${loadedMonth}.`;
  return (
    <section className="business-dashboard-surface" aria-busy={loading}>
      <div className="business-agenda-heading">
        <h2>Stats</h2>
        <form
          className="business-period-picker business-month-picker"
          aria-label="Stats month"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            aria-label="Month"
            id="business-stats-month"
            name="month"
            type="month"
            value={month}
            onChange={(event) => setMonthOverride(event.target.value)}
          />
          <button
            type="submit"
            className="business-picker-action"
            aria-label="Refresh"
            title="Refresh stats"
            disabled={loading}
          >
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        </form>
      </div>
      {error ? (
        <p className="business-dashboard-error" role="alert">
          {error} {retainedPeriodNotice}
        </p>
      ) : month !== surface.month ? (
        <p className="business-muted" role="status">
          {retainedPeriodNotice}
        </p>
      ) : null}
      <dl className="business-monthly-facts">
        <div>
          <dt>Recorded payments</dt>
          <dd>{formatMoney(surface.collectedMinor, surface.currency)}</dd>
          <small>Includes archived students</small>
        </div>
        <div>
          <dt>Lessons taught</dt>
          <dd>{surface.completedLessons}</dd>
        </div>
        <div>
          <dt>Teaching time</dt>
          <dd>{formatHours(surface.taughtMinutes)}</dd>
        </div>
      </dl>
      {surface.excludedCurrencies.length ? (
        <div className="business-warning-box">
          <strong>Excluded currencies from recorded payments</strong>
          {surface.excludedCurrencies.map((item) => (
            <span key={item.currency}>
              {formatMoney(item.amountMinor, item.currency)} across {item.paymentCount} payments
            </span>
          ))}
        </div>
      ) : null}
      <dl className="business-definition-list">
        <div>
          <dt>No-shows</dt>
          <dd>{surface.noShowLessons}</dd>
        </div>
        <div>
          <dt>Canceled lessons</dt>
          <dd>{surface.canceledLessons}</dd>
        </div>
      </dl>
      <section className="business-followups">
        <header className="business-section-heading">
          <h2>Coming up</h2>
          <span className="business-period" title="Rolling planning horizon from today">
            {planningRange}
          </span>
        </header>
        <p className="business-workload">
          {surface.scheduledLessons} scheduled lessons{' '}
          <span>· {formatHours(surface.scheduledMinutes)}</span>
        </p>
        <details className="business-disclosure">
          <summary>
            Credit watch <span>{surface.pipeline.length}</span>
          </summary>
          <p className="business-muted">
            At or below the credit threshold now or after upcoming lessons. Credits are not amounts
            owed.
          </p>
          {surface.pipeline.map((item) => (
            <Link
              key={item.studentId}
              className="business-payment-row"
              to={item.studentScheduleBillingPath}
            >
              <strong>{item.studentName}</strong>
              <span>
                {item.remainingCredits} {item.remainingCredits === 1 ? 'credit' : 'credits'}
              </span>
              <span>{item.upcomingChargeableLessons} upcoming</span>
            </Link>
          ))}
          {!surface.pipeline.length ? (
            <p className="business-muted">No students currently near their credit threshold.</p>
          ) : null}
        </details>
      </section>
    </section>
  );
};
