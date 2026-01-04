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
  const { permission, requestPermission, disableNotifications } = useNotification();
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
      `}</style>
    </section>
  );
};
