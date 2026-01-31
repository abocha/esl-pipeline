import React, { useMemo, useState, useEffect } from 'react';

import { LedgerEntry, LedgerSeverity, useJobMonitor } from '../../context/JobMonitorContext';

const severityLabels: Record<LedgerSeverity, string> = {
  success: 'Success',
  warning: 'Warning',
  error: 'Error',
  info: 'Info',
};

const severityClass: Record<LedgerSeverity, string> = {
  success: 'ledger-severity-success',
  warning: 'ledger-severity-warning',
  error: 'ledger-severity-error',
  info: 'ledger-severity-info',
};

const formatTime = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const NotificationLedger: React.FC = () => {
  const { eventLog, connectionState, isPolling, lastUpdateAt, liveUpdatesPaused } = useJobMonitor();
  const [filters, setFilters] = useState<Record<LedgerSeverity, boolean>>({
    success: true,
    warning: true,
    error: true,
    info: true,
  });
  const [now, setNow] = useState(() => Date.now());
  const [mountedAt] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const filteredEvents = useMemo(
    () => eventLog.filter((entry) => filters[entry.severity]),
    [eventLog, filters],
  );

  const counts = useMemo(() => {
    const next: Record<LedgerSeverity, number> = {
      success: 0,
      warning: 0,
      error: 0,
      info: 0,
    };
    for (const entry of eventLog) {
      next[entry.severity] += 1;
    }
    return next;
  }, [eventLog]);

  const lastUpdateBase = lastUpdateAt ?? mountedAt;
  const isStale = isPolling && now - lastUpdateBase > 15000;

  let statusLabel = 'Live';
  let statusTone: LedgerSeverity = 'success';

  if (liveUpdatesPaused) {
    statusLabel = 'Paused';
    statusTone = 'warning';
  } else if (isPolling) {
    statusLabel = isStale ? 'Polling • Stale' : 'Polling fallback';
    statusTone = isStale ? 'error' : 'warning';
  } else if (connectionState === 'connecting' || connectionState === 'reconnecting') {
    statusLabel = 'Connecting';
    statusTone = 'info';
  } else if (connectionState === 'error') {
    statusLabel = 'Disconnected';
    statusTone = 'error';
  }

  return (
    <section className="rail-panel ledger-panel">
      <header className="ledger-header">
        <div>
          <h3>Notification Ledger</h3>
          <p className="ledger-subtitle">Session-only log until /events history is available.</p>
        </div>
        <div className={`ledger-status ${severityClass[statusTone]}`}>
          {statusLabel}
        </div>
      </header>

      <div className="ledger-filters" role="group" aria-label="Filter ledger by severity">
        {(Object.keys(severityLabels) as LedgerSeverity[]).map((severity) => (
          <button
            key={severity}
            type="button"
            className={`ledger-filter ${filters[severity] ? 'is-active' : ''} ${severityClass[severity]}`}
            onClick={() =>
              setFilters((prev) => ({
                ...prev,
                [severity]: !prev[severity],
              }))
            }
            aria-pressed={filters[severity]}
          >
            <span>{severityLabels[severity]}</span>
            <span className="ledger-count">{counts[severity]}</span>
          </button>
        ))}
      </div>

      <div className="ledger-feed">
        {filteredEvents.length === 0 ? (
          <div className="ledger-empty">
            <p>No activity yet. Live updates will populate this log.</p>
          </div>
        ) : (
          filteredEvents.map((entry) => <LedgerRow key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
};

const LedgerRow: React.FC<{ entry: LedgerEntry }> = ({ entry }) => {
  return (
    <div className="ledger-row">
      <div className={`ledger-dot ${severityClass[entry.severity]}`} />
      <div className="ledger-row-body">
        <div className="ledger-row-title">
          <span>{entry.message}</span>
        </div>
        <div className="ledger-row-meta">
          <span>{entry.objectType}</span>
          <span>•</span>
          <span>{entry.objectId}</span>
          <span>•</span>
          <span>{formatTime(entry.timestamp)}</span>
          <span>•</span>
          <span>{entry.source === 'sse' ? 'SSE' : 'Polling'}</span>
        </div>
      </div>
    </div>
  );
};
