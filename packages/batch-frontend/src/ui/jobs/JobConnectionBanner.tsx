import React from 'react';
import { useJobMonitor } from '../../context/JobMonitorContext';

const stateStyles: Record<
  ReturnType<typeof useJobMonitor>['connectionState'],
  { label: string; color: string }
> = {
  idle: { label: 'Setting up live updates…', color: '#94a3b8' },
  connecting: { label: 'Connecting to live updates…', color: '#0ea5e9' },
  connected: { label: 'Live updates active', color: '#16a34a' },
  error: { label: 'Live updates offline', color: '#dc2626' },
  reconnecting: { label: 'Reconnecting…', color: '#f97316' },
};

export const JobConnectionBanner: React.FC = () => {
  const { connectionState, isPolling, lastError } = useJobMonitor();
  const style = stateStyles[connectionState] ?? stateStyles.idle;

  return (
    <section style={bannerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ ...statusDotStyle, backgroundColor: style.color }} />
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: style.color }}>{style.label}</p>
          {isPolling ? (
            <p style={subtitleStyle}>Falling back to 5s polling while the SSE connection recovers.</p>
          ) : (
            <p style={subtitleStyle}>Job rows will update instantly as events stream in.</p>
          )}
        </div>
      </div>
      {lastError && (
        <p style={{ ...subtitleStyle, color: '#dc2626', marginTop: '6px' }}>
          {lastError}
        </p>
      )}
    </section>
  );
};

const bannerStyle: React.CSSProperties = {
  background: '#f8fafc',
  border: '1px solid #e2e8f0',
  borderRadius: '16px',
  padding: '16px 20px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
};

const statusDotStyle: React.CSSProperties = {
  width: '12px',
  height: '12px',
  borderRadius: '999px',
  display: 'inline-block',
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '13px',
  color: '#475569',
};
