import {
  CalendarDays,
  ChartNoAxesCombined,
  FileText,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Users,
  X,
} from 'lucide-react';
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
  useLocation,
  useNavigate,
} from 'react-router-dom';

import type { User } from '../../context/AuthContext';
import { LegalLinks } from '../LegalLinks';
import {
  AssignmentNavigationGuardContext,
  type NavigationGuard,
  type NavigationGuardRegistration,
} from './assignment-navigation-guard';

import './CalmStudioShell.css';

export interface CalmStudioShellProps {
  user: User;
  onLogout: () => void;
  logoutError?: string | null;
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
    void guard(blocker.location.pathname).then((allowed) => {
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
  logoutError,
  children,
}: CalmStudioShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [railExpanded, setRailExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem('workspace-rail-expanded');
      if (saved !== null) return saved === 'true';
    } catch {
      /* Storage is optional. */
    }
    return window.innerWidth > 900;
  });
  const isStudents = useLocation().pathname.startsWith('/students');
  const toggleRail = () =>
    setRailExpanded((current) => {
      try {
        localStorage.setItem('workspace-rail-expanded', String(!current));
      } catch {
        /* Storage is optional. */
      }
      return !current;
    });
  useEffect(() => {
    const media = window.matchMedia?.('(max-width:900px)');
    if (!media) return;
    const respond = () => {
      try {
        if (localStorage.getItem('workspace-rail-expanded') !== null) return;
      } catch {
        /* Use responsive default. */
      }
      setRailExpanded(!media.matches);
    };
    media.addEventListener('change', respond);
    return () => media.removeEventListener('change', respond);
  }, []);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMenu = () => {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  };
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
      void guard(to).then((allowed) => {
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
      <div
        className={`calm-shell${menuOpen ? ' calm-shell--menu-open' : ''}${railExpanded ? '' : ' calm-shell--collapsed'}${isStudents ? ' calm-shell--students' : ''}`}
      >
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
            ref={menuButtonRef}
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

        <aside
          className="calm-shell__rail"
          id="workspace-navigation"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && menuOpen) closeMenu();
          }}
        >
          <div className="calm-shell__brand">
            <strong>ESL Pipeline</strong>
            <button
              className="calm-shell__rail-toggle"
              type="button"
              aria-label={
                menuOpen
                  ? 'Close workspace menu'
                  : railExpanded
                    ? 'Collapse main navigation'
                    : 'Expand main navigation'
              }
              title={
                menuOpen
                  ? 'Close workspace menu'
                  : railExpanded
                    ? 'Collapse main navigation'
                    : 'Expand main navigation'
              }
              aria-expanded={railExpanded}
              onClick={menuOpen ? closeMenu : toggleRail}
            >
              {menuOpen ? (
                <X size={19} aria-hidden="true" />
              ) : railExpanded ? (
                <PanelLeftClose size={19} aria-hidden="true" />
              ) : (
                <PanelLeftOpen size={19} aria-hidden="true" />
              )}
            </button>
          </div>
          <nav className="calm-shell__nav" aria-label="Workspace">
            <p className="calm-shell__nav-label">Workspace</p>
            {workspaceLinks.map(({ to, label, icon: Icon, ...linkProps }) => (
              <NavLink
                key={to}
                to={to}
                aria-label={label}
                title={label}
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
                aria-label="Prompts"
                title="Prompts"
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
            <LegalLinks />
            {sandboxMode ? (
              <span className="calm-shell__sandbox" aria-label="Frontend sandbox mode">
                Mock data
              </span>
            ) : null}
            <span className="calm-shell__rail-email" translate="no">
              {user.email}
            </span>
            <button
              type="button"
              className="calm-shell__logout"
              aria-label="Logout"
              title="Logout"
              onClick={handleLogout}
            >
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
            onClick={closeMenu}
          />
        ) : null}

        <main id="main-content" className="calm-shell__main" tabIndex={-1}>
          {logoutError && (
            <p role="alert" className="calm-shell__logout-error">
              {logoutError}
            </p>
          )}
          {children ?? <Outlet />}
        </main>
      </div>
    </AssignmentNavigationGuardContext.Provider>
  );
}
