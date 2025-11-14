import React, { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { JobSettingsProvider } from '../context/JobSettingsContext';
import { AuthDialog, AuthMode } from './auth/AuthDialog';
import { JobSettingsForm } from './settings/JobSettingsForm';

type PlaceholderProps = {
  title: string;
  description: string;
  hint?: string;
};

const PlaceholderCard: React.FC<PlaceholderProps> = ({ title, description, hint }) => (
  <section
    style={{
      border: '1px dashed #cbd5f5',
      borderRadius: '12px',
      padding: '20px',
      background: '#f8fbff',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      minHeight: '140px',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '999px',
          background: '#2563eb',
          display: 'inline-block',
        }}
      />
      <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>{title}</h3>
    </div>
    <p style={{ margin: 0, color: '#475569', fontSize: '14px', lineHeight: 1.4 }}>{description}</p>
    {hint && (
      <p style={{ margin: 0, color: '#94a3b8', fontSize: '13px', lineHeight: 1.4 }}>
        <strong style={{ textTransform: 'uppercase', fontSize: '11px', letterSpacing: '0.04em' }}>
          Coming soon:
        </strong>{' '}
        {hint}
      </p>
    )}
  </section>
);

/**
 * Root App shell that mirrors the layout described in design-batch-frontend.md.
 *
 * Phase 1 intentionally focuses on groundwork: removing legacy forms, adding
 * scaffolding, and preparing for the richer flow that comes later phases.
 */

export const App: React.FC = () => {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [prefillEmail, setPrefillEmail] = useState('');

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
      toast.success('Logged out');
    } catch (error: any) {
      toast.error(error?.message ?? 'Unable to logout. Please try again.');
    }
  }, [logout]);

  const handleRegistered = (email: string) => {
    setPrefillEmail(email);
    setAuthMode('login');
  };

  const headerStatus = useMemo(() => {
    if (isLoading) {
      return (
        <div
          style={{
            color: '#64748b',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '999px',
              background: '#94a3b8',
              animation: 'pulse 1.2s ease-in-out infinite',
            }}
          />
          Checking session…
        </div>
      );
    }

    if (isAuthenticated && user) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            background: '#eef2ff',
            padding: '10px 16px',
            borderRadius: '999px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
            <span style={{ fontWeight: 600, fontSize: '14px' }}>{user.email}</span>
            <span style={{ fontSize: '12px', color: '#6366f1', fontWeight: 500 }}>
              {user.role === 'admin' ? 'Admin' : user.role === 'viewer' ? 'Viewer' : 'Tutor'}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void handleLogout()}
            style={{
              border: 'none',
              background: '#4338ca',
              color: '#fff',
              padding: '8px 14px',
              borderRadius: '999px',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 600,
            }}
          >
            Logout
          </button>
        </div>
      );
    }

    return (
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          type="button"
          onClick={openLogin}
          style={{
            border: '1px solid #c7d2fe',
            background: '#fff',
            color: '#4338ca',
            borderRadius: '999px',
            padding: '8px 16px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Login
        </button>
        <button
          type="button"
          onClick={openRegister}
          style={{
            border: 'none',
            background: 'linear-gradient(120deg, #4f46e5, #6366f1)',
            color: '#fff',
            borderRadius: '999px',
            padding: '8px 16px',
            fontWeight: 600,
            boxShadow: '0 10px 25px rgba(79, 70, 229, 0.25)',
            cursor: 'pointer',
          }}
        >
          Register
        </button>
      </div>
    );
  }, [handleLogout, isAuthenticated, isLoading, user]);

  const mainContent = () => {
    if (isLoading) {
      return <LoadingPanel />;
    }

    if (!isAuthenticated) {
      return <UnauthenticatedNotice onLogin={openLogin} onRegister={openRegister} />;
    }

    return (
      <JobSettingsProvider>
        <AuthenticatedPanels />
      </JobSettingsProvider>
    );
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#eff4ff',
        padding: '32px 24px 48px',
        fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
        color: '#0f172a',
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
        }}
      >
        <header style={headerStyle}>
          <div>
            <p style={eyebrowStyle}>ESL Pipeline</p>
            <h1 style={{ margin: '4px 0 8px', fontSize: '28px' }}>Batch Jobs Console</h1>
            <p style={{ margin: 0, color: '#475569', fontSize: '15px' }}>
              Upload lessons, submit jobs, and monitor progress in real time. Authentication and job
              surfaces will land in the next phases.
            </p>
          </div>
          {headerStatus}
        </header>

        <main style={{ minHeight: '400px' }}>{mainContent()}</main>
      </div>

      <AuthDialog
        mode={authMode}
        initialEmail={prefillEmail}
        onRegistered={handleRegistered}
        onClose={closeDialog}
        onSwitchMode={mode => {
          if (mode === 'register') {
            setPrefillEmail('');
          }
          setAuthMode(mode);
        }}
      />
    </div>
  );
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  flexWrap: 'wrap',
  background: '#fff',
  padding: '20px 24px',
  borderRadius: '16px',
  boxShadow: '0 12px 60px rgba(15, 23, 42, 0.08)',
};

const eyebrowStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: '#818cf8',
};

const AuthenticatedPanels: React.FC = () => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 2.1fr) minmax(280px, 1fr)',
      gap: '24px',
    }}
  >
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <JobSettingsForm />

      <PlaceholderCard
        title="Multi-file Uploader & Submission Queue"
        description="Drag/drop markdown files, stream uploads to /uploads, then POST /jobs with the selected options. Each file will show its status, retries, and resulting jobId."
        hint="dropzone, sequential uploads, retry controls"
      />

      <PlaceholderCard
        title="Active Jobs Table"
        description="Live-updating table sourced from local session data + SSE job events. Row-level actions (copy Notion link, regenerate audio) land after SSE wiring."
        hint="search/filter, state pills, row actions"
      />
    </div>

    <aside style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <PlaceholderCard
        title="Activity Feed"
        description="Chronological list of job state changes, errors, and completion toasts. SSE events will hydrate this feed with real-time updates."
      />
      <PlaceholderCard
        title="Notifications Panel"
        description="Browser notification opt-in, SSE connection health, and manual refresh controls will appear here so tutors know when live updates pause."
      />
    </aside>
  </div>
);

const LoadingPanel: React.FC = () => (
  <section
    style={{
      background: '#fff',
      padding: '40px 32px',
      borderRadius: '20px',
      boxShadow: '0 20px 70px rgba(15, 23, 42, 0.08)',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      alignItems: 'flex-start',
    }}
  >
    <p style={eyebrowStyle}>Please wait</p>
    <h2 style={{ margin: 0 }}>Restoring your session…</h2>
    <p style={{ margin: 0, color: '#475569', fontSize: '14px' }}>
      We’re checking your cookies with the batch backend. This only takes a moment.
    </p>
  </section>
);

const UnauthenticatedNotice: React.FC<{ onLogin: () => void; onRegister: () => void }> = ({
  onLogin,
  onRegister,
}) => (
  <section
    style={{
      background: '#fff',
      padding: '40px 32px',
      borderRadius: '20px',
      boxShadow: '0 20px 70px rgba(15, 23, 42, 0.08)',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    }}
  >
    <p style={eyebrowStyle}>Authentication required</p>
    <h2 style={{ margin: 0 }}>Sign in to submit jobs</h2>
    <p style={{ margin: 0, color: '#475569', fontSize: '15px' }}>
      Uploading markdown files and monitoring jobs is available once you authenticate. Use your ESL
      Pipeline credentials or create an account to get started.
    </p>
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
      <button type="button" onClick={onLogin} style={ctaButtonStyle('#4338ca', '#fff')}>
        Login
      </button>
      <button
        type="button"
        onClick={onRegister}
        style={ctaButtonStyle('#fff', '#4338ca', '#c7d2fe')}
      >
        Register
      </button>
    </div>
  </section>
);

const ctaButtonStyle = (bg: string, color: string, borderColor?: string): React.CSSProperties => ({
  borderRadius: '999px',
  padding: '12px 22px',
  fontWeight: 600,
  fontSize: '15px',
  border: borderColor ? `1px solid ${borderColor}` : 'none',
  background: bg,
  color,
  cursor: 'pointer',
  boxShadow: bg === '#4338ca' ? '0 15px 40px rgba(67, 56, 202, 0.25)' : 'none',
});
