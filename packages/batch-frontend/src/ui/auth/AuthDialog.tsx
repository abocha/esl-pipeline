import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { UserRole, useAuth } from '../../context/AuthContext';

export type AuthMode = 'login' | 'register';
type RegisterableRole = Extract<UserRole, 'user' | 'viewer'>;

interface AuthDialogProps {
  mode: AuthMode | null;
  onClose: () => void;
  onSwitchMode: (mode: AuthMode) => void;
  onRegistered?: (email: string) => void;
  initialEmail?: string;
}

interface RegisterFormState {
  email: string;
  password: string;
  confirmPassword: string;
  role: RegisterableRole;
}

const defaultRegisterState: RegisterFormState = {
  email: '',
  password: '',
  confirmPassword: '',
  role: 'user',
};

export const AuthDialog: React.FC<AuthDialogProps> = ({
  mode,
  onClose,
  onSwitchMode,
  onRegistered,
  initialEmail,
}) => {
  const { login, register } = useAuth();
  const [registerForm, setRegisterForm] = useState<RegisterFormState>(defaultRegisterState);
  const [loginForm, setLoginForm] = useState({ email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setError(null);
    setSubmitting(false);
    if (mode === 'login') {
      setLoginForm((prev) => ({
        email: initialEmail ?? prev.email ?? '',
        password: '',
      }));
    } else if (mode === 'register') {
      setRegisterForm({
        ...defaultRegisterState,
        email: '',
      });
    }
  }, [mode, initialEmail]);

  useEffect(() => {
    if (mode === 'login' && initialEmail) {
      setLoginForm((prev) => ({ ...prev, email: initialEmail }));
    }
  }, [initialEmail, mode]);

  if (!mode) {
    return null;
  }

  const close = () => {
    setError(null);
    onClose();
  };

  const handleLoginSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(loginForm.email, loginForm.password);
      toast.success('Welcome back!');
      close();
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Login failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegisterSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    if (registerForm.password !== registerForm.confirmPassword) {
      setError('Passwords do not match.');
      setSubmitting(false);
      return;
    }

    try {
      await register(registerForm.email, registerForm.password, registerForm.role);
      toast.success('Account created! Please log in.');
      onRegistered?.(registerForm.email);
    } catch (error_: unknown) {
      setError(error_ instanceof Error ? error_.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        zIndex: 1000,
      }}
      onClick={close}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          background: '#fff',
          borderRadius: '20px',
          padding: '28px',
          boxShadow: '0 30px 120px rgba(15, 23, 42, 0.35)',
          position: 'relative',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close authentication dialog"
          onClick={close}
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: '20px',
            color: '#94a3b8',
          }}
        >
          ×
        </button>

        {mode === 'login' ? (
          <LoginForm
            form={loginForm}
            setForm={setLoginForm}
            submitting={submitting}
            error={error}
            onSubmit={handleLoginSubmit}
            onSwitchMode={() => onSwitchMode('register')}
          />
        ) : (
          <RegisterForm
            form={registerForm}
            setForm={setRegisterForm}
            submitting={submitting}
            error={error}
            onSubmit={handleRegisterSubmit}
            onSwitchMode={() => onSwitchMode('login')}
          />
        )}
      </div>
    </div>
  );
};

interface LoginFormProps {
  form: { email: string; password: string };
  setForm: React.Dispatch<React.SetStateAction<{ email: string; password: string }>>;
  submitting: boolean;
  error: string | null;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onSwitchMode: () => void;
}

const LoginForm: React.FC<LoginFormProps> = ({
  form,
  setForm,
  submitting,
  error,
  onSubmit,
  onSwitchMode,
}) => {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: '12px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#a5b4fc',
            fontWeight: 600,
          }}
        >
          Welcome back
        </p>
        <h2 style={{ margin: '6px 0 0', fontSize: '24px' }}>Log into your tutor account</h2>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            padding: '8px 10px',
            borderRadius: '8px',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
        Email
        <input
          type="email"
          required
          value={form.email}
          onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          placeholder="you@school.org"
          style={inputStyle}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
        Password
        <input
          type="password"
          required
          value={form.password}
          onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
          placeholder="••••••••"
          style={inputStyle}
        />
      </label>

      <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>
        {submitting ? 'Signing in…' : 'Sign in'}
      </button>

      <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', color: '#475569' }}>
        Need an account?{' '}
        <button
          type="button"
          onClick={onSwitchMode}
          style={{
            background: 'none',
            border: 'none',
            color: '#4f46e5',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Register
        </button>
      </p>
    </form>
  );
};

interface RegisterFormProps {
  form: RegisterFormState;
  setForm: React.Dispatch<React.SetStateAction<RegisterFormState>>;
  submitting: boolean;
  error: string | null;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onSwitchMode: () => void;
}

const RegisterForm: React.FC<RegisterFormProps> = ({
  form,
  setForm,
  submitting,
  error,
  onSubmit,
  onSwitchMode,
}) => {
  return (
    <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <p
          style={{
            margin: 0,
            fontSize: '12px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#a5b4fc',
            fontWeight: 600,
          }}
        >
          Create access
        </p>
        <h2 style={{ margin: '6px 0 0', fontSize: '24px' }}>Register for batch tools</h2>
      </div>

      {error && (
        <div
          style={{
            background: '#fee2e2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            padding: '8px 10px',
            borderRadius: '8px',
            fontSize: '13px',
          }}
        >
          {error}
        </div>
      )}

      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
        Email
        <input
          type="email"
          required
          value={form.email}
          onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
          placeholder="you@school.org"
          style={inputStyle}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
        Password
        <input
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
          placeholder="Minimum 8 characters"
          style={inputStyle}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
        Confirm password
        <input
          type="password"
          required
          value={form.confirmPassword}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, confirmPassword: event.target.value }))
          }
          placeholder="Repeat password"
          style={inputStyle}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
        Role
        <select
          value={form.role}
          onChange={(event) =>
            setForm((prev) => ({ ...prev, role: event.target.value as RegisterableRole }))
          }
          style={{
            ...inputStyle,
            height: '40px',
          }}
        >
          <option value="user">Tutor (full access)</option>
          <option value="viewer">Viewer (read-only)</option>
        </select>
      </label>

      <button type="submit" disabled={submitting} style={primaryButtonStyle(submitting)}>
        {submitting ? 'Creating account…' : 'Register'}
      </button>

      <p style={{ margin: 0, textAlign: 'center', fontSize: '13px', color: '#475569' }}>
        Already have an account?{' '}
        <button
          type="button"
          onClick={onSwitchMode}
          style={{
            background: 'none',
            border: 'none',
            color: '#4f46e5',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Sign in
        </button>
      </p>
    </form>
  );
};

const inputStyle: React.CSSProperties = {
  borderRadius: '10px',
  border: '1px solid #c7d2fe',
  padding: '10px 12px',
  fontSize: '14px',
  outline: 'none',
  fontFamily: 'inherit',
  transition: 'border-color 0.15s ease',
};

const primaryButtonStyle = (disabled: boolean): React.CSSProperties => ({
  border: 'none',
  borderRadius: '999px',
  padding: '12px 18px',
  background: disabled ? '#c7d2fe' : 'linear-gradient(120deg, #6366f1, #8b5cf6)',
  color: '#fff',
  fontWeight: 600,
  fontSize: '15px',
  cursor: disabled ? 'default' : 'pointer',
  boxShadow: disabled ? 'none' : '0 10px 25px rgba(99, 102, 241, 0.35)',
  transition: 'transform 0.2s ease, box-shadow 0.2s ease',
});
