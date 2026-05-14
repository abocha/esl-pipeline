import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from './AuthContext';

const apiMocks = vi.hoisted(() => ({
  login: vi.fn(),
  logoutSession: vi.fn(),
  refreshToken: vi.fn(),
  register: vi.fn(),
}));

const apiClientMocks = vi.hoisted(() => ({
  setApiAuthRefreshHandler: vi.fn(),
  setApiAuthToken: vi.fn(),
}));

vi.mock('../utils/api', () => apiMocks);

vi.mock('../utils/api-client', () => apiClientMocks);

function AuthProbe(): React.JSX.Element {
  const { isAuthenticated, isLoading, user } = useAuth();
  if (isLoading) return <p>Loading session</p>;
  return <p>{isAuthenticated ? user?.email : 'Signed out'}</p>;
}

function AuthControls(): React.JSX.Element {
  const { isLoading, logout } = useAuth();
  return (
    <button type="button" onClick={() => void logout()}>
      {isLoading ? 'Loading' : 'Logout'}
    </button>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.refreshToken.mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        role: 'user',
        isActive: true,
      },
      accessToken: 'access-token-1',
      expiresIn: 1800,
      message: 'Token refresh successful',
    });
  });

  it('deduplicates session hydration refreshes under React StrictMode', async () => {
    render(
      <React.StrictMode>
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      </React.StrictMode>,
    );

    expect(await screen.findByText('teacher@example.com')).toBeTruthy();

    await waitFor(() => {
      expect(apiMocks.refreshToken).toHaveBeenCalledTimes(1);
    });
    expect(apiClientMocks.setApiAuthToken).toHaveBeenCalledWith('access-token-1');
  });

  it('does not restore a stale refresh result after logout wins the session generation', async () => {
    let resolveRefresh: (value: Awaited<ReturnType<typeof apiMocks.refreshToken>>) => void =
      () => {};
    apiMocks.refreshToken.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    apiMocks.logoutSession.mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <AuthProbe />
        <AuthControls />
      </AuthProvider>,
    );

    screen.getByRole('button', { name: /Loading/i }).click();

    await waitFor(() => {
      expect(apiMocks.logoutSession).toHaveBeenCalledTimes(1);
    });

    resolveRefresh({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        role: 'user',
        isActive: true,
      },
      accessToken: 'access-token-1',
      expiresIn: 1800,
      message: 'Token refresh successful',
    });

    await waitFor(() => {
      expect(screen.getByText('Signed out')).toBeTruthy();
    });
    expect(apiClientMocks.setApiAuthToken).not.toHaveBeenCalledWith('access-token-1');
  });

  it('registers a refresh handler that updates the active access token', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(await screen.findByText('teacher@example.com')).toBeTruthy();

    apiMocks.refreshToken.mockResolvedValueOnce({
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        role: 'user',
        isActive: true,
      },
      accessToken: 'access-token-2',
      expiresIn: 1800,
      message: 'Token refresh successful',
    });

    const registeredHandler = apiClientMocks.setApiAuthRefreshHandler.mock.calls.find(
      ([handler]) => typeof handler === 'function',
    )?.[0];

    expect(registeredHandler).toBeTypeOf('function');
    await expect(registeredHandler()).resolves.toEqual({ accessToken: 'access-token-2' });

    await waitFor(() => {
      expect(apiClientMocks.setApiAuthToken).toHaveBeenCalledWith('access-token-2');
    });
  });
});
