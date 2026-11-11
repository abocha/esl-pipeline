import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { WorkspaceTimezoneProvider } from '../context/WorkspaceTimezoneContext';
import { isFrontendSandboxEnabled, readFrontendSandboxScenario } from '../dev/frontend-sandbox';
import type { AuthMode } from './auth/AuthDialog';
import { LegalLinks } from './LegalLinks';
import { CalmStudioShell } from './shell/CalmStudioShell';
import { StudioV2Provider, useStudioV2 } from './studio-v2/StudioV2Context';
import { LoadingPlaceholder, PageLoading } from './system/LoadingPlaceholder';
import './AppShell.css';

const CalmStudioV2 = import.meta.env.DEV
  ? lazy(() => import('../dev/calm-studio-v2/CalmStudioV2'))
  : null;

const AssignmentListPage = lazy(() => import('./studio-v2/AssignmentListPage'));
const DayPage = lazy(() => import('./studio-v2/DayPage'));
const StudentScheduleBillingLayout = lazy(async () => {
  const module = await import('./students/StudentScheduleBillingPage');
  return { default: module.StudentScheduleBillingLayout };
});

function hasAssignmentContext(search: string) {
  const params = new URLSearchParams(search);
  return ['sessionId', 'jobId', 'studentId', 'lessonId'].some((key) => params.has(key));
}

function AssignmentEntryRoute() {
  const v2 = useStudioV2();
  const { search } = useLocation();
  return v2 && !hasAssignmentContext(search) ? <AssignmentListPage /> : <MinimalAssignment />;
}

function StudentScheduleRedirect({ target }: { target: 'schedule' | 'schedule-billing' }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: `../${target}`, search, hash }} replace />;
}

const AuthDialog = lazy(async () => {
  const module = await import('./auth/AuthDialog');
  return { default: module.AuthDialog };
});

const MinimalAssignment = lazy(async () => {
  const module = await import('./minimal/MinimalAssignment');
  return { default: module.MinimalAssignment };
});

const StudentWorkspace = lazy(async () => {
  const module = await import('./students/StudentWorkspace');
  return { default: module.StudentWorkspace };
});

const StudentWorkspaceEmpty = lazy(async () => {
  const module = await import('./students/StudentWorkspace');
  return { default: module.StudentWorkspaceEmpty };
});

const StudentAreaShell = lazy(async () => {
  const module = await import('./students/StudentAreaShell');
  return { default: module.StudentAreaShell };
});

const StudentOverviewPage = lazy(async () => {
  const module = await import('./students/StudentOverviewPage');
  return { default: module.StudentOverviewPage };
});

const StudentLearningPage = lazy(async () => {
  const module = await import('./students/StudentLearningPage');
  return { default: module.StudentLearningPage };
});

const StudentHistoryPage = lazy(async () => {
  const module = await import('./students/StudentHistoryPage');
  return { default: module.StudentHistoryPage };
});

const StudentScheduleBillingPage = lazy(async () => {
  const module = await import('./students/StudentScheduleBillingPage');
  return { default: module.StudentScheduleBillingPage };
});

const BusinessShell = lazy(async () => {
  const module = await import('./business/BusinessShell');
  return { default: module.BusinessShell };
});

const BusinessSchedulePage = lazy(async () => {
  const module = await import('./business/BusinessSchedulePage');
  return { default: module.BusinessSchedulePage };
});

const BusinessStatsPage = lazy(async () => {
  const module = await import('./business/BusinessStatsPage');
  return { default: module.BusinessStatsPage };
});

const BusinessSettingsPage = lazy(async () => {
  const module = await import('./business/BusinessSettingsPage');
  return { default: module.BusinessSettingsPage };
});

const PromptTemplatesPage = lazy(async () => {
  const module = await import('./prompts/PromptTemplatesPage');
  return { default: module.PromptTemplatesPage };
});

