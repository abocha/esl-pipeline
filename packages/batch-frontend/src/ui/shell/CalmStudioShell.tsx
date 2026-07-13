import { CalendarDays, ChartNoAxesCombined, FileText, LogOut, Menu, Users, X } from 'lucide-react';
import React, { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import type { User } from '../../context/AuthContext';

import './CalmStudioShell.css';

export interface CalmStudioShellProps {
  user: User;
  onLogout: () => void;
  sandboxMode?: boolean;
  children?: React.ReactNode;
}

const workspaceLinks = [
  { to: '/', label: 'Assignments', icon: CalendarDays, end: true },
  { to: '/students', label: 'Students', icon: Users },
  { to: '/business', label: 'Business', icon: ChartNoAxesCombined },
  { to: '/prompts', label: 'Assignment Templates', icon: FileText },
] as const;

export function CalmStudioShell({
  user,
  onLogout,
  sandboxMode = false,
  children,
}: CalmStudioShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={`calm-shell${menuOpen ? ' calm-shell--menu-open' : ''}`}>
      <a
        className="calm-shell__skip"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to main content
      </a>

      <header className="calm-shell__topbar">
        <button
          className="calm-shell__menu-button"
          type="button"
          aria-label={menuOpen ? 'Close workspace menu' : 'Open workspace menu'}
          aria-expanded={menuOpen}
          aria-controls="workspace-navigation"
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
        </button>
        <div className="calm-shell__mobile-brand">
          <span className="calm-shell__mark calm-shell__mark--compact" aria-hidden="true" />
          <strong>ESL Pipeline</strong>
        </div>
      </header>

      <aside className="calm-shell__rail" id="workspace-navigation">
        <div className="calm-shell__brand">
          <span className="calm-shell__mark" aria-hidden="true">
            ESL
          </span>
          <span>
            <strong>ESL Pipeline</strong>
            <small>Teaching workspace</small>
          </span>
        </div>
        <nav className="calm-shell__nav" aria-label="Workspace">
          <p className="calm-shell__nav-label">Workspace</p>
          {workspaceLinks.map(({ to, label, icon: Icon, ...linkProps }) => (
            <NavLink
              key={to}
              to={to}
              {...linkProps}
              className={({ isActive }) =>
                `calm-shell__nav-link${isActive ? ' calm-shell__nav-link--active' : ''}`
              }
              onClick={() => setMenuOpen(false)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="calm-shell__rail-footer">
          {sandboxMode ? (
            <span className="calm-shell__sandbox" aria-label="Frontend sandbox mode">
              Mock data
            </span>
          ) : null}
          <span className="calm-shell__rail-email" translate="no">
            {user.email}
          </span>
          <button type="button" className="calm-shell__logout" onClick={onLogout}>
            <LogOut aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {menuOpen ? (
        <button
          type="button"
          className="calm-shell__scrim"
          aria-label="Close workspace menu"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <main id="main-content" className="calm-shell__main" tabIndex={-1}>
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
