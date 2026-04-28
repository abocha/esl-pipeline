import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import type { User } from '../../context/AuthContext';

import './MinimalShell.css';
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
    </div>
  );
};
