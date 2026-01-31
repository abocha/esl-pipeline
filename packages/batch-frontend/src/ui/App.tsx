import React, { useCallback, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Navigate, Route, Routes } from 'react-router-dom';

import { useAuth } from '../context/AuthContext';
import { JobMonitorProvider } from '../context/JobMonitorContext';
import { JobSettingsProvider } from '../context/JobSettingsContext';
import { NotificationProvider } from '../context/NotificationContext';
import { StudentSelectionProvider } from '../context/StudentSelectionContext';
import { useTheme } from '../context/ThemeContext';
import { WizardProvider } from '../context/WizardContext';
import { WorkshopShell } from '../layouts/WorkshopShell';
import { AuthDialog, AuthMode } from './auth/AuthDialog';
import { Dashboard } from './dashboard/Dashboard';
import { JobConnectionBanner } from './jobs/JobConnectionBanner';
import { JobTable } from './jobs/JobTable';
import { ProfilePage } from './profile/ProfilePage';
import { JobSettingsForm } from './settings/JobSettingsForm';
import { StudentProfile } from './students/StudentProfile';
import { StudentWorkspace } from './students/StudentWorkspace';
import { AssignmentWizard } from './wizard/AssignmentWizard';
import { ActivityFeed } from './jobs/ActivityFeed';
import { NotificationsPanel } from './notifications/NotificationsPanel';
import { GlobalNotificationDrawer } from './notifications/GlobalNotificationDrawer';

export const App: React.FC = () => {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [prefillEmail, setPrefillEmail] = useState('');
  const [showProfile, setShowProfile] = useState(false);

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

  const handleRegistered = (email: string) => {
    setPrefillEmail(email);
    setAuthMode('login');
    toast.success('Account created! Please log in.');
  };

  const authenticatedContent = (
    <StudentSelectionProvider>
      <JobSettingsProvider>
        <JobMonitorProvider>
          <NotificationProvider>
            <WizardProvider>
              {showProfile ? (
                <ProfilePage onClose={() => setShowProfile(false)} />
              ) : (
                <AuthenticatedRoutes />
              )}
            </WizardProvider>
          </NotificationProvider>
        </JobMonitorProvider>
      </JobSettingsProvider>
    </StudentSelectionProvider>
  );

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
        <UnauthenticatedNotice onLogin={openLogin} onRegister={openRegister} />
      </div>
    );
  } else {
    appBody = (
      <WorkshopShell
        user={user}
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenProfile={() => setShowProfile(true)}
        onLogout={handleLogout}
      >
        {authenticatedContent}
      </WorkshopShell>
    );
  }

  return (
    <>
      {appBody}
      <AuthDialog
        mode={authMode}
        initialEmail={prefillEmail}
        onRegistered={handleRegistered}
        onClose={closeDialog}
        onSwitchMode={(mode) => {
          if (mode === 'register') {
            setPrefillEmail('');
          }
          setAuthMode(mode);
        }}
      />
    </>
  );
};

const AuthenticatedRoutes: React.FC = () => (
  <>
    <div className="global-notification-container">
      <GlobalNotificationDrawer />
    </div>
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/wizard" element={<AssignmentWizard />} />
      <Route path="/students/:studentId" element={<StudentProfilePage />} />
      <Route path="/students" element={<StudentsPage />} />
      <Route path="/jobs" element={<JobsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </>
);

const StudentsPage: React.FC = () => (
  <div className="page-single">
    <StudentWorkspace />
  </div>
);

const StudentProfilePage: React.FC = () => (
  <div className="page-single">
    <StudentProfile />
  </div>
);

const JobsPage: React.FC = () => (
  <div className="page-grid">
    <div className="page-main">
      <JobConnectionBanner />
      <JobTable />
    </div>
    <aside className="page-side">
      <ActivityFeed />
      <NotificationsPanel />
    </aside>
  </div>
);

const SettingsPage: React.FC = () => (
  <div className="page-grid">
    <div className="page-main">
      <JobSettingsForm />
    </div>
    <aside className="page-side">
      <NotificationsPanel />
    </aside>
  </div>
);

const LoadingPanel: React.FC = () => (
  <section className="loading-panel card animate-fade-in">
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

    <style>{`
      .loading-panel {
        padding: var(--space-12) var(--space-8);
        text-align: center;
      }

      .loading-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--space-6);
      }

      .loading-spinner {
        width: 64px;
        height: 64px;
        position: relative;
      }

      .spinner-ring {
        width: 100%;
        height: 100%;
        border: 3px solid var(--border-light);
        border-top-color: var(--color-primary-500);
        border-radius: 50%;
        animation: spin 1s linear infinite;
      }

      .loading-text {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
      }

      .loading-eyebrow {
        font-size: var(--text-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-tertiary);
      }

      .loading-text h2 {
        font-size: var(--text-xl);
        margin: 0;
      }

      .loading-text p {
        font-size: var(--text-sm);
        margin: 0;
      }
    `}</style>
  </section>
);

const UnauthenticatedNotice: React.FC<{ onLogin: () => void; onRegister: () => void }> = ({
  onLogin,
  onRegister,
}) => (
  <section className="unauth-panel card animate-scale-in">
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
      <span className="unauth-eyebrow">Authentication Required</span>
      <h2>Sign in to get started</h2>
      <p>
        Upload markdown lessons, configure job settings, and monitor processing in real-time. Create
        an account or log in to access all features.
      </p>

      <div className="unauth-buttons">
        <button type="button" onClick={onLogin} className="btn-primary btn-large">
          Login to your account
        </button>
        <button type="button" onClick={onRegister} className="btn-secondary btn-large">
          Create new account
        </button>
      </div>
    </div>

    <style>{`
      .unauth-panel {
        max-width: 640px;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: var(--space-6);
        padding: var(--space-8);
      }

      .unauth-graphic {
        position: relative;
        padding: var(--space-6);
        background: var(--bg-secondary);
        border-radius: var(--radius-2xl);
        border: 1px solid var(--border-light);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }

      .graphic-circles {
        position: absolute;
        inset: 0;
      }

      .circle {
        position: absolute;
        border-radius: 999px;
        background: rgba(43, 81, 255, 0.08);
      }

      .circle-1 {
        width: 120px;
        height: 120px;
        top: -20px;
        left: -10px;
      }

      .circle-2 {
        width: 180px;
        height: 180px;
        bottom: -60px;
        right: -40px;
      }

      .circle-3 {
        width: 90px;
        height: 90px;
        bottom: 20px;
        left: 40px;
      }

      .graphic-icon {
        position: relative;
        width: 72px;
        height: 72px;
        border-radius: 24px;
        background: var(--bg-primary);
        border: 1px solid var(--border-light);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--color-primary-500);
        box-shadow: var(--shadow-sm);
      }

      .unauth-content {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
      }

      .unauth-eyebrow {
        font-size: var(--text-xs);
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--text-tertiary);
        font-weight: 600;
      }

      .unauth-content h2 {
        margin: 0;
        font-size: var(--text-2xl);
      }

      .unauth-content p {
        margin: 0;
        color: var(--text-secondary);
      }

      .unauth-buttons {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-3);
      }

      .btn-large {
        padding: var(--space-3) var(--space-6);
        font-size: var(--text-sm);
      }

      @media (max-width: 720px) {
        .unauth-panel {
          padding: var(--space-6);
        }
      }
    `}</style>
  </section>
);
