import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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

function renderApp() {
  return render(
    <MemoryRouter>
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

    expect(screen.getByRole('heading', { name: /Welcome back/i })).toBeTruthy();
  });

  it('renders the authenticated shell and assignment route', () => {
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

    expect(screen.getByText('teacher@example.com')).toBeTruthy();
    expect(screen.getByText('Minimal assignment content')).toBeTruthy();
  });

  it('logs out and shows a success toast', async () => {
    const user = userEvent.setup();
    const logout = vi.fn().mockResolvedValue();
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
