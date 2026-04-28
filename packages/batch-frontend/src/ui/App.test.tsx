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

vi.mock('../context/AuthContext', () => ({
  useAuth: useAuthMock,
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

    expect(await screen.findByRole('heading', { name: /Welcome back/i })).toBeTruthy();
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
    expect(screen.getByText('Minimal assignment content')).toBeTruthy();
    expect(document.querySelector('style')?.textContent ?? '').not.toContain('.app-shell::before');

    await user.click(screen.getByRole('link', { name: /Skip to main content/i }));

    expect(document.activeElement).toBe(document.getElementById('main-content'));
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
