import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserSettingsRecord } from '../src/domain/settings-model.js';
import type { UserRecord } from '../src/domain/user-model.js';
import type { ExtendedRoutesContext } from '../src/transport/extended-routes/context.js';

const registerInvitedUserMock = vi.hoisted(() => vi.fn());
const userRepositoryMock = vi.hoisted(() => ({
  countUsers: vi.fn(),
  getAllUsers: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  updateUserLastLogin: vi.fn(),
}));
const settingsRepositoryMock = vi.hoisted(() => ({
  createDefaultSettings: vi.fn(),
  getSettingsByUserId: vi.fn(),
  upsertSettings: vi.fn(),
}));

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

vi.mock('../src/domain/user-repository.js', () => userRepositoryMock);
vi.mock('../src/domain/settings-repository.js', () => settingsRepositoryMock);

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  child: vi.fn().mockReturnValue({
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  logger: loggerMock,
}));

import { AlphaInviteError } from '../src/application/alpha-invites.js';
import { registerAuthUserRoutes } from '../src/transport/extended-routes/auth-user-routes.js';

const user: UserRecord = {
  id: 'user-1',
  email: 'teacher@example.com',
  passwordHash: 'hashed-password',
  role: 'user',
  isActive: true,
  createdAt: new Date('2026-07-08T00:00:00Z'),
  updatedAt: new Date('2026-07-08T00:00:00Z'),
  lastLoginAt: null,
};

const settings: UserSettingsRecord = {
  userId: user.id,
  elevenLabsKeyEncrypted: 'encrypted-api-key',
  ttsProvider: 'elevenlabs',
  defaultPreset: 'b1-default',
  defaultVoiceAccent: 'american',
  defaultTtsStrategy: 'auto',
  enableNotifications: true,
  createdAt: new Date('2026-07-08T00:00:00Z'),
  updatedAt: new Date('2026-07-08T00:00:00Z'),
};

function createContext(): ExtendedRoutesContext {
  return {
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
      verifyPassword: vi.fn(async () => true),
      generateTokens: vi.fn(() => ({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 900,
        refreshExpiresIn: 604_800,
      })),
      verifyRefreshToken: vi.fn(() => ({
        sub: user.id,
        email: user.email,
        role: user.role,
        iat: 1,
        exp: 2,
        type: 'refresh',
      })),
      refreshTokens: vi.fn(() => ({
        accessToken: 'refreshed-access-token',
        refreshToken: 'refreshed-refresh-token',
        expiresIn: 900,
        refreshExpiresIn: 604_800,
      })),
    },
    authenticate: vi.fn(async (request: FastifyRequest) => {
      const id = request.headers['x-test-user-id'];
      const role = request.headers['x-test-user-role'];
      if (typeof id === 'string' && (role === 'admin' || role === 'user' || role === 'viewer')) {
        (
          request as FastifyRequest & { user: { id: string; email: string; role: typeof role } }
        ).user = {
          id,
          email: user.email,
          role,
        };
      }
    }),
    uploadRateLimitMiddleware: vi.fn(async () => undefined),
  } as unknown as ExtendedRoutesContext;
}

async function createApp(context = createContext()): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cookie);
  registerAuthUserRoutes(app, context);
  return app;
}

function expectRefreshCookie(
  response: {
    cookies: {
      name: string;
      value: string;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: string;
    }[];
  },
  value: string,
): void {
  expect(response.cookies).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'refresh',
        value,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      }),
    ]),
  );
}

