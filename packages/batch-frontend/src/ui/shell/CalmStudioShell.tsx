import { CalendarDays, ChartNoAxesCombined, FileText, LogOut, Menu, Users, X } from 'lucide-react';
import React, {
  type MouseEvent,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  NavLink,
  Outlet,
  UNSAFE_DataRouterContext,
  useBlocker,
  useNavigate,
} from 'react-router-dom';

import type { User } from '../../context/AuthContext';
import {
  AssignmentNavigationGuardContext,
  type NavigationGuard,
  type NavigationGuardRegistration,
} from './assignment-navigation-guard';

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
] as const;

function AssignmentRouterNavigationBlocker({
  guardRef,
}: {
  guardRef: RefObject<NavigationGuard | null>;
}) {
  const blocker = useBlocker(() => guardRef.current !== null);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    const guard = guardRef.current;
    if (!guard) {
      blocker.proceed();
      return;
    }
    let active = true;
    void guard().then((allowed) => {
      if (!active) return;
      if (allowed) blocker.proceed();
      else blocker.reset();
    });
    return () => {
      active = false;
    };
  }, [blocker, guardRef]);

  return null;
}

export function CalmStudioShell({
  user,
  onLogout,
  sandboxMode = false,
  children,
}: CalmStudioShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const dataRouterContext = useContext(UNSAFE_DataRouterContext);
  const navigationGuardRef = useRef<NavigationGuard | null>(null);
  const registerNavigationGuard = useCallback<NavigationGuardRegistration>((guard) => {
    navigationGuardRef.current = guard;
  }, []);
  const navigationGuardContextValue = useMemo(
    () => registerNavigationGuard,
    [registerNavigationGuard],
  );
  const handleWorkspaceNavigation = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, to: string) => {
      setMenuOpen(false);
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      if (dataRouterContext) return;
      const guard = navigationGuardRef.current;
      if (!guard) return;
      event.preventDefault();
      void guard().then((allowed) => {
        if (allowed) navigate(to);
      });
    },
    [dataRouterContext, navigate],
  );

  const handleLogout = useCallback(() => {
    const guard = navigationGuardRef.current;
    if (!guard) {
      onLogout();
      return;
    }
    void guard().then((allowed) => {
      if (allowed) onLogout();
    });
  }, [onLogout]);

  return (
    <AssignmentNavigationGuardContext.Provider value={navigationGuardContextValue}>
      {dataRouterContext ? (
        <AssignmentRouterNavigationBlocker guardRef={navigationGuardRef} />
      ) : null}
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
                onClick={(event) => handleWorkspaceNavigation(event, to)}
              >
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          {user.role === 'admin' ? (
            <nav className="calm-shell__nav" aria-label="Administration">
              <p className="calm-shell__nav-label">Administration</p>
              <NavLink
                to="/admin/prompts"
                className={({ isActive }) =>
                  `calm-shell__nav-link${isActive ? ' calm-shell__nav-link--active' : ''}`
                }
                onClick={(event) => handleWorkspaceNavigation(event, '/admin/prompts')}
              >
                <FileText aria-hidden="true" />
                <span>Prompts</span>
              </NavLink>
            </nav>
          ) : null}
          <div className="calm-shell__rail-footer">
            {sandboxMode ? (
              <span className="calm-shell__sandbox" aria-label="Frontend sandbox mode">
                Mock data
              </span>
            ) : null}
            <span className="calm-shell__rail-email" translate="no">
              {user.email}
            </span>
            <button type="button" className="calm-shell__logout" onClick={handleLogout}>
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
    </AssignmentNavigationGuardContext.Provider>
  );
}
