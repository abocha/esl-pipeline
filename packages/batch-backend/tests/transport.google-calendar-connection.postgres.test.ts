import './support/bootstrap-pg-test-env.js';
import { randomBytes, randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config/env.js';
import {
  calendarTransaction,
  getCalendarAccess,
} from '../src/domain/google-connection-repository.js';
import { createAuthService } from '../src/infrastructure/auth-service.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import {
  type GoogleGrantTokens,
  GoogleOAuthClient,
} from '../src/infrastructure/google-oauth-client.js';
import { logger } from '../src/infrastructure/logger.js';
import { authenticate, configureAuthMiddleware } from '../src/transport/auth-middleware.js';
import { CALENDAR_ATTEMPT_COOKIE } from '../src/transport/calendar-attempt-cookie.js';
import { registerErrorHandler } from '../src/transport/error-handler.js';
import { registerAuthUserRoutes } from '../src/transport/extended-routes/auth-user-routes.js';
import type { ExtendedRoutesContext } from '../src/transport/extended-routes/context.js';
import { registerGoogleCalendarConnectionRoutes } from '../src/transport/extended-routes/google-calendar-connection-routes.js';
import { registerSecurityHeaders } from '../src/transport/security-headers.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();
const key = randomBytes(32).toString('base64');
const auth = createAuthService({
  jwtSecret: 'calendar-test-only-signing-secret',
  jwtExpiresIn: '15m',
  refreshTokenExpiresIn: '7d',
  bcryptRounds: 4,
});
let passwordHash: string;
let app: ReturnType<typeof Fastify>;
const tokens: GoogleGrantTokens = {
  subject: 'google-subject-A',
  issuer: 'https://accounts.google.com',
  email: 'google-account@example.test',
  scopes: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events',
  ],
  accessToken: 'access-token-sentinel',
  refreshToken: 'refresh-token-sentinel',
  expiresAt: new Date(Date.now() + 3600_000),
};

async function seed(role = 'owner') {
  const userId = randomUUID(),
    workspaceId = randomUUID(),
    email = `${userId}@example.test`;
  await withPgClient(async (client) => {
    await client.query(
      `INSERT INTO users(id,email,password_hash,role,is_active) VALUES($1,$2,$3,'user',true)`,
      [userId, email, passwordHash],
    );
    await client.query('INSERT INTO workspaces(id,name) VALUES($1,$2)', [
      workspaceId,
      'Synthetic calendar workspace',
    ]);
    await client.query(
      'INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,$3)',
      [workspaceId, userId, role],
    );
  });
  return { userId, workspaceId, email, ...auth.generateTokens(userId, email, 'user') };
}
type User = Awaited<ReturnType<typeof seed>>;
async function start(user: User, binding?: string) {
  const response = await app.inject({
    method: 'POST',
    url: `/workspaces/${user.workspaceId}/calendar/connect`,
    headers: {
      authorization: `Bearer ${user.accessToken}`,
      cookie: `esl_refresh=${user.refreshToken}${binding ? `; ${CALENDAR_ATTEMPT_COOKIE}=${binding}` : ''}`,
    },
  });
  expect(response.statusCode).toBe(200);
  const url = new URL(response.json().authorizationUrl);
  return {
    state: url.searchParams.get('state')!,
    binding: response.cookies.find(
      (c: { name: string; value: string }) => c.name === CALENDAR_ATTEMPT_COOKIE,
    )!.value,
    url,
    response,
  };
}
async function callback(
  user: User,
  attempt: Awaited<ReturnType<typeof start>>,
  overrides: { refresh?: string; binding?: string; query?: string } = {},
) {
  return app.inject({
    method: 'GET',
    url: `/google/calendar/callback?${overrides.query ?? `state=${attempt.state}&code=code-sentinel`}`,
    headers: {
      cookie: `${CALENDAR_ATTEMPT_COOKIE}=${overrides.binding ?? attempt.binding}; esl_refresh=${overrides.refresh ?? user.refreshToken}`,
    },
  });
}
async function grants() {
  return withPgClient(
    async (client) => (await client.query('SELECT * FROM google_oauth_grants')).rows,
  );
}
async function connect(user: User) {
  await callback(user, await start(user));
  const response = await app.inject({
    method: 'POST',
    url: `/workspaces/${user.workspaceId}/calendar/select`,
    headers: { authorization: `Bearer ${user.accessToken}` },
    payload: { calendarId: 'synthetic-calendar' },
  });
  expect(response.statusCode).toBe(200);
  return response.json().connection as { id: string; generation: number };
}
const noRate = async () => {};

