import React, { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { useAuth } from '../context/AuthContext';
import { JobMonitorProvider } from '../context/JobMonitorContext';
import { JobSettingsProvider } from '../context/JobSettingsContext';
import { NotificationProvider, useNotification } from '../context/NotificationContext';
import { useTheme } from '../context/ThemeContext';
import { AuthDialog, AuthMode } from './auth/AuthDialog';
import { ActivityFeed } from './jobs/ActivityFeed';
import { JobConnectionBanner } from './jobs/JobConnectionBanner';
import { JobTable } from './jobs/JobTable';
import { ProfilePage } from './profile/ProfilePage';
import { JobSettingsForm } from './settings/JobSettingsForm';
import { JobUploader } from './uploader/JobUploader';

// Icons
const SunIcon = () => (
  <svg
    width="20"
    height="20"
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
    width="20"
    height="20"
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

const SettingsIcon = () => (
  <svg
    width="20"
    height="20"
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

const BellIcon = () => (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

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

  const mainContent = useMemo(() => {
    if (showProfile && isAuthenticated) {
      return <ProfilePage onClose={() => setShowProfile(false)} />;
    }

    if (isLoading) {
      return <LoadingPanel />;
    }

    if (!isAuthenticated) {
      return <UnauthenticatedNotice onLogin={openLogin} onRegister={openRegister} />;
    }

    return (
      <JobSettingsProvider>
        <JobMonitorProvider>
          <NotificationProvider>
            <AuthenticatedPanels />
          </NotificationProvider>
        </JobMonitorProvider>
      </JobSettingsProvider>
    );
  }, [isLoading, isAuthenticated, showProfile]);

  return (
    <div className="app-container">
      <div className="app-wrapper">
        {/* Header */}
        <header className="header card-glass animate-fade-in-up">
          <div className="header-brand">
            <div className="header-logo">
              <div className="logo-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="url(#logoGradient)" />
                  <path
                    d="M2 17L12 22L22 17"
                    stroke="url(#logoGradient)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M2 12L12 17L22 12"
                    stroke="url(#logoGradient)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <defs>
                    <linearGradient
                      id="logoGradient"
                      x1="2"
                      y1="2"
                      x2="22"
                      y2="22"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop stopColor="#4f46e5" />
                      <stop offset="1" stopColor="#8b5cf6" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="header-titles">
                <span className="header-eyebrow">ESL Pipeline</span>
                <h1 className="header-title">Batch Jobs Console</h1>
              </div>
            </div>
          </div>

          <div className="header-actions">
            <button
              type="button"
              onClick={toggleTheme}
              className="btn-icon"
              title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>

            {isLoading ? (
              <div className="header-loading">
                <div className="spinner" />
                <span>Checking session…</span>
              </div>
            ) : isAuthenticated && user ? (
              <div className="header-user">
                <div className="user-badge">
                  <span className="user-email">{user.email}</span>
                  <span className="user-role">
                    {user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Viewer' : 'Tutor'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowProfile(true)}
                  className="btn-icon"
                  title="Profile Settings"
                >
                  <SettingsIcon />
                </button>
                <button type="button" onClick={() => void handleLogout()} className="btn-logout">
                  <LogoutIcon />
                  <span>Logout</span>
                </button>
              </div>
            ) : (
              <div className="header-auth-buttons">
                <button type="button" onClick={openLogin} className="btn-secondary">
                  Login
                </button>
                <button type="button" onClick={openRegister} className="btn-primary">
                  Get Started
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Main Content */}
        <main className="main-content">{mainContent}</main>

        {/* Footer */}
        <footer className="footer">
          <p>ESL Pipeline v1.0 • Built for tutors, by tutors</p>
        </footer>
      </div>

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

      <style>{`
        .app-container {
          min-height: 100vh;
          padding: var(--space-6) var(--space-4) var(--space-8);
        }

        .app-wrapper {
          max-width: 1400px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: var(--space-6);
        }

        /* Header */
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-4);
          flex-wrap: wrap;
          padding: var(--space-4) var(--space-6);
        }

        .header-brand {
          display: flex;
          align-items: center;
          gap: var(--space-4);
        }

        .header-logo {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .logo-icon {
          width: 48px;
          height: 48px;
          background: var(--gradient-primary);
          border-radius: var(--radius-xl);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 4px 14px rgba(99, 102, 241, 0.3);
        }

        .logo-icon svg {
          filter: brightness(0) invert(1);
        }

        .header-titles {
          display: flex;
          flex-direction: column;
        }

        .header-eyebrow {
          font-size: var(--text-xs);
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--color-primary-500);
        }

        .header-title {
          font-size: var(--text-xl);
          font-weight: 700;
          margin: 0;
          background: var(--gradient-primary);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .btn-icon {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-icon:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
          border-color: var(--border-medium);
        }

        .header-loading {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          color: var(--text-tertiary);
          font-size: var(--text-sm);
        }

        .header-user {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .user-badge {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          padding: var(--space-2) var(--space-4);
          background: var(--bg-secondary);
          border-radius: var(--radius-xl);
          border: 1px solid var(--border-light);
        }

        .user-email {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .user-role {
          font-size: var(--text-xs);
          font-weight: 500;
          color: var(--color-primary-500);
        }

        .btn-logout {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-4);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-full);
          color: var(--text-secondary);
          font-size: var(--text-sm);
          font-weight: 500;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .btn-logout:hover {
          background: rgba(244, 63, 94, 0.1);
          border-color: var(--color-error-400);
          color: var(--color-error-500);
        }

        .header-auth-buttons {
          display: flex;
          gap: var(--space-2);
        }

        /* Main Content */
        .main-content {
          min-height: 500px;
          animation: fadeInUp 0.4s ease-out;
        }

        /* Footer */
        .footer {
          text-align: center;
          padding: var(--space-4);
          color: var(--text-muted);
          font-size: var(--text-sm);
        }

        .footer p {
          margin: 0;
          color: var(--text-muted);
        }

        /* Card Glass */
        .card-glass {
          background: var(--glass-bg);
          backdrop-filter: var(--glass-blur);
          -webkit-backdrop-filter: var(--glass-blur);
          border: 1px solid var(--glass-border);
          border-radius: var(--radius-2xl);
          box-shadow: var(--shadow-lg);
        }

        @media (max-width: 768px) {
          .app-container {
            padding: var(--space-4) var(--space-3);
          }

          .header {
            padding: var(--space-3) var(--space-4);
          }

          .header-title {
            font-size: var(--text-lg);
          }

          .user-badge {
            display: none;
          }

          .btn-logout span {
            display: none;
          }
        }
      `}</style>
    </div>
  );
};

const AuthenticatedPanels: React.FC = () => (
  <div className="panels-grid">
    <div className="panels-main">
      <JobSettingsForm />
      <JobUploader />
      <JobConnectionBanner />
      <JobTable />
    </div>

    <aside className="panels-sidebar">
      <ActivityFeed />
      <NotificationsPanel />
    </aside>

    <style>{`
      .panels-grid {
        display: grid;
        grid-template-columns: minmax(0, 2.2fr) minmax(280px, 1fr);
        gap: var(--space-5);
      }

      .panels-main {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      .panels-sidebar {
        display: flex;
        flex-direction: column;
        gap: var(--space-5);
      }

      @media (max-width: 1024px) {
        .panels-grid {
          grid-template-columns: 1fr;
        }

        .panels-sidebar {
          order: -1;
        }
      }
    `}</style>
  </div>
);

const NotificationsPanel: React.FC = () => {
  const { permission, requestPermission, disableNotifications } = useNotification();
  const notificationsEnabled = permission === 'granted';
  const isSupported = typeof Notification !== 'undefined';

  const handleToggle = async () => {
    if (!isSupported) {
      toast.error('Browser notifications are not supported');
      return;
    }

    if (notificationsEnabled) {
      disableNotifications();
      toast('Notifications paused', { icon: '⏸️' });
      return;
    }

    const result = await requestPermission();
    if (result === 'granted') {
      toast.success('Notifications enabled!');
    } else if (result === 'denied') {
      toast.error('Notifications are blocked. Please enable them in your browser settings.');
    } else {
      toast.error('Notification permission not granted');
    }
  };

  return (
    <section className="notifications-panel card">
      <div className="notifications-header">
        <div className="notifications-icon">
          <BellIcon />
        </div>
        <div className="notifications-info">
          <h3>Notifications</h3>
          <p>Get notified when jobs complete</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleToggle()}
        className={`notifications-toggle ${notificationsEnabled ? 'active' : ''}`}
      >
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
        <span className="toggle-label">{notificationsEnabled ? 'Enabled' : 'Disabled'}</span>
      </button>

      <style>{`
        .notifications-panel {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .notifications-header {
          display: flex;
          align-items: center;
          gap: var(--space-3);
        }

        .notifications-icon {
          width: 44px;
          height: 44px;
          background: var(--gradient-primary);
          border-radius: var(--radius-lg);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .notifications-info h3 {
          font-size: var(--text-base);
          margin: 0;
        }

        .notifications-info p {
          font-size: var(--text-sm);
          color: var(--text-tertiary);
          margin: 0;
        }

        .notifications-toggle {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          padding: var(--space-3) var(--space-4);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          border-radius: var(--radius-lg);
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .notifications-toggle:hover {
          border-color: var(--border-medium);
        }

        .toggle-track {
          width: 44px;
          height: 24px;
          background: var(--color-gray-300);
          border-radius: var(--radius-full);
          position: relative;
          transition: background var(--transition-fast);
        }

        .notifications-toggle.active .toggle-track {
          background: var(--color-primary-500);
        }

        .toggle-thumb {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 20px;
          height: 20px;
          background: white;
          border-radius: 50%;
          transition: transform var(--transition-fast);
          box-shadow: var(--shadow-sm);
        }

        .notifications-toggle.active .toggle-thumb {
          transform: translateX(20px);
        }

        .toggle-label {
          font-size: var(--text-sm);
          font-weight: 500;
          color: var(--text-secondary);
        }
      `}</style>
    </section>
  );
};

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
        color: var(--color-primary-500);
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

    <div className="unauth-features">
      <div className="feature">
        <div className="feature-icon">📤</div>
        <span>Batch upload</span>
      </div>
      <div className="feature">
        <div className="feature-icon">⚡</div>
        <span>Real-time monitoring</span>
      </div>
      <div className="feature">
        <div className="feature-icon">🎙️</div>
        <span>TTS generation</span>
      </div>
      <div className="feature">
        <div className="feature-icon">📝</div>
        <span>Notion sync</span>
      </div>
    </div>

    <style>{`
      .unauth-panel {
        padding: var(--space-10);
        text-align: center;
        max-width: 600px;
        margin: 0 auto;
      }

      .unauth-graphic {
        position: relative;
        width: 120px;
        height: 120px;
        margin: 0 auto var(--space-6);
      }

      .graphic-circles {
        position: absolute;
        inset: 0;
      }

      .circle {
        position: absolute;
        border-radius: 50%;
        animation: float 3s ease-in-out infinite;
      }

      .circle-1 {
        width: 100%;
        height: 100%;
        background: rgba(99, 102, 241, 0.1);
        animation-delay: 0s;
      }

      .circle-2 {
        width: 80%;
        height: 80%;
        top: 10%;
        left: 10%;
        background: rgba(99, 102, 241, 0.15);
        animation-delay: 0.5s;
      }

      .circle-3 {
        width: 60%;
        height: 60%;
        top: 20%;
        left: 20%;
        background: rgba(99, 102, 241, 0.2);
        animation-delay: 1s;
      }

      .graphic-icon {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 80px;
        height: 80px;
        background: var(--gradient-primary);
        border-radius: var(--radius-2xl);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        box-shadow: 0 8px 32px rgba(99, 102, 241, 0.35);
      }

      .unauth-content {
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
        margin-bottom: var(--space-6);
      }

      .unauth-eyebrow {
        font-size: var(--text-xs);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--color-primary-500);
      }

      .unauth-content h2 {
        font-size: var(--text-2xl);
        margin: 0;
      }

      .unauth-content p {
        font-size: var(--text-base);
        max-width: 400px;
        margin: 0 auto;
      }

      .unauth-buttons {
        display: flex;
        gap: var(--space-3);
        justify-content: center;
        flex-wrap: wrap;
        margin-top: var(--space-2);
      }

      .btn-large {
        padding: var(--space-4) var(--space-6);
        font-size: var(--text-base);
      }

      .unauth-features {
        display: flex;
        gap: var(--space-4);
        justify-content: center;
        flex-wrap: wrap;
        padding-top: var(--space-6);
        border-top: 1px solid var(--border-light);
        margin-top: var(--space-6);
      }

      .feature {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        color: var(--text-secondary);
      }

      .feature-icon {
        font-size: var(--text-lg);
      }

      @media (max-width: 640px) {
        .unauth-panel {
          padding: var(--space-6);
        }

        .unauth-buttons {
          flex-direction: column;
        }

        .btn-large {
          width: 100%;
        }
      }
    `}</style>
  </section>
);
