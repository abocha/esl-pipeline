import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExtendedRoutesContext } from '../src/transport/extended-routes/context.js';

const registerInvitedUserMock = vi.hoisted(() => vi.fn());

vi.mock('../src/application/alpha-invites.js', () => {
  class AlphaInviteError extends Error {
    status: number;
    code: string;

    constructor(message: string, code: string, status: number) {
      super(message);
      this.name = 'AlphaInviteError';
      this.code = code;
      this.status = status;
    }
  }

  return {
    AlphaInviteError,
    registerInvitedUser: registerInvitedUserMock,
  };
});

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  child: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: loggerMock,
}));

import { registerAuthUserRoutes } from '../src/transport/extended-routes/auth-user-routes.js';

describe('registerAuthUserRoutes auth registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerInvitedUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@example.com',
      passwordHash: 'hashed-password',
      role: 'user',
      isActive: true,
      createdAt: new Date('2026-07-08T00:00:00Z'),
      updatedAt: new Date('2026-07-08T00:00:00Z'),
      lastLoginAt: null,
    });
  });

  it('returns an authenticated session when invite registration succeeds', async () => {
    const app = Fastify();
    await app.register(cookie);

    const context = {
      config: {
        auth: {
          refreshCookieName: 'refresh',
          refreshCookieSecure: true,
          refreshCookieSameSite: 'lax',
          refreshCookiePath: '/',
          refreshCookieDomain: undefined,
        },
      },
      authService: {
        validateEmail: vi.fn(() => true),
        validatePassword: vi.fn(() => ({ valid: true, errors: [] })),
        hashPassword: vi.fn(async () => 'hashed-password'),
        generateTokens: vi.fn(() => ({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresIn: 900,
          refreshExpiresIn: 604_800,
        })),
      },
      authenticate: vi.fn(async () => undefined),
      uploadRateLimitMiddleware: vi.fn(async () => undefined),
    } as unknown as ExtendedRoutesContext;

    registerAuthUserRoutes(app, context);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        email: 'Teacher@Example.com',
        password: 'long enough',
        inviteToken: 'invite-token',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      message: 'User registered successfully',
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        role: 'user',
        isActive: true,
      },
      accessToken: 'access-token',
      expiresIn: 900,
    });
    expect(response.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'refresh',
          value: 'refresh-token',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        }),
      ]),
    );

    await app.close();
  });
});
