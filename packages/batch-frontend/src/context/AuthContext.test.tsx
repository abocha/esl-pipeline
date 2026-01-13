import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { AuthProvider, useAuth } from './AuthContext';
import { refreshToken } from '../utils/api';

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../utils/api')>('../utils/api');
  return {
    ...actual,
    refreshToken: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logoutSession: vi.fn(),
  };
});

const AuthProbe = () => {
  const { user, isLoading } = useAuth();
  return (
    <div>
      <div data-testid="loading">{isLoading ? 'loading' : 'ready'}</div>
      <div data-testid="user">{user?.email ?? 'none'}</div>
    </div>
  );
};

describe('AuthContext refresh bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('hydrates user on refresh token success', async () => {
    vi.mocked(refreshToken).mockResolvedValue({
      user: {
        id: 'user-1',
        email: 'test@example.com',
        role: 'user',
        isActive: true,
      },
      accessToken: 'access-token',
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('ready');
      expect(screen.getByTestId('user').textContent).toBe('test@example.com');
    });
  });

  it('clears session when refresh fails', async () => {
    vi.mocked(refreshToken).mockRejectedValue(new Error('refresh failed'));

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('ready');
      expect(screen.getByTestId('user').textContent).toBe('none');
    });
  });
});
