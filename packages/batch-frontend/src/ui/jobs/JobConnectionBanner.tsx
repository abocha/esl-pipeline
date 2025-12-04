import React from 'react';

import { useJobMonitor } from '../../context/JobMonitorContext';

// Icons
const WifiIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12.55a11 11 0 0 1 14.08 0" />
    <path d="M1.42 9a16 16 0 0 1 21.16 0" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

const WifiOffIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
    <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
    <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
    <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
    <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
    <line x1="12" y1="20" x2="12.01" y2="20" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

export const JobConnectionBanner: React.FC = () => {
  const { liveUpdatesPaused, connectionState, resumeLiveUpdates, lastError } = useJobMonitor();

  // Show nothing if connected and updates are live
  const isConnected = connectionState === 'connected';
  if (isConnected && !liveUpdatesPaused) {
    return null;
  }

  const isDisconnected = connectionState === 'error' || connectionState === 'reconnecting';

  return (
    <div className={`connection-banner ${isDisconnected ? 'disconnected' : 'paused'}`}>
      <div className="banner-icon">
        {isDisconnected ? <WifiOffIcon /> : <WifiIcon />}
      </div>
      <div className="banner-content">
        <span className="banner-title">
          {isDisconnected ? 'Connection lost' : 'Live updates paused'}
        </span>
        <span className="banner-desc">
          {isDisconnected
            ? lastError || 'Trying to reconnect to the server…'
            : 'Click resume to start receiving live updates again'}
        </span>
      </div>
      {!isDisconnected && (
        <button type="button" onClick={resumeLiveUpdates} className="banner-action">
          <RefreshIcon />
          Resume
        </button>
      )}

      <style>{`
        .connection-banner {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-4);
          border-radius: var(--radius-xl);
          animation: fadeInDown 0.3s ease-out;
        }

        .connection-banner.disconnected {
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.3);
        }

        .connection-banner.paused {
          background: rgba(245, 158, 11, 0.1);
          border: 1px solid rgba(245, 158, 11, 0.3);
        }

        .banner-icon {
          width: 36px;
          height: 36px;
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .connection-banner.disconnected .banner-icon {
          background: rgba(244, 63, 94, 0.15);
          color: var(--color-error-500);
        }

        .connection-banner.paused .banner-icon {
          background: rgba(245, 158, 11, 0.15);
          color: var(--color-warning-600);
        }

        .banner-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .banner-title {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .banner-desc {
          font-size: var(--text-xs);
          color: var(--text-secondary);
        }

        .banner-action {
          display: flex;
          align-items: center;
          gap: var(--space-1);
          padding: var(--space-2) var(--space-3);
          background: var(--color-warning-500);
          border: none;
          border-radius: var(--radius-full);
          color: white;
          font-size: var(--text-xs);
          font-weight: 600;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .banner-action:hover {
          background: var(--color-warning-600);
          transform: translateY(-1px);
        }
      `}</style>
    </div>
  );
};
