import React, { ReactNode, useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import type { User } from '../context/AuthContext';
import { useViewport } from '../utils/useViewport';

const RAIL_STORAGE_KEY = 'esl-right-rail-state';

type RailState = 'pinned' | 'peek';

interface WorkshopShellProps {
  user: User;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenProfile: () => void;
  onLogout: () => void;
  children: ReactNode;
}

const SunIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="5" />
    <line x1="12" y1="1" x2="12" y2="3" />
    <line x1="12" y1="21" x2="12" y2="23" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="1" y1="12" x2="3" y2="12" />
    <line x1="21" y1="12" x2="23" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const MoonIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SettingsIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const LogoutIcon = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
);

const getInitialRailState = (): RailState => {
  if (globalThis.window === undefined) return 'pinned';
  const stored = sessionStorage.getItem(RAIL_STORAGE_KEY);
  if (stored === 'pinned' || stored === 'peek') return stored;
  return 'peek';
};

export const WorkshopShell: React.FC<WorkshopShellProps> = ({
  user,
  theme,
  onToggleTheme,
  onOpenProfile,
  onLogout,
  children,
}) => {
  const viewport = useViewport();
  const navigate = useNavigate();
  const [railState, setRailState] = useState<RailState>(getInitialRailState);
  const [railOpen, setRailOpen] = useState(false);

  useEffect(() => {
    sessionStorage.setItem(RAIL_STORAGE_KEY, railState);
  }, [railState]);

  const isMobile = viewport === 'mobile';
  const isTablet = viewport === 'tablet';
  const effectiveRailOpen = isMobile ? railOpen : false;

  const railToggleLabel = railState === 'pinned' ? 'Peek' : 'Pin';

  const handleQuickCreate = () => {
    void navigate('/wizard');
  };

  const handleLogout = () => {
    void onLogout();
  };

  const navItems = useMemo(
    () => [
      { label: 'Dashboard', to: '/' },
      { label: 'Wizard', to: '/wizard' },
      { label: 'Students', to: '/students' },
      { label: 'Jobs', to: '/jobs' },
      { label: 'Settings', to: '/settings' },
    ],
    [],
  );

  return (
    <div
      className="workshop-shell"
      data-viewport={viewport}
      data-rail={railState}
      data-rail-open={effectiveRailOpen ? 'true' : 'false'}
    >
      <aside className="left-rail" aria-label="Primary navigation">
        <div className="rail-brand">
          <div className="rail-mark">
            <span aria-hidden="true">ES</span>
          </div>
          <div className="rail-titles">
            <span className="rail-eyebrow">ESL Pipeline</span>
            <h1 className="rail-title">Workshop Console</h1>
          </div>
        </div>

        <div className="rail-search">
          <input
            type="search"
            placeholder="Search jobs, students, recordings"
            aria-label="Global search"
          />
        </div>

        <nav className="rail-nav">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className="rail-link">
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="rail-actions">
          <button type="button" className="btn-primary" onClick={handleQuickCreate}>
            New assignment
          </button>
          <button type="button" className="btn-secondary" onClick={() => navigate('/jobs')}>
            View jobs
          </button>
        </div>

        <div className="rail-footer">
          <div className="rail-user">
            <span>{user.email}</span>
            <span>{user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Viewer' : 'Tutor'}</span>
          </div>
          <div className="rail-controls">
            <button
              type="button"
              onClick={onToggleTheme}
              className="rail-icon-button"
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>
            <button
              type="button"
              onClick={onOpenProfile}
              className="rail-icon-button"
              title="Profile Settings"
              aria-label="Profile Settings"
            >
              <SettingsIcon />
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="rail-icon-button"
              title="Logout"
              aria-label="Logout"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </aside>

      <main className="center-workspace">{children}</main>

      <aside className="right-rail" aria-label="Work context and ledger">
        <div className="right-rail-header">
          <div className="right-rail-title">
            <span className="rail-eyebrow">Work context</span>
            <h2>Context & Ledger</h2>
          </div>
          {isTablet && (
            <button
              type="button"
              className="right-rail-toggle"
              onClick={() => setRailState((prev) => (prev === 'pinned' ? 'peek' : 'pinned'))}
              aria-pressed={railState === 'pinned'}
            >
              {railToggleLabel}
            </button>
          )}
          {isMobile && (
            <button
              type="button"
              className="right-rail-toggle"
              onClick={() => setRailOpen(false)}
            >
              Close
            </button>
          )}
        </div>

        <div className="rail-peek">
          <span>Context</span>
          <span>Ledger</span>
        </div>

        <div className="rail-content">
          <section className="rail-panel">
            <h3>Work Context</h3>
            <p>Select a job or wizard step to keep context visible at all times.</p>
          </section>
          <section className="rail-panel">
            <h3>Notification Ledger</h3>
            <p>Events and failures will appear here once live updates are connected.</p>
          </section>
        </div>
      </aside>

      {isMobile && (
        <>
          {effectiveRailOpen && (
            <button
              type="button"
              className="rail-backdrop"
              aria-label="Close context panel"
              onClick={() => setRailOpen(false)}
            />
          )}
          {!effectiveRailOpen && (
            <button
              type="button"
              className="rail-fab"
              onClick={() => setRailOpen(true)}
              aria-label="Open context and ledger"
            >
              Context & Ledger
            </button>
          )}
        </>
      )}
    </div>
  );
};
