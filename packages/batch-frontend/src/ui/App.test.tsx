// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuthContextType } from '../context/AuthContext';
import { App } from './App';

const useAuthMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
const sandboxModeMock = vi.hoisted(() => vi.fn(() => false));
const UI_WAIT_TIMEOUT_MS = 10_000;

vi.mock('../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

vi.mock('../dev/frontend-sandbox', () => ({
  isFrontendSandboxEnabled: sandboxModeMock,
}));

vi.mock('./minimal/MinimalAssignment', () => ({
  MinimalAssignment: () => <div>Minimal assignment content</div>,
}));

vi.mock('./students/StudentDirectoryPage', () => ({
  StudentDirectoryPage: () => <div>Student directory content</div>,
}));

vi.mock('./students/StudentAreaShell', () => ({
  StudentAreaShell: () => (
    <div>
      Student area shell
      <Outlet />
    </div>
  ),
}));

vi.mock('./students/StudentOverviewPage', () => ({
  StudentOverviewPage: () => <div>Student overview content</div>,
}));

vi.mock('./students/StudentLearningPage', () => ({
  StudentLearningPage: () => <div>Student learning content</div>,
}));

vi.mock('./students/StudentHistoryPage', () => ({
  StudentHistoryPage: () => <div>Student history content</div>,
}));

vi.mock('./students/StudentScheduleBillingPage', () => ({
  StudentScheduleBillingPage: () => <div>Student schedule content</div>,
}));

vi.mock('./business/BusinessShell', () => ({
  BusinessShell: () => (
    <div>
      Business shell
      <Outlet />
    </div>
  ),
}));

vi.mock('./business/BusinessSchedulePage', () => ({
  BusinessSchedulePage: () => <div>Business schedule content</div>,
}));

vi.mock('./business/BusinessStatsPage', () => ({
  BusinessStatsPage: () => <div>Business stats content</div>,
}));

vi.mock('./business/BusinessSettingsPage', () => ({
  BusinessSettingsPage: () => <div>Business settings content</div>,
}));

vi.mock('./prompts/PromptTemplatesPage', () => ({
  PromptTemplatesPage: () => <div>Prompt templates content</div>,
}));

vi.mock('react-hot-toast', () => ({
  toast: toastMock,
  default: toastMock,
}));

function createAuthState(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    setUserFromProfile: vi.fn(),
    ...overrides,
  };
}

