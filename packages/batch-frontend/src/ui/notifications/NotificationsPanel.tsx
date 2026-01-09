import React from 'react';
import toast from 'react-hot-toast';

import { useNotification } from '../../context/NotificationContext';

const BellIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export const NotificationsPanel: React.FC = () => {
  const { permission, requestPermission, disableNotifications, logEntries, clearLog } =
    useNotification();
  const notificationsEnabled = permission === 'granted';
  const isSupported = typeof Notification !== 'undefined';

  const handleToggle = async () => {
    if (!isSupported) {
      toast.error('Browser notifications are not supported');
      return;
    }

    if (notificationsEnabled) {
      disableNotifications();
      toast('Notifications paused', { icon: '⏸️' });
      return;
    }

    const result = await requestPermission();
    if (result === 'granted') {
      toast.success('Notifications enabled!');
    } else if (result === 'denied') {
      toast.error('Notifications are blocked. Please enable them in your browser settings.');
    } else {
      toast.error('Notification permission not granted');
    }
  };

  return (
    <section className="notifications-panel card">
      <div className="notifications-header">
        <div className="notifications-icon">
          <BellIcon />
        </div>
        <div className="notifications-info">
          <h3>Notifications</h3>
          <p>Get notified when jobs complete</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleToggle()}
        className={`notifications-toggle ${notificationsEnabled ? 'active' : ''}`}
      >
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
        <span className="toggle-label">{notificationsEnabled ? 'Enabled' : 'Disabled'}</span>
      </button>

      <div className="notifications-log">
        <div className="log-header">
          <h4>Recent alerts</h4>
          {logEntries.length > 0 ? (
            <button type="button" className="log-clear" onClick={clearLog}>
              Clear
            </button>
          ) : null}
        </div>
        {logEntries.length > 0 ? (
          <ul>
            {logEntries.slice(0, 6).map((entry) => (
              <li key={entry.id} className={`log-entry ${entry.type}`}>
                <span className="log-dot" />
                <div className="log-body">
                  <span className="log-message">{entry.message}</span>
                  <span className="log-time">
                    {new Date(entry.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="log-empty">No alerts yet.</p>
        )}
      </div>

      <style>{`
        .notifications-panel {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .notifications-header {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .notifications-icon {
          width: 44px;
          height: 44px;
          background: var(--gradient-primary);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .notifications-info h3 {
          font-size: var(--text-base);
          margin: 0;
        }

        .notifications-info p {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
          margin: 0;
        }

        .notifications-toggle {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-4);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .notifications-toggle:hover {
          border-color: var(--border-medium);
        }

        .toggle-track {
          width: 44px;
          height: 24px;
          background: var(--color-gray-300);
          border-radius: var(--radius-full);
          position: relative;
          transition: background var(--transition-fast);
        }

        .notifications-toggle.active .toggle-track {
          background: var(--color-primary-500);
        }

        .toggle-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          transition: transform var(--transition-fast);
          box-shadow: var(--shadow-sm);
        }

        .notifications-toggle.active .toggle-thumb {
          transform: translateX(20px);
        }

        .toggle-label {
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--text-secondary);
        }

        .notifications-log {
          display: flex;
          flex-direction: column;
          gap: var(--space-3);
          border-top: 1px solid var(--border-light);
          padding-top: var(--space-3);
        }

        .log-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2);
        }

        .log-header h4 {
          margin: 0;
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .log-clear {
          border: none;
          background: transparent;
          color: var(--text-tertiary);
          font-size: var(--text-xs);
          cursor: pointer;
        }

        .log-clear:hover {
          color: var(--text-secondary);
        }

        .notifications-log ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .log-entry {
          display: flex;
          align-items: flex-start;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: var(--bg-secondary);
          border-radius: var(--radius-lg);
          border: 1px solid var(--border-light);
        }

        .log-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--color-gray-400);
          margin-top: 6px;
          flex-shrink: 0;
        }

        .log-entry.success .log-dot {
          background: var(--color-success-500);
        }

        .log-entry.error .log-dot {
          background: var(--color-error-500);
        }

        .log-entry.loading .log-dot {
          background: var(--color-warning-500);
        }

        .log-body {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .log-message {
          font-size: var(--text-xs);
          color: var(--text-primary);
        }

        .log-time {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .log-empty {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
          margin: 0;
        }
      `}</style>
    </section>
  );
};