function extractInviteTokenFromLocation(location: Location): string | null {
  const hash = location.hash.replace(/^#/, '');
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : hash;
  const candidates = [hashQuery, location.search.replace(/^\?/, '')];

  for (const candidate of candidates) {
    const params = new URLSearchParams(candidate);
    const token = params.get('invite') ?? params.get('inviteToken');
    if (token?.trim()) return token.trim();
  }

  return null;
}

function oauthContinuation(location: Location): string | null {
  const candidate = new URLSearchParams(location.search).get('oauth_continue');
  return candidate && /^\/api\/oauth\/interaction\/[A-Za-z0-9_-]+$/.test(candidate)
    ? candidate
    : null;
}

export const App: React.FC = () => {
  if (
    CalmStudioV2 &&
    isFrontendSandboxEnabled() &&
    readFrontendSandboxScenario(window.location.search) === 'calm-studio-v2'
  ) {
    return (
      <Suspense fallback={<PageLoading label="Loading design sandbox" />}>
        <CalmStudioV2 />
      </Suspense>
    );
  }
  return <Application />;
};

const Application: React.FC = () => {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [prefillEmail, setPrefillEmail] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(() =>
    extractInviteTokenFromLocation(window.location),
  );

  useEffect(() => {
    const continuation = oauthContinuation(window.location);
    if (!continuation || isLoading) return;
    if (isAuthenticated) {
      window.location.assign(continuation);
    } else {
      setAuthMode('login');
    }
  }, [isAuthenticated, isLoading]);

  useEffect(() => {
    const syncInviteToken = () => {
      const token = extractInviteTokenFromLocation(window.location);
      setInviteToken(token);
      if (token) {
        setAuthMode('register');
      }
    };

    syncInviteToken();
    window.addEventListener('hashchange', syncInviteToken);
    window.addEventListener('popstate', syncInviteToken);
    return () => {
      window.removeEventListener('hashchange', syncInviteToken);
      window.removeEventListener('popstate', syncInviteToken);
    };
  }, []);

  const openLogin = () => setAuthMode('login');
  const openRegister = () => {
    setPrefillEmail('');
    setAuthMode('register');
  };

  const closeDialog = () => {
    setAuthMode(null);
    setPrefillEmail('');
  };

  const handleLogout = useCallback(async () => {
    setLogoutError(null);
    try {
      await logout();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unable to logout. Please try again.';
      setLogoutError(message);
    }
  }, [logout]);

  const handleRegistered = (_email: string) => {
    setInviteToken(null);
    setPrefillEmail('');
    if (window.location.hash.includes('invite')) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
  };

  let appBody: React.ReactNode = null;

  if (isLoading) {
    appBody = (
      <div className="auth-shell">
        <LoadingPlaceholder label="Restoring your session" kind="inline" count={1} />
      </div>
    );
  } else if (!isAuthenticated || !user) {
    appBody = (
      <div className="auth-shell">
        <UnauthenticatedNotice
          hasInvite={!!inviteToken}
          onLogin={openLogin}
          onRegister={openRegister}
        />
        {logoutError && <p role="alert">{logoutError}</p>}
      </div>
    );
  } else {
    appBody = (
      <WorkspaceTimezoneProvider key={user.id} onLogout={handleLogout}>
        <StudioV2Provider enabled={import.meta.env.VITE_CALM_STUDIO_V2 === 'true'}>
          <AuthenticatedApp user={user} onLogout={handleLogout} logoutError={logoutError} />
        </StudioV2Provider>
      </WorkspaceTimezoneProvider>
    );
  }

  return (
    <>
      {appBody}
      <Suspense fallback={null}>
        <AuthDialog
          mode={authMode}
          initialEmail={prefillEmail}
          inviteToken={inviteToken}
          onRegistered={handleRegistered}
          onClose={closeDialog}
          onSwitchMode={(mode) => {
            if (mode === 'register') {
              setPrefillEmail('');
            }
            setAuthMode(mode);
          }}
        />
      </Suspense>
    </>
  );
};

interface AuthenticatedAppProps {
  user: ReturnType<typeof useAuth>['user'];
  onLogout: () => void;
  logoutError: string | null;
}

const AuthenticatedApp: React.FC<AuthenticatedAppProps> = ({ user, onLogout, logoutError }) => {
  const v2 = useStudioV2();
  if (!user) return null;
  return (
    <Routes>
      <Route
        path="/calendar/connection-result"
        element={<Navigate to="/business/schedule" replace />}
      />
      <Route
        element={
          <CalmStudioShell
            user={user}
            onLogout={onLogout}
            logoutError={logoutError}
            sandboxMode={isFrontendSandboxEnabled()}
          />
        }
      >
        <Route
          path="/"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <AssignmentEntryRoute />
            </Suspense>
          }
        />
        {v2 && (
          <Route
            path="/assignments/new"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <MinimalAssignment />
              </Suspense>
            }
          />
        )}
        {v2 && (
          <Route
            path="/day"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <DayPage />
              </Suspense>
            }
          />
        )}
        <Route
          path="/business"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <BusinessShell />
            </Suspense>
          }
        >
          <Route index element={<Navigate to="schedule" replace />} />
          <Route
            path="schedule"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <BusinessSchedulePage />
              </Suspense>
            }
          />
          <Route
            path="stats"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <BusinessStatsPage />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <BusinessSettingsPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          path="/prompts"
          element={<Navigate to={user.role === 'admin' ? '/admin/prompts' : '/'} replace />}
        />
        <Route
          path="/admin/prompts"
          element={
            user.role === 'admin' ? (
              <Suspense fallback={<RouteLoadingFallback />}>
                <PromptTemplatesPage />
              </Suspense>
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route
          path="/students"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <StudentWorkspace />
            </Suspense>
          }
        >
          <Route
            index
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <StudentWorkspaceEmpty />
              </Suspense>
            }
          />
          <Route
            path=":studentId"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <StudentAreaShell />
              </Suspense>
            }
          >
            <Route index element={<Navigate to="overview" replace />} />
            <Route
              path="overview"
              element={
                <Suspense fallback={<RouteLoadingFallback studentTab />}>
                  <StudentOverviewPage />
                </Suspense>
              }
            />
            <Route
              path="learning"
              element={
                <Suspense fallback={<RouteLoadingFallback studentTab />}>
                  <StudentLearningPage />
                </Suspense>
              }
            />
            <Route
              path="history"
              element={
                <Suspense fallback={<RouteLoadingFallback studentTab />}>
                  <StudentHistoryPage />
                </Suspense>
              }
            />
            <Route
              path="schedule-billing"
              element={
                <Suspense fallback={<RouteLoadingFallback />}>
                  {v2 ? (
                    <StudentScheduleRedirect target="schedule" />
                  ) : (
                    <StudentScheduleBillingPage />
                  )}
                </Suspense>
              }
            />
            {v2 ? (
              <Route
                element={
                  <Suspense fallback={<RouteLoadingFallback studentTab />}>
                    <StudentScheduleBillingLayout />
                  </Suspense>
                }
              >
                <Route path="schedule" element={null} />
                <Route path="billing" element={null} />
              </Route>
            ) : (
              <>
                <Route
                  path="schedule"
                  element={<StudentScheduleRedirect target="schedule-billing" />}
                />
                <Route
                  path="billing"
                  element={<StudentScheduleRedirect target="schedule-billing" />}
                />
              </>
            )}
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