function renderApp(initialEntries: string[] = ['/']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sandboxModeMock.mockReturnValue(false);
    window.history.replaceState(null, '', '/');
  });

  it('shows the loading panel while session restore is in progress', () => {
    useAuthMock.mockReturnValue(createAuthState({ isLoading: true }));

    renderApp();

    expect(screen.getByText(/Restoring your session/i)).toBeTruthy();
  });

  it('renders the unauthenticated view and opens login dialog', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(createAuthState());

    renderApp();

    expect(screen.getByRole('heading', { name: /Sign in to get started/i })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Login to your account/i }));

    expect(
      await screen.findByRole(
        'heading',
        { name: /Welcome back/i },
        { timeout: UI_WAIT_TIMEOUT_MS },
      ),
    ).toBeTruthy();
  });

  it('opens registration when an invite token is present in the URL fragment', async () => {
    window.history.replaceState(null, '', '/#invite=invite-token');
    useAuthMock.mockReturnValue(createAuthState());

    renderApp();

    expect(await screen.findByRole('heading', { name: /Create account/i })).toBeTruthy();
  });

  it('opens auth as a labelled modal, traps focus, and restores focus on close', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(createAuthState());

    renderApp();

    const loginButton = screen.getByRole('button', { name: /Login to your account/i });
    loginButton.focus();

    await user.click(loginButton);

    const dialog = await screen.findByRole(
      'dialog',
      { name: /Welcome back/i },
      { timeout: UI_WAIT_TIMEOUT_MS },
    );
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-describedby')).toBe('auth-dialog-description');
    expect(await screen.findByLabelText(/Email/i)).toBe(document.activeElement);

    for (let index = 0; index < 8; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(loginButton).toBe(document.activeElement);
    expect(document.body.classList.contains('dialog-open')).toBe(false);
  });

  it('announces auth form validation errors', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(createAuthState());

    renderApp();

    await user.click(screen.getByRole('button', { name: /Login to your account/i }));
    await user.click(
      await screen.findByRole('button', { name: /^Sign in$/i }, { timeout: UI_WAIT_TIMEOUT_MS }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Please fill in all fields');
  });

  it('renders the authenticated shell and assignment route', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'user-1',
          email: 'teacher@example.com',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
      }),
    );

    renderApp();

    expect(screen.getByRole('link', { name: /Skip to main content/i }).getAttribute('href')).toBe(
      '#main-content',
    );
    expect(screen.getByRole('link', { name: /Assignments/i })).toBeTruthy();
    expect(screen.getByText('teacher@example.com')).toBeTruthy();
    expect(await screen.findByText('Minimal assignment content')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Business/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Assignment Templates/i })).toBeTruthy();
    expect(document.querySelector('style')?.textContent ?? '').not.toContain('.app-shell::before');

    await user.click(screen.getByRole('link', { name: /Skip to main content/i }));

    expect(document.activeElement).toBe(document.getElementById('main-content'));
  });

  it('marks authenticated screens when the dev sandbox is active', async () => {
    sandboxModeMock.mockReturnValue(true);
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'sandbox-tutor',
          email: 'sandbox.tutor@example.test',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
      }),
    );

    renderApp();

    expect(await screen.findByText('Minimal assignment content')).toBeTruthy();
    expect(screen.getByLabelText(/Frontend sandbox mode/i).textContent).toContain('Mock data');
  });

  it('navigates to the student directory route from shell navigation', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'user-1',
          email: 'teacher@example.com',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
      }),
    );

    renderApp();

    await user.click(screen.getByRole('link', { name: /Students/i }));

    expect(await screen.findByText('Student directory content')).toBeTruthy();
  });

  it('renders the prompt templates route from shell navigation', async () => {
    const user = userEvent.setup();
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'user-1',
          email: 'teacher@example.com',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
      }),
    );

    renderApp();

    await user.click(screen.getByRole('link', { name: /Assignment Templates/i }));

    expect(await screen.findByText('Prompt templates content')).toBeTruthy();
  });

  it('redirects /business to the business schedule route', async () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'user-1',
          email: 'teacher@example.com',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
      }),
    );

    renderApp(['/business']);

    expect(await screen.findByText('Business schedule content')).toBeTruthy();
  });

  it('renders the business stats route', async () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'user-1',
          email: 'teacher@example.com',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
      }),
    );

    renderApp(['/business/stats']);

    expect(await screen.findByText('Business stats content')).toBeTruthy();
  });

  it('redirects /students/:studentId to the overview page', async () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'user-1',
          email: 'teacher@example.com',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
      }),
    );

    renderApp(['/students/student-1']);

    expect(await screen.findByText('Student overview content')).toBeTruthy();
  });

  it('renders the dedicated learning route', async () => {
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'user-1',
          email: 'teacher@example.com',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
      }),
    );

    renderApp(['/students/student-1/learning']);

    expect(await screen.findByText('Student learning content')).toBeTruthy();
  });

  it('logs out and shows a success toast', async () => {
    const user = userEvent.setup();
    const logout = vi.fn(async () => {});
    useAuthMock.mockReturnValue(
      createAuthState({
        user: {
          id: 'user-1',
          email: 'teacher@example.com',
          role: 'user',
          isActive: true,
        },
        isAuthenticated: true,
        logout,
      }),
    );

    renderApp();

    await user.click(screen.getByRole('button', { name: /Logout/i }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
    });
    expect(toastMock.success).toHaveBeenCalledWith('Logged out successfully');
  });
});