describe('Calendar OAuth browser/session, authority and refresh fences', () => {
  beforeAll(async () => {
    passwordHash = await auth.hashPassword('test-calendar-password');
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    Object.assign(process.env, {
      GOOGLE_CALENDAR_ENABLED: 'true',
      GOOGLE_CALENDAR_CLIENT_ID: 'test-client',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'test-secret',
      GOOGLE_CALENDAR_REDIRECT_URI: 'http://127.0.0.1/api/google/calendar/callback',
      INTEGRATION_CREDENTIAL_ACTIVE_KEY_ID: 'v1',
      INTEGRATION_CREDENTIAL_KEYS: JSON.stringify({ v1: key }),
      REFRESH_COOKIE_NAME: 'esl_refresh',
      REFRESH_COOKIE_PATH: '/',
      REFRESH_COOKIE_SECURE: 'false',
    });
    await withPgClient(async (client) => {
      await client.query(
        'TRUNCATE google_oauth_attempts,google_oauth_grants,workspace_calendar_connections,users,workspaces CASCADE',
      );
    });
    vi.spyOn(GoogleOAuthClient.prototype, 'exchange').mockResolvedValue({ ...tokens });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          items: [
            {
              id: 'synthetic-calendar',
              summary: 'Synthetic lessons',
              timeZone: 'Asia/Ho_Chi_Minh',
              accessRole: 'owner',
            },
          ],
        }),
      ),
    );
    app = Fastify({ logger: false });
    await app.register(cookie);
    configureAuthMiddleware(auth);
    registerErrorHandler(app);
    registerSecurityHeaders(app);
    const context = {
      config: loadConfig(),
      authService: auth,
      authenticate,
      uploadRateLimitMiddleware: noRate,
    } as unknown as ExtendedRoutesContext;
    registerAuthUserRoutes(app, context);
    registerGoogleCalendarConnectionRoutes(app, context);
    await app.ready();
  });
  afterEach(async () => {
    await app?.close();
  });
  afterAll(async () => {
    await app?.close();
    await closePgPool();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requires the current same-user refresh cookie at connect start without issuing an ESL session', async () => {
    const user = await seed(),
      other = await seed();
    for (const cookieValue of ['', `esl_refresh=${other.refreshToken}`]) {
      const response = await app.inject({
        method: 'POST',
        url: `/workspaces/${user.workspaceId}/calendar/connect`,
        headers: { authorization: `Bearer ${user.accessToken}`, cookie: cookieValue },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('calendar_session_required');
      expect(response.cookies).toHaveLength(0);
    }
    const attempts = await withPgClient(
      async (client) => (await client.query('SELECT id FROM google_oauth_attempts')).rows,
    );
    expect(attempts).toHaveLength(0);
  });

  it('requires cookie-only same user plus browser binding; retains normal refresh and one-time PKCE state', async () => {
    const user = await seed(),
      other = await seed();
    const attempt = await start(user);
    expect(attempt.url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(attempt.url.searchParams.get('access_type')).toBe('offline');
    expect(attempt.url.searchParams.get('nonce')).toBeTruthy();
    const cookie = attempt.response.cookies.find(
      (c: { name: string; value: string }) => c.name === CALENDAR_ATTEMPT_COOKIE,
    )!;
    expect(cookie.path).toBe('/');
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');
    await callback(user, attempt, { refresh: other.refreshToken });
    expect(await grants()).toHaveLength(0);
    const fresh = await start(user);
    const rotated = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: {
        cookie: `esl_refresh=${user.refreshToken}; ${CALENDAR_ATTEMPT_COOKIE}=${fresh.binding}`,
      },
    });
    expect(rotated.statusCode).toBe(200);
    await callback(user, fresh, {
      refresh: rotated.cookies.find(
        (c: { name: string; value: string }) => c.name === 'esl_refresh',
      )!.value,
    });
    expect(await grants()).toHaveLength(1);
    await callback(user, fresh);
    expect(GoogleOAuthClient.prototype.exchange).toHaveBeenCalledTimes(1);
    expect((await grants())[0].refresh_credential).not.toContain('refresh-token-sentinel');
  });

  it.each(['same-user', 'A-B-A'])(
    'rejects restored browser binding after logout and %s explicit login',
    async (mode) => {
      const user = await seed(),
        other = await seed();
      const attempt = await start(user);
      const loggedOut = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie: `${CALENDAR_ATTEMPT_COOKIE}=${attempt.binding}` },
      });
      expect(loggedOut.statusCode).toBe(200);
      expect(
        loggedOut.cookies.find(
          (c: { name: string; value: string }) => c.name === CALENDAR_ATTEMPT_COOKIE,
        )?.path,
      ).toBe('/');
      for (const account of mode === 'A-B-A' ? [other, user] : [user]) {
        const login = await app.inject({
          method: 'POST',
          url: '/auth/login',
          headers: { cookie: `${CALENDAR_ATTEMPT_COOKIE}=${attempt.binding}` },
          payload: { email: account.email, password: 'test-calendar-password' },
        });
        expect(login.statusCode).toBe(200);
      }
      await callback(user, attempt);
      expect(await grants()).toHaveLength(0);
      expect(GoogleOAuthClient.prototype.exchange).not.toHaveBeenCalled();
    },
  );

  it('invalidates superseded/expired attempts and failure callbacks without provider exchange', async () => {
    const user = await seed();
    const first = await start(user);
    await start(user, first.binding);
    await callback(user, first);
    const second = await start(user);
    await withPgClient(async (client) => {
      await client.query(
        "UPDATE google_oauth_attempts SET expires_at=now()-interval '1 second' WHERE status='pending'",
      );
    });
    await callback(user, second);
    const third = await start(user);
    await callback(user, third, {
      query: `state=${third.state}&code=code-sentinel&error=access_denied&error_description=secret-url-sentinel`,
    });
    expect(await grants()).toHaveLength(0);
    expect(GoogleOAuthClient.prototype.exchange).not.toHaveBeenCalled();
  });

  it('logout winning the attempt row fence during code exchange prevents grant persistence', async () => {
    const user = await seed();
    const attempt = await start(user);
    let release!: (value: GoogleGrantTokens) => void;
    let entered!: () => void;
    const exchanging = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(GoogleOAuthClient.prototype.exchange).mockImplementation(async () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = callback(user, attempt);
    await exchanging;
    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `${CALENDAR_ATTEMPT_COOKIE}=${attempt.binding}` },
    });
    release(tokens);
    await pending;
    expect(await grants()).toHaveLength(0);
  });

  it('grant committed before logout remains an established integration', async () => {
    const user = await seed();
    const attempt = await start(user);
    await callback(user, attempt);
    await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { cookie: `${CALENDAR_ATTEMPT_COOKIE}=${attempt.binding}` },
    });
    expect(await grants()).toHaveLength(1);
  });

  it('rejects missing current session and membership loss during exchange', async () => {
    const user = await seed();
    let attempt = await start(user);
    await app.inject({
      method: 'GET',
      url: `/google/calendar/callback?state=${attempt.state}&code=code-sentinel`,
      headers: {
        cookie: `${CALENDAR_ATTEMPT_COOKIE}=${attempt.binding}`,
        authorization: `Bearer ${user.accessToken}`,
      },
    });
    expect(await grants()).toHaveLength(0);
    expect(GoogleOAuthClient.prototype.exchange).not.toHaveBeenCalled();
    attempt = await start(user);
    vi.mocked(GoogleOAuthClient.prototype.exchange).mockImplementation(async () => {
      await withPgClient(async (client) => {
        await client.query("UPDATE workspace_memberships SET role='viewer' WHERE user_id=$1", [
          user.userId,
        ]);
      });
      return tokens;
    });
    await callback(user, attempt);
    expect(await grants()).toHaveLength(0);
  });

  it.each([
    {
      priorState: 'retry_wait',
      priorError: 'google_unavailable',
      expectedState: 'pending',
      expectedError: null,
    },
    {
      priorState: 'needs_review',
      priorError: 'permission_changed',
      expectedState: 'needs_review',
      expectedError: 'permission_changed',
    },
  ])(
    'reconnects the same verified source preserving immutable $priorState intent',
    async ({ priorState, priorError, expectedState, expectedError }) => {
      const user = await seed();
      const before = await connect(user),
        opId = randomUUID();
      const writeAttemptedAt = new Date('2026-10-18T10:00:00.000Z');
      await withPgClient(async (client) => {
        await client.query(
          `INSERT INTO calendar_operations(id,workspace_id,connection_id,connection_generation,initiating_user_id,authority_policy,kind,idempotency_key,request_hash,request_payload,provider_event_id,state,error_code,write_attempted_at) VALUES($1,$2,$3,$4,$5,'initiator','create','original-key','original-hash','{"recipient":"controlled@example.test"}','original-event-id',$6,$7,$8)`,
          [
            opId,
            user.workspaceId,
            before.id,
            before.generation,
            user.userId,
            priorState,
            priorError,
            writeAttemptedAt,
          ],
        );
      });
      await app.inject({
        method: 'POST',
        url: `/workspaces/${user.workspaceId}/calendar/disconnect`,
        headers: { authorization: `Bearer ${user.accessToken}` },
      });
      const after = await connect(user);
      expect(after.id).toBe(before.id);
      expect(after.generation).toBeGreaterThan(before.generation);
      const op = await withPgClient(
        async (client) =>
          (await client.query('SELECT * FROM calendar_operations WHERE id=$1', [opId])).rows[0],
      );
      expect(op).toMatchObject({
        id: opId,
        connection_id: before.id,
        connection_generation: String(after.generation),
        idempotency_key: 'original-key',
        request_hash: 'original-hash',
        provider_event_id: 'original-event-id',
        state: expectedState,
        error_code: expectedError,
        request_payload: { recipient: 'controlled@example.test' },
      });
      expect(op.write_attempted_at).toEqual(writeAttemptedAt);
    },
  );

  it('preserves same-account omitted refresh credentials and refuses another subject without offline access', async () => {
    const user = await seed();
    await callback(user, await start(user));
    const before = (await grants())[0].refresh_credential;
    vi.mocked(GoogleOAuthClient.prototype.exchange).mockResolvedValue({
      ...tokens,
      refreshToken: null,
    });
    await callback(user, await start(user));
    expect((await grants())[0].refresh_credential).toBe(before);
    vi.mocked(GoogleOAuthClient.prototype.exchange).mockResolvedValue({
      ...tokens,
      subject: 'different-subject',
      refreshToken: null,
    });
    await callback(user, await start(user));
    expect(await grants()).toHaveLength(1);
  });

  it.each(['demote', 'deactivate'])(
    'fences grant authority on %s and does not resume on restoration',
    async (action) => {
      const user = await seed();
      const connection = await connect(user);
      await calendarTransaction(async (client) => {
        if (action === 'demote') {
          await client.query("UPDATE workspace_memberships SET role='member' WHERE user_id=$1", [
            user.userId,
          ]);
          await client.query("UPDATE workspace_memberships SET role='owner' WHERE user_id=$1", [
            user.userId,
          ]);
        } else {
          await client.query('UPDATE users SET is_active=false WHERE id=$1', [user.userId]);
          await client.query('UPDATE users SET is_active=true WHERE id=$1', [user.userId]);
        }
      });
      await expect(getCalendarAccess(connection.id, connection.generation)).rejects.toThrow(
        'calendar_connection_changed',
      );
      expect((await grants())[0].status).toBe('reconnect_required');
    },
  );

  it('serializes refresh and rejects a late refreshed credential after disconnect', async () => {
    const user = await seed();
    const connection = await connect(user);
    await withPgClient(async (client) => {
      await client.query(
        "UPDATE google_oauth_grants SET access_expires_at=now()-interval '1 hour'",
      );
    });
    let release!: (v: { accessToken: string; expiresAt: Date; refreshToken: null }) => void;
    let entered!: () => void;
    const refreshing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(GoogleOAuthClient.prototype, 'refresh').mockImplementation(async () => {
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = getCalendarAccess(connection.id, connection.generation);
    const rejection = expect(pending).rejects.toThrow('calendar_connection_changed');
    await refreshing;
    await expect(getCalendarAccess(connection.id, connection.generation)).rejects.toThrow(
      'calendar_refresh_busy',
    );
    await app.inject({
      method: 'POST',
      url: `/workspaces/${user.workspaceId}/calendar/disconnect`,
      headers: { authorization: `Bearer ${user.accessToken}` },
    });
    release({
      accessToken: 'late-token-sentinel',
      expiresAt: new Date(Date.now() + 3600_000),
      refreshToken: null,
    });
    await rejection;
    expect((await grants())[0].status).toBe('disconnected');
  });

  it('denies member management/cross-workspace requests before provider calls', async () => {
    const member = await seed('member'),
      owner = await seed();
    for (const workspace of [member.workspaceId, owner.workspaceId]) {
      const response = await app.inject({
        method: 'POST',
        url: `/workspaces/${workspace}/calendar/connect`,
        headers: {
          authorization: `Bearer ${member.accessToken}`,
          cookie: `esl_refresh=${member.refreshToken}`,
        },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(GoogleOAuthClient.prototype.exchange).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('omits sentinel code/state/headers/provider descriptions from callback logs, redirects and not-found errors', async () => {
    const logMethods = ['info', 'warn', 'error', 'debug'] as const;
    const logs = logMethods.map((method) => vi.spyOn(logger, method).mockImplementation(() => {}));
    const sentinel = 'oauth-SENTINEL-sensitive';
    const user = await seed();
    const attempt = await start(user);
    const urls = [
      `/google/calendar/callback?state=${sentinel}&code=${sentinel}`,
      `/google/calendar/callback/malformed?code=${sentinel}`,
      `/google/calendar/%63allback/missing?state=${sentinel}`,
      `/google/calendar/callback?error=denied&error_description=${sentinel}`,
    ];
    for (const url of urls) {
      const response = await app.inject({
        method: 'GET',
        url,
        headers: {
          cookie: `${CALENDAR_ATTEMPT_COOKIE}=${attempt.binding}; sentinel=${sentinel}`,
          authorization: `Bearer ${sentinel}`,
          'user-agent': sentinel,
        },
      });
      expect(JSON.stringify(response.headers)).not.toContain(sentinel);
      expect(response.body).not.toContain(sentinel);
    }
    vi.mocked(GoogleOAuthClient.prototype.exchange).mockRejectedValueOnce(
      new Error(`provider ${sentinel}`),
    );
    const failed = await callback(user, attempt);
    expect(failed.headers.location).toBe('/calendar/connection-result');
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).not.toContain(sentinel);
    expect(JSON.stringify(logs.map((log) => log.mock.calls))).toContain('google_calendar_callback');
  });
});