function RouteLoadingFallback({ studentTab = false }: { studentTab?: boolean }) {
  const studioV2 = useStudioV2();
  const { pathname, search } = useLocation();
  if (studioV2 && studentTab) {
    const tab = pathname.split('/').filter(Boolean).at(-1);
    if (
      tab === 'overview' ||
      tab === 'learning' ||
      tab === 'history' ||
      tab === 'schedule' ||
      tab === 'billing'
    )
      return <PageLoading page={tab} />;
  }
  if (studioV2 && pathname === '/day') return <PageLoading page="day" />;
  if (studioV2 && pathname === '/' && !hasAssignmentContext(search))
    return <PageLoading page="assignments" />;
  if (pathname === '/students') return <PageLoading page="students" />;
  if (pathname === '/business') return <PageLoading page="business" />;
  return <PageLoading />;
}

const UnauthenticatedNotice: React.FC<{
  hasInvite: boolean;
  onLogin: () => void;
  onRegister: () => void;
}> = ({ hasInvite, onLogin, onRegister }) => (
  <section className="unauth-panel app-state-panel animate-scale-in">
    <div className="unauth-graphic">
      <div className="graphic-circles">
        <div className="circle circle-1" />
        <div className="circle circle-2" />
        <div className="circle circle-3" />
      </div>
      <div className="graphic-icon">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <polyline points="10 17 15 12 10 7" />
          <line x1="15" y1="12" x2="3" y2="12" />
        </svg>
      </div>
    </div>

    <div className="unauth-content">
      <span className="unauth-eyebrow">Closed alpha access</span>
      <h2>{hasInvite ? 'Accept your invitation' : 'Sign in to get started'}</h2>
      <p>
        {hasInvite
          ? 'Create your invited tutor account, then you will enter the teaching workspace automatically.'
          : 'This private alpha is invite-only. Sign in with your tutor account, or open your invitation link to create one.'}
      </p>

      <div className="unauth-buttons">
        <button type="button" onClick={onLogin} className="btn-primary btn-large">
          Sign in
        </button>
        <button type="button" onClick={onRegister} className="btn-secondary btn-large">
          {hasInvite ? 'Create invited account' : 'Create account with invite'}
        </button>
      </div>
      <LegalLinks />
    </div>
  </section>
);
