import React from 'react';

import { useJobMonitor } from '../../context/JobMonitorContext';
import { useNotification } from '../../context/NotificationContext';

const connectionStyles = {
  idle: { label: 'Preparing live updates…', color: '#94a3b8' },
  connecting: { label: 'Connecting to live updates…', color: '#0ea5e9' },
  connected: { label: 'Live updates active', color: '#16a34a' },
  error: { label: 'Live updates offline', color: '#dc2626' },
  reconnecting: { label: 'Reconnecting…', color: '#f97316' },
} as const;

export const JobConnectionBanner: React.FC = () => {
  const { connectionState, isPolling, lastError } = useJobMonitor();
  const { permission, requestPermission } = useNotification();

  const showPermissionCta = permission === 'default';
  const stateInfo = connectionStyles[connectionState] ?? connectionStyles.idle;

  return (
    <section style={bannerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span style={{ ...statusDotStyle, backgroundColor: stateInfo.color }} />
        <div>
          <p style={{ margin: 0, fontWeight: 600, color: stateInfo.color }}>{stateInfo.label}</p>
          {isPolling ? (
            <p style={subtitleStyle}>
              Falling back to 5s polling while the SSE connection recovers.
            </p>
          ) : (
            <p style={subtitleStyle}>Job rows will update instantly as events stream in.</p>
          )}
        </div>
        {showPermissionCta && (
          <button
            type="button"
            onClick={() => void requestPermission()}
            style={permissionButtonStyle}
          >
            Enable notifications
          </button>
        )}
      </div>
      {permission === 'denied' && (
        <p style={{ ...subtitleStyle, color: '#dc2626', marginTop: '6px' }}>
          Notifications are blocked. Enable them in your browser to receive batch completion alerts.
        </p>
      )}
      {lastError && (
        <p style={{ ...subtitleStyle, color: '#dc2626', marginTop: '6px' }}>{lastError}</p>
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

const permissionButtonStyle: React.CSSProperties = {
  marginLeft: 'auto',
  border: 'none',
  borderRadius: '999px',
  padding: '8px 14px',
  fontSize: '13px',
  fontWeight: 600,
  background: 'linear-gradient(120deg, #4f46e5, #6366f1)',
  color: '#fff',
  cursor: 'pointer',
  boxShadow: '0 12px 24px rgba(79, 70, 229, 0.25)',
};
