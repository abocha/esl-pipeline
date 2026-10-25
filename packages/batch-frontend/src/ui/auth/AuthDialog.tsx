import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../../context/AuthContext';
import { LegalLinks } from '../LegalLinks';

import './AuthDialog.css';

export type AuthMode = 'login' | 'register';

const PASSWORD_REQUIREMENT =
  'Use at least 8 characters. Spaces are okay; no symbols or numbers are required.';

interface AuthDialogProps {
  mode: AuthMode | null;
  initialEmail?: string;
  inviteToken?: string | null;
  onClose: () => void;
  onSwitchMode: (mode: AuthMode) => void;
  onRegistered?: (email: string) => void;
}

// Icons
const XIcon = () => (
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
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const MailIcon = () => (
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
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const LockIcon = () => (
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
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const EyeIcon = () => (
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
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
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
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export const AuthDialog: React.FC<AuthDialogProps> = ({
  mode,
  initialEmail = '',
  inviteToken = null,
  onClose,
  onSwitchMode,
  onRegistered,
}) => {
  const { login, register } = useAuth();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialEmail) setEmail(initialEmail);
  }, [initialEmail]);

  useEffect(() => {
    let focusTimer: number | undefined;

    if (mode) {
      setError(null);
      setPassword('');
      setConfirmPassword('');
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.body.classList.add('dialog-open');
      focusTimer = window.setTimeout(() => {
        const firstInput = dialogRef.current?.querySelector<HTMLInputElement>(
          'input:not([type="hidden"]):not(:disabled)',
        );
        firstInput?.focus();
      }, 0);
    }

    return () => {
      if (focusTimer !== undefined) {
        window.clearTimeout(focusTimer);
      }
      document.body.classList.remove('dialog-open');
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [mode]);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      if (!email.trim() || !password) {
        setError('Please fill in all fields');
        return;
      }

      if (mode === 'register' && password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }

      if (mode === 'register' && !inviteToken) {
        setError('Open the invitation link from your email to create an account.');
        return;
      }

      if (mode === 'register' && password.length < 8) {
        setError('Use at least 8 characters.');
        return;
      }

      setIsLoading(true);
      try {
        if (mode === 'login') {
          await login(email, password);
          onClose();
        } else {
          await register(email, password, 'user', inviteToken ?? undefined);
          onRegistered?.(email);
          onClose();
        }
      } catch (error_: unknown) {
        const message = error_ instanceof Error ? error_.message : 'Something went wrong';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [mode, email, password, confirmPassword, inviteToken, login, register, onClose, onRegistered],
  );

  useEffect(() => {
    const handleDialogKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode) {
        onClose();
        return;
      }

      if (e.key !== 'Tab' || !mode || !dialogRef.current) {
        return;
      }

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter(
        (element) =>
          !element.hasAttribute('hidden') && element.getAttribute('aria-hidden') !== 'true',
      );

      if (focusable.length === 0) {
        e.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleDialogKeys, true);
    return () => document.removeEventListener('keydown', handleDialogKeys, true);
  }, [mode, onClose]);

  if (!mode) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dialog-container animate-scale-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-dialog-title"
        aria-describedby="auth-dialog-description"
        tabIndex={-1}
      >
        <button type="button" onClick={onClose} className="dialog-close" aria-label="Close dialog">
          <XIcon />
        </button>

        <div className="dialog-header">
          <div className="dialog-logo">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="url(#authGradient)" />
              <path
                d="M2 17L12 22L22 17"
                stroke="url(#authGradient)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M2 12L12 17L22 12"
                stroke="url(#authGradient)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <defs>
                <linearGradient
                  id="authGradient"
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
          <h2 id="auth-dialog-title">{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
          <p id="auth-dialog-description">
            {mode === 'login'
              ? 'Sign in to access your teaching workspace'
              : inviteToken
                ? 'Finish your invited closed-alpha account'
                : 'Closed alpha accounts require an invitation link'}
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="dialog-form">
          {error && (
            <div className="form-error animate-fade-in" role="alert" aria-live="assertive">
              <span aria-hidden="true">⚠️</span>
              {error}
            </div>
          )}

          {mode === 'register' && (
            <div className={inviteToken ? 'invite-status invite-status-ready' : 'invite-status'}>
              <strong>
                {inviteToken ? 'Invitation link detected' : 'Invitation link required'}
              </strong>
              <span>
                {inviteToken
                  ? 'Use the invited email address, then you will enter the workspace automatically.'
                  : 'Open the private invite link from your email before creating an account.'}
              </span>
            </div>
          )}

          <div className="form-field">
            <label htmlFor="email">Email</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <MailIcon />
              </span>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="password">Password</label>
            <div className="input-wrapper">
              <span className="input-icon">
                <LockIcon />
              </span>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="input-toggle"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {mode === 'register' && <p className="form-hint">{PASSWORD_REQUIREMENT}</p>}
          </div>

          {mode === 'register' && (
            <div className="form-field animate-fade-in">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <div className="input-wrapper">
                <span className="input-icon">
                  <LockIcon />
                </span>
                <input
                  id="confirmPassword"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}

          <button type="submit" disabled={isLoading} className="btn-submit">
            {isLoading ? (
              <>
                <span className="spinner" />
                {mode === 'login' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : mode === 'login' ? (
              'Sign in'
            ) : (
              'Create account'
            )}
          </button>
        </form>

        <div className="dialog-footer">
          <span>{mode === 'login' ? "Don't have an account?" : 'Already have an account?'}</span>
          <button
            type="button"
            onClick={() => onSwitchMode(mode === 'login' ? 'register' : 'login')}
            className="btn-switch"
          >
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </div>
        <LegalLinks />
      </div>
    </div>
  );
};
