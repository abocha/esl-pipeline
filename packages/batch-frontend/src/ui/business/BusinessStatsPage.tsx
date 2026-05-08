import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { type BusinessStatsSurface, getBusinessStatsSurface } from '../../utils/api';
import { currentMonthInput, formatHours, formatMoney } from './business-format';

export const BusinessStatsPage: React.FC = () => {
  const [month, setMonth] = useState(currentMonthInput);
  const [surface, setSurface] = useState<BusinessStatsSurface | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextMonth = month) => {
      setLoading(true);
      setError(null);
      try {
        setSurface(await getBusinessStatsSurface({ month: nextMonth }));
      } catch (loadError: unknown) {
        setError(loadError instanceof Error ? loadError.message : 'Business stats failed.');
      } finally {
        setLoading(false);
      }
    },
    [month],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !surface) {
    return <section className="business-empty">Loading business stats...</section>;
  }

  const forecastValue =
    surface && surface.settings.defaultLessonRateMinor > 0
      ? formatMoney(surface.forecastMinor, surface.currency)
      : 'Set rate';

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
          void load(month);
        }}
      >
        <label>
          Month
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <button type="submit">Refresh</button>
      </form>

      <div className="business-metric-grid">
        <Metric
          label="Collected"
          value={surface ? formatMoney(surface.collectedMinor, surface.currency) : '-'}
          detail="recorded payments"
        />
        <Metric
          label="Earned"
          value={surface ? formatMoney(surface.earnedMinor, surface.currency) : '-'}
          detail="completed chargeable"
        />
        <Metric label="Forecast" value={forecastValue} detail="rolling horizon" />
        <Metric
          label="Taught"
          value={surface ? formatHours(surface.taughtMinutes) : '-'}
          detail={`${surface?.completedLessons ?? 0} lessons`}
        />
      </div>

      <div className="business-dashboard-grid">
        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Cashflow</span>
            <h2>{surface?.month ?? month}</h2>
          </header>
          <dl className="business-definition-list">
            <div>
              <dt>Received</dt>
              <dd>{surface ? formatMoney(surface.collectedMinor, surface.currency) : '-'}</dd>
            </div>
            <div>
              <dt>Scheduled gross</dt>
              <dd>{surface ? formatMoney(surface.scheduledGrossMinor, surface.currency) : '-'}</dd>
            </div>
            <div>
              <dt>Risk correction</dt>
              <dd>{surface ? formatMoney(surface.riskAdjustmentMinor, surface.currency) : '-'}</dd>
            </div>
          </dl>
          {surface?.excludedCurrencies.length ? (
            <div className="business-warning-box">
              <strong>Excluded currencies</strong>
              {surface.excludedCurrencies.map((item) => (
                <span key={item.currency}>
                  {formatMoney(item.amountMinor, item.currency)} across {item.paymentCount} payments
                </span>
              ))}
            </div>
          ) : null}
        </article>

        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Workload</span>
            <h2>Lessons and hours</h2>
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
            <span className="business-dashboard-kicker">Pipeline</span>
            <h2>Likely top-ups</h2>
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
              <p className="business-muted">No top-up pressure detected.</p>
            )}
          </div>
        </article>

        <article className="business-panel">
          <header>
            <span className="business-dashboard-kicker">Risk</span>
            <h2>Urgent items</h2>
          </header>
          <div className="business-list">
            {surface?.risks.length ? (
              surface.risks.map((item) => (
                <Link
                  key={item.studentId}
                  className="business-alert business-alert-urgent"
                  to={item.studentScheduleBillingPath}
                >
                  <strong>{item.studentName}</strong>
                  <span>{item.remainingCredits} credits remaining</span>
                </Link>
              ))
            ) : (
              <p className="business-muted">No urgent business risks.</p>
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
