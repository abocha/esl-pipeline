import React from 'react';
import { Link, Outlet } from 'react-router-dom';

import type { User } from '../../context/AuthContext';

interface MinimalShellProps {
  user: User;
  onLogout: () => void;
  children?: React.ReactNode;
}

export const MinimalShell: React.FC<MinimalShellProps> = ({ user, onLogout, children }) => {
  return (
    <div className="minimal-shell">
      <header className="minimal-header">
        <div className="minimal-brand">
          <div className="minimal-mark">ES</div>
          <div>
            <div className="minimal-title">ESL Pipeline</div>
            <div className="minimal-subtitle">Minimal Assignment Console</div>
          </div>
        </div>
        <div className="minimal-actions">
          <span className="minimal-user">{user.email}</span>
          <Link className="minimal-link" to="/dashboard">
            Legacy UI
          </Link>
          <button type="button" className="minimal-button" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>
      <main className="minimal-main">{children ?? <Outlet />}</main>

      <style>{`
        .minimal-shell {
          min-height: 100vh;
          background: var(--bg-page);
          color: var(--text-primary);
          display: flex;
          flex-direction: column;
        }

        .minimal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--space-4) var(--space-6);
          border-bottom: 1px solid var(--border-light);
          background: var(--bg-primary);
          gap: var(--space-4);
          flex-wrap: wrap;
        }

        .minimal-brand {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .minimal-mark {
          width: 40px;
          height: 40px;
          border-radius: 12px;
          display: grid;
          place-items: center;
          background: var(--color-primary-600);
          color: white;
          font-weight: 700;
          font-size: var(--text-sm);
        }

        .minimal-title {
          font-weight: 700;
          font-size: var(--text-base);
        }

        .minimal-subtitle {
          font-size: var(--text-xs);
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--text-tertiary);
        }

        .minimal-actions {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          flex-wrap: wrap;
          font-size: var(--text-sm);
        }

        .minimal-user {
          color: var(--text-tertiary);
        }

        .minimal-link {
          color: var(--color-primary-600);
          text-decoration: none;
          font-weight: 600;
        }

        .minimal-link:hover {
          text-decoration: underline;
        }

        .minimal-button {
          padding: var(--space-2) var(--space-4);
          border-radius: 999px;
          border: 1px solid var(--border-medium);
          background: var(--bg-secondary);
          font-size: var(--text-sm);
          cursor: pointer;
        }

        .minimal-main {
          flex: 1;
          padding: var(--space-6);
        }

        @media (max-width: 720px) {
          .minimal-main {
            padding: var(--space-4);
          }
        }
      `}</style>
    </div>
  );
};
