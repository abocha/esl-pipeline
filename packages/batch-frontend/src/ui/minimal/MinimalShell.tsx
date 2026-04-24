import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import type { User } from '../../context/AuthContext';

interface MinimalShellProps {
  user: User;
  onLogout: () => void;
  children?: React.ReactNode;
}

export const MinimalShell: React.FC<MinimalShellProps> = ({ user, onLogout, children }) => {
  return (
    <div className="app-shell">
      <a
        className="app-skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to main content
      </a>
      <header className="app-header">
        <div className="app-brand">
          <div className="app-mark" aria-hidden="true">
            ES
          </div>
          <div className="app-brand-copy">
            <span className="app-kicker">Teaching Studio</span>
            <strong>ESL Pipeline</strong>
          </div>
        </div>
        <nav className="app-nav" aria-label="Primary">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
          >
            Assignments
          </NavLink>
          <NavLink
            to="/students"
            className={({ isActive }) => (isActive ? 'app-nav-link active' : 'app-nav-link')}
          >
            Students
          </NavLink>
        </nav>
        <div className="app-actions">
          <span className="app-user" translate="no">
            {user.email}
          </span>
          <button type="button" className="app-logout" onClick={onLogout}>
            Logout
          </button>
        </div>
      </header>
      <main id="main-content" className="app-main" tabIndex={-1}>
        {children ?? <Outlet />}
      </main>

      <style>{`
        .app-shell {
          position: relative;
          isolation: isolate;
          min-height: 100vh;
          overflow-x: clip;
          color: var(--app-ink);
          background: var(--app-paper);
        }

        .app-shell::before {
          content: '';
          position: fixed;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          background:
            radial-gradient(circle at 8% 0%, rgba(20, 63, 115, 0.08), transparent 36%),
            radial-gradient(circle at 92% 6%, rgba(49, 92, 58, 0.08), transparent 32%),
            linear-gradient(180deg, rgba(255, 253, 248, 0.64), rgba(244, 234, 219, 0.34));
        }

        .app-skip-link {
          position: fixed;
          top: calc(env(safe-area-inset-top) + 0.75rem);
          left: calc(env(safe-area-inset-left) + 0.75rem);
          z-index: var(--z-toast);
          transform: translateY(-160%);
          border-radius: var(--app-radius-sm);
          background: var(--app-blue);
          color: #fffaf1;
          padding: 0.7rem 0.95rem;
          font-weight: 800;
          transition: transform var(--transition-fast);
        }

        .app-skip-link:focus-visible {
          transform: translateY(0);
        }

        .app-header {
          position: sticky;
          top: 0;
          z-index: var(--z-sticky);
          display: grid;
          grid-template-columns: minmax(13rem, auto) minmax(0, 1fr) auto;
          align-items: center;
          gap: clamp(0.8rem, 2vw, 1.4rem);
          padding:
            calc(env(safe-area-inset-top) + 0.85rem)
            calc(env(safe-area-inset-right) + clamp(1rem, 3vw, 2rem))
            0.85rem
            calc(env(safe-area-inset-left) + clamp(1rem, 3vw, 2rem));
          border-bottom: 1px solid var(--app-line);
          background: var(--app-paper);
          box-shadow: 0 12px 34px rgba(42, 36, 26, 0.06);
        }

        .app-brand {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          min-width: 0;
        }

        .app-mark {
          width: 2.75rem;
          height: 2.75rem;
          flex: 0 0 auto;
          border: 1px solid rgba(20, 63, 115, 0.15);
          border-radius: 34% 66% 58% 42% / 42% 45% 55% 58%;
          display: grid;
          place-items: center;
          background:
            radial-gradient(circle at 34% 26%, rgba(255, 255, 255, 0.92), transparent 32%),
            linear-gradient(145deg, var(--app-paper-deep), var(--app-blue-soft));
          color: var(--app-blue);
          font-weight: 900;
          letter-spacing: 0.04em;
        }

        .app-brand-copy {
          display: grid;
          min-width: 0;
          gap: 0.05rem;
        }

        .app-brand-copy strong {
          color: var(--app-ink);
          font-family: var(--app-serif);
          font-size: clamp(1.25rem, 2vw, 1.65rem);
          font-weight: 600;
          line-height: 1;
          letter-spacing: -0.035em;
          text-wrap: balance;
        }

        .app-kicker {
          color: var(--app-blue);
          font-size: 0.68rem;
          font-weight: 850;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .app-nav {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          justify-content: center;
          gap: 0.55rem;
        }

        .app-nav-link,
        .app-logout {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 2.75rem;
          padding: 0.62rem 0.95rem;
          border: 1px solid var(--app-line);
          border-radius: 999px;
          background: rgba(255, 253, 248, 0.62);
          color: var(--app-ink);
          font-weight: 800;
          text-decoration: none;
          touch-action: manipulation;
          transition:
            background-color var(--transition-fast),
            border-color var(--transition-fast),
            color var(--transition-fast),
            transform var(--transition-fast);
        }

        .app-nav-link:hover,
        .app-logout:hover {
          transform: translateY(-1px);
        }

        .app-nav-link.active {
          border-color: transparent;
          background: var(--app-blue);
          color: #fffaf1;
        }

        .app-actions {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 0.75rem;
          min-width: 0;
          font-size: var(--text-sm);
        }

        .app-user {
          min-width: 0;
          max-width: min(24vw, 20rem);
          overflow: hidden;
          color: var(--app-muted);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .app-logout {
          background: rgba(255, 253, 248, 0.72);
          color: var(--app-ink);
          cursor: pointer;
        }

        .app-main {
          position: relative;
          z-index: 1;
          width: min(100%, 1440px);
          margin: 0 auto;
          padding:
            clamp(1.25rem, 3vw, 2.2rem)
            calc(env(safe-area-inset-right) + clamp(1rem, 3vw, 2rem))
            clamp(2rem, 5vw, 4rem)
            calc(env(safe-area-inset-left) + clamp(1rem, 3vw, 2rem));
        }

        @media (prefers-reduced-motion: reduce) {
          .app-skip-link,
          .app-nav-link,
          .app-logout {
            transition: none;
          }

          .app-nav-link:hover,
          .app-logout:hover {
            transform: none;
          }
        }

        @media (max-width: 820px) {
          .app-header {
            position: relative;
            grid-template-columns: 1fr;
            align-items: stretch;
          }

          .app-nav {
            justify-content: flex-start;
          }

          .app-actions {
            justify-content: space-between;
          }

          .app-user {
            max-width: 58vw;
          }
        }
      `}</style>
    </div>
  );
};
