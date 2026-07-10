import React, { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { isFrontendSandboxEnabled } from '../dev/frontend-sandbox';
import type { AuthMode } from './auth/AuthDialog';
import { CalmStudioShell } from './shell/CalmStudioShell';

import './AppShell.css';

const AuthDialog = lazy(async () => {
  const module = await import('./auth/AuthDialog');
  return { default: module.AuthDialog };
});

const MinimalAssignment = lazy(async () => {
  const module = await import('./minimal/MinimalAssignment');
  return { default: module.MinimalAssignment };
});

const StudentDirectoryPage = lazy(async () => {
  const module = await import('./students/StudentDirectoryPage');
  return { default: module.StudentDirectoryPage };
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

export const App: React.FC = () => {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [prefillEmail, setPrefillEmail] = useState('');
  const [inviteToken, setInviteToken] = useState<string | null>(() =>
    extractInviteTokenFromLocation(window.location),
  );

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
    try {
      await logout();
      toast.success('Logged out successfully');
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unable to logout. Please try again.';
      toast.error(message);
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
        <LoadingPanel />
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
      </div>
    );
  } else {
    appBody = <AuthenticatedApp user={user} onLogout={handleLogout} />;
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
}

const AuthenticatedApp: React.FC<AuthenticatedAppProps> = ({ user, onLogout }) => {
  if (!user) return null;
  return (
    <Routes>
      <Route
        element={
          <CalmStudioShell
            user={user}
            onLogout={onLogout}
            sandboxMode={isFrontendSandboxEnabled()}
          />
        }
      >
        <Route
          path="/"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <MinimalAssignment />
            </Suspense>
          }
        />
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
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <PromptTemplatesPage />
            </Suspense>
          }
        />
        <Route
          path="/students"
          element={
            <Suspense fallback={<RouteLoadingFallback />}>
              <StudentDirectoryPage />
            </Suspense>
          }
        />
        <Route
          path="/students/:studentId"
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
              <Suspense fallback={<RouteLoadingFallback />}>
                <StudentOverviewPage />
              </Suspense>
            }
          />
          <Route
            path="learning"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <StudentLearningPage />
              </Suspense>
            }
          />
          <Route
            path="history"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <StudentHistoryPage />
              </Suspense>
            }
          />
          <Route
            path="schedule-billing"
            element={
              <Suspense fallback={<RouteLoadingFallback />}>
                <StudentScheduleBillingPage />
              </Suspense>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

const RouteLoadingFallback: React.FC = () => (
  <section className="route-loading-panel" aria-live="polite">
    <span className="loading-eyebrow">Opening page…</span>
    <h2>Preparing the teaching workspace</h2>
    <p>Loading the next view without changing your session.</p>
  </section>
);

const LoadingPanel: React.FC = () => (
  <section className="loading-panel app-state-panel animate-fade-in">
    <div className="loading-content">
      <div className="loading-spinner">
        <div className="spinner-ring" />
      </div>
      <div className="loading-text">
        <span className="loading-eyebrow">Please wait</span>
        <h2>Restoring your session…</h2>
        <p>We&apos;re verifying your authentication with the server.</p>
      </div>
    </div>
  </section>
);

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
    </div>
  </section>
);