describe('registerAuthUserRoutes authentication contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerInvitedUserMock.mockResolvedValue(user);
    userRepositoryMock.getUserByEmail.mockResolvedValue(user);
    userRepositoryMock.getUserById.mockResolvedValue(user);
    userRepositoryMock.updateUserLastLogin.mockResolvedValue(undefined);
    settingsRepositoryMock.getSettingsByUserId.mockResolvedValue(settings);
  });

  it('returns an authenticated session and secure refresh cookie after valid login', async () => {
    const context = createContext();
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'Teacher@Example.com', password: 'long enough' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: 'Login successful',
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        role: 'user',
        isActive: true,
      },
      accessToken: 'access-token',
      expiresIn: 900,
    });
    expectRefreshCookie(response, 'refresh-token');
    await app.close();
  });

  it('rejects invalid credentials without issuing a refresh cookie', async () => {
    userRepositoryMock.getUserByEmail.mockResolvedValue(null);
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'wrong password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'unauthorized',
      message: 'Invalid credentials',
      code: 'invalid_credentials',
    });
    expect(response.cookies).toEqual([]);
    await app.close();
  });

  it('rejects an incorrect password without issuing a refresh cookie', async () => {
    const context = createContext();
    context.authService.verifyPassword = vi.fn(async () => false);
    const app = await createApp(context);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'wrong password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'unauthorized',
      message: 'Invalid credentials',
      code: 'invalid_credentials',
    });
    expect(response.cookies).toEqual([]);
    await app.close();
  });

  it('does not reveal that an inactive account exists during login', async () => {
    userRepositoryMock.getUserByEmail.mockResolvedValue({ ...user, isActive: false });
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'long enough' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: 'unauthorized',
      message: 'Invalid credentials',
      code: 'invalid_credentials',
    });
    expect(response.cookies).toEqual([]);
    await app.close();
  });

  it('refreshes an active user session from the refresh cookie', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { refresh: 'valid-refresh-token' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      message: 'Token refresh successful',
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        role: 'user',
        isActive: true,
      },
      accessToken: 'refreshed-access-token',
      expiresIn: 900,
    });
    expectRefreshCookie(response, 'refreshed-refresh-token');
    await app.close();
  });

  it.each([
    ['malformed', new Error('Invalid refresh token')],
    ['expired', new Error('Refresh token expired')],
  ])(
    'rejects a %s refresh token with the same deterministic public error',
    async (_caseName, error) => {
      const context = createContext();
      context.authService.verifyRefreshToken = vi.fn(() => {
        throw error;
      });
      const app = await createApp(context);

      const response = await app.inject({
        method: 'POST',
        url: '/auth/refresh',
        payload: { refreshToken: 'invalid-refresh-token' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({
        error: 'unauthorized',
        message: 'Invalid refresh token',
        code: 'invalid_refresh_token',
      });
      expect(response.cookies).toEqual([]);
      await app.close();
    },
  );

  it('clears the configured refresh cookie on logout', async () => {
    const app = await createApp();

    const response = await app.inject({ method: 'POST', url: '/auth/logout' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ message: 'Logout successful' });
    expect(response.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'refresh', value: '', maxAge: 0, path: '/' }),
      ]),
    );
    await app.close();
  });

  it('rejects registration when required invite fields are missing', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: user.email, password: 'long enough' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_failed',
      message: 'Email, password, and invite token are required',
      code: 'missing_fields',
    });
    await app.close();
  });

  it('returns an authenticated session after successful invite registration', async () => {
    const app = await createApp();

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
    expect(response.json()).toEqual({
      message: 'User registered successfully',
      user: {
        id: 'user-1',
        email: 'teacher@example.com',
        role: 'user',
        isActive: true,
        createdAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:00:00.000Z',
        lastLoginAt: null,
      },
      accessToken: 'access-token',
      expiresIn: 900,
    });
    expectRefreshCookie(response, 'refresh-token');
    await app.close();
  });

  it('maps invite conflicts to the public conflict contract', async () => {
    registerInvitedUserMock.mockRejectedValue(
      new AlphaInviteError('User with this email already exists', 'email_exists', 409),
    );
    const app = await createApp();

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: user.email, password: 'long enough', inviteToken: 'invite-token' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'conflict',
      message: 'User with this email already exists',
      code: 'email_exists',
    });
    await app.close();
  });

  it('returns sanitized settings for an authenticated user', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/user/settings',
      headers: { 'x-test-user-id': user.id, 'x-test-user-role': 'user' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      settings: {
        hasElevenLabsKey: true,
        ttsProvider: 'elevenlabs',
        defaultPreset: 'b1-default',
        defaultVoiceAccent: 'american',
        defaultTtsStrategy: 'auto',
        enableNotifications: true,
        createdAt: '2026-07-08T00:00:00.000Z',
        updatedAt: '2026-07-08T00:00:00.000Z',
      },
    });
    await app.close();
  });

  it('rejects a non-admin user at the admin route authorization boundary', async () => {
    const app = await createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { 'x-test-user-id': user.id, 'x-test-user-role': 'user' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      error: 'forbidden',
      message: 'Insufficient permissions',
      requiredRoles: ['admin'],
    });
    await app.close();
  });
});
