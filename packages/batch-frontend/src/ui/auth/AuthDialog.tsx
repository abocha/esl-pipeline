import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

import { useAuth } from '../../context/AuthContext';

export type AuthMode = 'login' | 'register';

interface AuthDialogProps {
  mode: AuthMode | null;
  initialEmail?: string;
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
  onClose,
  onSwitchMode,
  onRegistered,
}) => {
  const { login, register } = useAuth();
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
    if (mode) {
      setError(null);
      setPassword('');
      setConfirmPassword('');
    }
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

      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }

      setIsLoading(true);
      try {
        if (mode === 'login') {
          await login(email, password);
          toast.success('Welcome back!');
          onClose();
        } else {
          await register(email, password, 'user');
          onRegistered?.(email);
        }
      } catch (error_: unknown) {
        const message = error_ instanceof Error ? error_.message : 'Something went wrong';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [mode, email, password, confirmPassword, login, register, onClose, onRegistered],
  );

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && mode) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mode, onClose]);

  if (!mode) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog-container animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <button type="button" onClick={onClose} className="dialog-close">
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
          <h2>{mode === 'login' ? 'Welcome back' : 'Create account'}</h2>
          <p>
            {mode === 'login'
              ? 'Sign in to access your batch jobs'
              : 'Start processing lessons in minutes'}
          </p>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="dialog-form">
          {error && (
            <div className="form-error animate-fade-in">
              <span>⚠️</span>
              {error}
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
                autoFocus
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
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
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
      </div>

      <style>{`
        .dialog-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.6);
          backdrop-filter: blur(4px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: var(--z-modal-backdrop);
          padding: var(--space-4);
          animation: fadeIn 0.2s ease-out;
        }

        .dialog-container {
          position: relative;
          width: 100%;
          max-width: 400px;
          background: var(--bg-primary);
          border-radius: var(--radius-2xl);
          box-shadow: var(--shadow-2xl);
          padding: var(--space-8);
          z-index: var(--z-modal);
        }

        .dialog-close {
          position: absolute;
          top: var(--space-4);
          right: var(--space-4);
          width: 36px;
          height: 36px;
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          border: 1px solid var(--border-light);
          color: var(--text-tertiary);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .dialog-close:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }

        .dialog-header {
          text-align: center;
          margin-bottom: var(--space-6);
        }

        .dialog-logo {
          width: 56px;
          height: 56px;
          background: var(--gradient-primary);
          border-radius: var(--radius-xl);
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto var(--space-4);
          box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3);
        }

        .dialog-logo svg {
          filter: brightness(0) invert(1);
        }

        .dialog-header h2 {
          font-size: var(--text-xl);
          margin: 0 0 var(--space-2);
        }

        .dialog-header p {
          font-size: var(--text-sm);
          color: var(--text-secondary);
          margin: 0;
        }

        .dialog-form {
          display: flex;
          flex-direction: column;
          gap: var(--space-4);
        }

        .form-error {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-3) var(--space-4);
          background: rgba(244, 63, 94, 0.1);
          border: 1px solid rgba(244, 63, 94, 0.3);
          border-radius: var(--radius-lg);
          color: var(--color-error-600);
          font-size: var(--text-sm);
        }

        .form-field {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
        }

        .form-field label {
          font-size: var(--text-sm);
          font-weight: 600;
          color: var(--text-primary);
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-icon {
          position: absolute;
          left: var(--space-3);
          color: var(--text-tertiary);
          pointer-events: none;
        }

        .input-wrapper input {
          padding-left: calc(var(--space-3) + 24px);
          padding-right: var(--space-4);
        }

        .input-toggle {
          position: absolute;
          right: var(--space-2);
          padding: var(--space-2);
          background: none;
          border: none;
          color: var(--text-tertiary);
          cursor: pointer;
          border-radius: var(--radius-md);
          transition: all var(--transition-fast);
        }

        .input-toggle:hover {
          color: var(--text-primary);
          background: var(--bg-tertiary);
        }

        .btn-submit {
          width: 100%;
          padding: var(--space-4);
          background: var(--gradient-primary);
          border: none;
          border-radius: var(--radius-lg);
          color: white;
          font-size: var(--text-base);
          font-weight: 600;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          transition: all var(--transition-fast);
          box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
        }

        .btn-submit:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 6px 20px rgba(99, 102, 241, 0.45);
        }

        .btn-submit:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .dialog-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: var(--space-2);
          margin-top: var(--space-6);
          padding-top: var(--space-5);
          border-top: 1px solid var(--border-light);
          font-size: var(--text-sm);
          color: var(--text-secondary);
        }

        .btn-switch {
          background: none;
          border: none;
          color: var(--color-primary-500);
          font-weight: 600;
          cursor: pointer;
          padding: 0;
        }

        .btn-switch:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
};
