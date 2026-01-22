import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useNotification } from '../../context/NotificationContext';
import { Icons } from '../shared/Icons';

/**
 * GlobalNotificationDrawer - A lightweight notification drawer accessible from all pages.
 * 
 * Features:
 * - Bell icon trigger
 * - Slide-in drawer with log entries
 * - Clear button
 * - Keyboard accessible (Esc to close, focus management)
 * - Click-outside to close
 * - Prevents background scroll when open
 */
export const GlobalNotificationDrawer: React.FC = () => {
  const { logEntries, clearLog } = useNotification();
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const handleOpen = useCallback(() => {
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    // Return focus to trigger button
    triggerRef.current?.focus();
  }, []);

  // Handle Esc key to close
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        drawerRef.current &&
        !drawerRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, handleClose]);

  // Prevent background scroll when open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTypeClass = (type: string) => {
    switch (type) {
      case 'error': {
        return 'entry-error';
      }
      case 'success': {
        return 'entry-success';
      }
      default: {
        return 'entry-default';
      }
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="notification-trigger"
        onClick={handleOpen}
        aria-label="Open notifications"
        aria-expanded={isOpen}
        aria-controls="notification-drawer"
      >
        <Icons.Bell />
        {logEntries.length > 0 && (
          <span className="notification-badge">{logEntries.length}</span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="drawer-backdrop" onClick={handleClose} />
          <div
            ref={drawerRef}
            id="notification-drawer"
            className="notification-drawer"
            role="dialog"
            aria-label="Notifications"
            aria-modal="true"
          >
            <div className="drawer-header">
              <h3>Notifications</h3>
              <button
                type="button"
                className="drawer-close"
                onClick={handleClose}
                aria-label="Close notifications"
              >
                <Icons.XMark />
              </button>
            </div>

            <div className="drawer-content">
              {logEntries.length === 0 ? (
                <p className="empty-state">No notifications yet.</p>
              ) : (
                <ul className="notification-list">
                  {logEntries.map((entry, index) => (
                    <li key={`${entry.createdAt}-${index}`} className={`notification-entry ${getTypeClass(entry.type)}`}>
                      <span className="entry-time">{formatTime(entry.createdAt)}</span>
                      <span className="entry-message">{entry.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {logEntries.length > 0 && (
              <div className="drawer-footer">
                <button type="button" className="btn-secondary btn-small" onClick={clearLog}>
                  Clear all
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <style>{`
        .notification-trigger {
          position: relative;
          background: transparent;
          border: none;
          padding: var(--space-2);
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--radius-md);
          transition: color var(--transition-fast), background var(--transition-fast);
        }

        .notification-trigger:hover {
          color: var(--text-primary);
          background: var(--bg-secondary);
        }

        .notification-trigger svg {
          width: 20px;
          height: 20px;
        }

        .notification-badge {
          position: absolute;
          top: 0;
          right: 0;
          min-width: 16px;
          height: 16px;
          background: var(--color-error-500);
          color: white;
          font-size: 10px;
          font-weight: 600;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0 4px;
        }

        .drawer-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.3);
          z-index: 998;
        }

        .notification-drawer {
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          width: 320px;
          max-width: 90vw;
          background: var(--bg-primary);
          border-left: 1px solid var(--border-light);
          z-index: 999;
          display: flex;
          flex-direction: column;
          animation: slideIn 0.2s ease-out;
        }

        @keyframes slideIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }

        .drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-4);
          border-bottom: 1px solid var(--border-light);
        }

        .drawer-header h3 {
          margin: 0;
          font-size: var(--text-base);
        }

        .drawer-close {
          background: transparent;
          border: none;
          padding: var(--space-1);
          cursor: pointer;
          color: var(--text-secondary);
          border-radius: var(--radius-sm);
        }

        .drawer-close:hover {
          color: var(--text-primary);
          background: var(--bg-secondary);
        }

        .drawer-close svg {
          width: 20px;
          height: 20px;
        }

        .drawer-content {
          flex: 1;
          overflow-y: auto;
          padding: var(--space-2);
        }

        .empty-state {
          text-align: center;
          color: var(--text-tertiary);
          padding: var(--space-6);
        }

        .notification-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .notification-entry {
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-md);
          display: flex;
          flex-direction: column;
          gap: var(--space-1);
        }

        .entry-error {
          background: rgba(239, 68, 68, 0.05);
          border-left: 2px solid var(--color-error-500);
        }

        .entry-success {
          background: rgba(34, 197, 94, 0.05);
          border-left: 2px solid var(--color-success-500);
        }

        .entry-default {
          background: var(--bg-secondary);
          border-left: 2px solid var(--border-medium);
        }

        .entry-time {
          font-size: var(--text-xs);
          color: var(--text-tertiary);
        }

        .entry-message {
          font-size: var(--text-sm);
          color: var(--text-primary);
        }

        .drawer-footer {
          padding: var(--space-3);
          border-top: 1px solid var(--border-light);
        }
      `}</style>
    </>
  );
};
