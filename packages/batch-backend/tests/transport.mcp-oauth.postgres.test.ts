import './support/bootstrap-pg-test-env.js';

import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as PgClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuthService } from '../src/infrastructure/auth-service.js';
import { insertStudent } from '../src/domain/student-repository.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { logger } from '../src/infrastructure/logger.js';
import { McpOAuthAdapter } from '../src/infrastructure/mcp-oauth-adapter.js';
import { runMigrations } from '../src/infrastructure/migrations.js';
import { authenticate, configureAuthMiddleware } from '../src/transport/auth-middleware.js';
import {
  getProtectedResourceMetadataUrl,
  type McpOAuthConfig,
  registerMcpOAuthRoutes,
  verifyMcpOAuthCredential,
} from '../src/transport/mcp-oauth.js';
import { registerMcpServer } from '../src/transport/mcp-server.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

const issuer = 'http://127.0.0.1:3000/api/oauth';
const resource = 'http://127.0.0.1:3000/api/mcp';
const canonicalResourceMetadataUrl = getProtectedResourceMetadataUrl(resource);
const clientId = 'test-chatgpt';
const redirectUri = 'http://127.0.0.1:3000/callback';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };
const oauthConfig: McpOAuthConfig = {
  issuer,
  resource,
  refreshCookieName: 'esl_refresh',
  cookieKeys: ['test-cookie-key-with-at-least-32-characters'],
  jwks: { keys: [jwk] },
  allowHttpForTests: true,
  clients: [
    {
      client_id: clientId,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
  ],
};
const authService = createAuthService({
  jwtSecret: 'test-rest-key-with-adequate-length',
  jwtExpiresIn: '15m',
  refreshTokenExpiresIn: '7d',
  bcryptRounds: 4,
});

type TestApp = Awaited<ReturnType<typeof makeApp>>;
type Injection = Awaited<ReturnType<TestApp['app']['inject']>>;
let testApp: TestApp;

async function makeApp(config = oauthConfig) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  configureAuthMiddleware(authService);
  const provider = registerMcpOAuthRoutes(app, config, authService);
  registerMcpServer(app, provider, config);
  app.get('/rest-protected', { preHandler: authenticate }, async () => ({ ok: true }));
  await app.ready();
  return { app, provider };
}

async function reset(): Promise<void> {
  await withPgClient(async (client) => {
    await client.query('TRUNCATE mcp_oauth_artifacts, mcp_oauth_grants, users, workspaces CASCADE');
  });
}

async function seedUser(memberships = 1) {
  const userId = randomUUID();
  const workspaceIds = Array.from({ length: memberships }, () => randomUUID());
  await withPgClient(async (client) => {
    await client.query(
      `INSERT INTO users (id, email, password_hash, role, is_active)
       VALUES ($1, $2, 'unused', 'user', TRUE)`,
      [userId, `${userId}@example.test`],
    );
    for (const [index, workspaceId] of workspaceIds.entries()) {
      await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)', [
        workspaceId,
        `Workspace ${index + 1}`,
      ]);
      await client.query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        [workspaceId, userId],
      );
    }
  });
  const tokens = authService.generateTokens(userId, `${userId}@example.test`, 'user');
  return {
    userId,
    workspaceIds,
    restToken: tokens.accessToken,
    refreshCookie: tokens.refreshToken,
  };
}

function internalPath(url: string): string {
  const parsed = new URL(url, 'http://127.0.0.1:3000');
  return parsed.pathname.replace(/^\/api/, '') + parsed.search;
}

class Browser {
  private cookies = new Map<string, { value: string; path: string; secure: boolean; host: string }>();
  constructor(
    private app: TestApp['app'],
    refreshCookie?: string,
    private origin = 'http://127.0.0.1:3000',
  ) {
    if (refreshCookie) this.cookies.set('esl_refresh', {
      value: refreshCookie, path: '/', secure: this.origin.startsWith('https:'),
      host: new URL(this.origin).hostname,
    });
  }

  cookieHeaderFor(url: string): string {
    const target = new URL(url, this.origin);
    return [...this.cookies].filter(([, cookie]) =>
      cookie.host === target.hostname &&
      (!cookie.secure || target.protocol === 'https:') &&
      (target.pathname === cookie.path || target.pathname.startsWith(`${cookie.path.replace(/\/$/, '')}/`)),
    ).map(([name, cookie]) => `${name}=${cookie.value}`).join('; ');
  }

  async request(method: 'GET' | 'POST', url: string, payload?: string): Promise<Injection> {
    const target = new URL(url, this.origin);
    const cookieHeader = this.cookieHeaderFor(target.href);
    const response = await this.app.inject({
      method,
      url: internalPath(url),
      headers: {
        host: target.host,
        'x-forwarded-proto': target.protocol.slice(0, -1),
        ...(cookieHeader ? { cookie: cookieHeader } : {}),
        ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(payload ? { payload } : {}),
    });
    for (const header of Array.isArray(response.headers['set-cookie'])
      ? response.headers['set-cookie']
      : response.headers['set-cookie']
        ? [response.headers['set-cookie']]
        : []) {
      const [pair, ...attributes] = header.split(';');
      const position = pair!.indexOf('=');
      const name = pair!.slice(0, position);
      const value = pair!.slice(position + 1);
      const path = attributes.find((attribute) => attribute.trim().toLowerCase().startsWith('path='))
        ?.trim().slice('path='.length) ?? (target.pathname.replace(/\/[^/]*$/, '') || '/');
      const secure = attributes.some((attribute) => attribute.trim().toLowerCase() === 'secure');
      if (attributes.some((attribute) => attribute.trim().toLowerCase() === 'max-age=0')) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, { value, path, secure, host: target.hostname });
      }
    }
    return response;
  }
}

const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function authorizeUrl(
  overrides: Record<string, string> = {},
  authIssuer = issuer,
  authResource = resource,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'teaching_context.read',
    resource: authResource,
    state: 'test-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...overrides,
  });
  return `${authIssuer}/auth?${params}`;
}

async function follow(browser: Browser, response: Injection): Promise<Injection> {
  let current = response;
  for (let i = 0; i < 8 && current.statusCode >= 300 && current.statusCode < 400; i++) {
    const next = current.headers.location;
    if (!next || next.startsWith(redirectUri)) return current;
    current = await browser.request('GET', next);
  }
  return current;
}

async function authorize(
  browser: Browser, workspaceId?: string, authIssuer = issuer, authResource = resource,
) {
  const initial = await browser.request('GET', authorizeUrl({}, authIssuer, authResource));
  const consent = await follow(browser, initial);
  if (consent.statusCode !== 200) return { consent };
  const csrf = /name="csrf" value="([^"]+)"/.exec(consent.body)?.[1];
  expect(csrf).toBeTruthy();
  const path = /action="([^"]+)"/.exec(consent.body)?.[1];
  expect(path).toBeTruthy();
  const offeredWorkspaceIds = /name="offeredWorkspaceIds" value="([^"]+)"/.exec(consent.body)?.[1];
  expect(offeredWorkspaceIds).toBeTruthy();
  const soleWorkspaceId = /name="workspaceId" value="([^"]+)"/.exec(consent.body)?.[1];
  const submitted = await browser.request(
    'POST',
    path!,
    new URLSearchParams({
      csrf: csrf!,
      offeredWorkspaceIds: offeredWorkspaceIds!,
      ...(workspaceId || soleWorkspaceId ? { workspaceId: workspaceId ?? soleWorkspaceId! } : {}),
    }).toString(),
  );
  const callback = await follow(browser, submitted);
  return { consent, callback };
}

async function exchange(
  app: TestApp['app'],
  code: string,
  codeVerifier = verifier,
  options: Record<string, string> = {},
) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
    resource,
    ...options,
  });
  if (options.resource === '') form.delete('resource');
  return app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: {
      host: '127.0.0.1:3000',
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: form.toString(),
  });
}

async function issue(browser: Browser) {
  const { callback } = await authorize(browser);
  expect(callback?.statusCode).toBe(303);
  const code = new URL(callback!.headers.location!).searchParams.get('code')!;
  const response = await exchange(testApp.app, code);
  expect(response.statusCode).toBe(200);
  return response.json() as { access_token: string; refresh_token: string; scope: string };
}

async function refresh(refreshToken: string, options: Record<string, string> = {}) {
  return testApp.app.inject({
    method: 'POST',
    url: '/oauth/token',
    headers: { host: '127.0.0.1:3000', 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
      resource,
      ...options,
    }).toString(),
  });
}

describe('MCP OAuth foundation with PostgreSQL', () => {
  beforeAll(async () => {
    await runMigrations();
    testApp = await makeApp();
  });
  beforeEach(reset);
  afterAll(async () => {
    await testApp?.app.close();
    await reset();
    await closePgPool();
  });

  it('logs sanitized, correlated code/refresh outcomes, replay revocation and new authorization', async () => {
    const user = await seedUser();
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    try {
      const browser = new Browser(testApp.app, user.refreshCookie);
      const { callback } = await authorize(browser);
      const code = new URL(callback!.headers.location!).searchParams.get('code')!;
      const issued = (await exchange(testApp.app, code)).json();
      const rotated = await refresh(issued.refresh_token);
      expect(rotated.statusCode).toBe(200);
      expect((await refresh(issued.refresh_token)).statusCode).toBe(400);
      expect((await refresh(rotated.json().refresh_token)).statusCode).toBe(400);
      const next = await authorize(browser);
      const nextCode = new URL(next.callback!.headers.location!).searchParams.get('code')!;
      const wrongPkce = await exchange(testApp.app, nextCode, 'b'.repeat(43));
      expect(wrongPkce.statusCode).toBe(400);
      // Authorization codes are consumed before later validation; use a fresh one.
      const third = await authorize(browser);
      const thirdCode = new URL(third.callback!.headers.location!).searchParams.get('code')!;
      expect((await exchange(testApp.app, thirdCode, verifier, { resource: '' })).statusCode).toBe(
        400,
      );
      const fourth = await authorize(browser);
      const fourthCode = new URL(fourth.callback!.headers.location!).searchParams.get('code')!;
      expect(
        (
          await exchange(testApp.app, fourthCode, verifier, {
            resource: 'https://sensitive.test/private',
          })
        ).statusCode,
      ).toBe(400);

      const fields = [...info.mock.calls, ...warn.mock.calls].map((call) => call[1]);
      const events = fields.filter((field) => field?.event === 'mcp_oauth_diagnostic');
      const tokens = events.filter((field) => field?.operation === 'token');
      expect(tokens).toHaveLength(7);
      expect(tokens).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            grantType: 'authorization_code',
            status: 200,
            resourceState: 'expected',
          }),
          expect.objectContaining({
            grantType: 'refresh_token',
            status: 200,
            refreshConsumed: true,
            refreshSaved: true,
            refreshRotated: true,
          }),
          expect.objectContaining({
            oauthError: 'invalid_grant',
            reason: 'refresh_replayed',
            familyRevoked: true,
          }),
          expect.objectContaining({ oauthError: 'invalid_grant', reason: 'refresh_not_found' }),
          expect.objectContaining({
            oauthError: 'invalid_grant',
            reason: 'pkce_verification_failed',
          }),
          expect.objectContaining({ oauthError: 'invalid_target', resourceState: 'absent' }),
          expect.objectContaining({ oauthError: 'invalid_target', resourceState: 'unexpected' }),
        ]),
      );
      const family = tokens.find((field) => field?.refreshRotated)?.grantRef;
      expect(family).toMatch(/^[a-f0-9]{24}$/);
      expect(tokens.find((field) => field?.reason === 'refresh_replayed')?.grantRef).toBe(family);
      expect(events.filter((field) => field?.operation === 'authorization')).toHaveLength(4);
      for (const event of events) {
        expect(event?.requestId).toMatch(/^[a-f0-9-]{36}$/);
        expect(event?.timestamp).toMatch(/^\d{4}-\d\d-\d\dT/);
        expect(event?.durationMs).toBeGreaterThanOrEqual(0);
        expect(event?.clientClass).toBe('other');
      }
      expect(new Set(events.map((event) => event?.requestId)).size).toBe(events.length);
      const serialized = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
      for (const secret of [
        code,
        nextCode,
        thirdCode,
        fourthCode,
        issued.access_token,
        issued.refresh_token,
        rotated.json().access_token,
        rotated.json().refresh_token,
        user.restToken,
        user.refreshCookie,
        user.userId,
        ...user.workspaceIds,
        'https://sensitive.test/private',
        verifier,
        'b'.repeat(43),
      ]) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it('logs early protocol rejections and server failures without request or exception contents', async () => {
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    const secret = 'private-credential-header-cookie-body-student-data';
    let find: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const post = (payload: string, contentType = 'application/x-www-form-urlencoded') =>
        testApp.app.inject({
          method: 'POST',
          url: '/oauth/token',
          headers: {
            'content-type': contentType,
            cookie: `private=${secret}`,
            'x-private': secret,
          },
          payload,
        });
      expect((await post(`client_id=${clientId}&refresh_token=${secret}`)).statusCode).toBe(400);
      expect(
        (
          await post(
            `grant_type=refresh_token&grant_type=authorization_code&client_id=${clientId}&refresh_token=${secret}`,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await post(
            new URLSearchParams({
              grant_type: 'refresh_token',
              client_id: secret,
              refresh_token: secret,
            }).toString(),
          )
        ).statusCode,
      ).toBe(401);
      expect((await post(secret, 'application/json')).statusCode).toBe(400);
      find = vi
        .spyOn(testApp.provider.RefreshToken, 'find')
        .mockRejectedValueOnce(new Error(secret));
      expect((await refresh(secret)).statusCode).toBe(500);
      const rejected = warn.mock.calls
        .map((call) => call[1])
        .filter((field) => field?.event === 'mcp_oauth_diagnostic');
      expect(rejected).toHaveLength(5);
      expect(rejected).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            status: 400,
            oauthError: 'invalid_request',
            reason: 'grant_type_missing',
          }),
          expect.objectContaining({
            status: 400,
            oauthError: 'invalid_request',
            reason: 'duplicate_grant_type',
          }),
          expect.objectContaining({ status: 401, oauthError: 'invalid_client' }),
          expect.objectContaining({
            status: 400,
            oauthError: 'invalid_request',
            reason: 'unsupported_content_type',
            resourceState: 'unavailable',
          }),
          expect.objectContaining({
            status: 500,
            oauthError: 'server_error',
            reason: 'server_failure',
          }),
        ]),
      );
      expect(
        JSON.stringify([...info.mock.calls, ...warn.mock.calls, ...error.mock.calls]),
      ).not.toContain(secret);
    } finally {
      find?.mockRestore();
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('logs provider-supported endpoint aliases without changing their OAuth responses', async () => {
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    try {
      for (const path of ['/token', '/TOKEN', '/token/', '/TOKEN/',
        '/token/revocation', '/TOKEN/REVOCATION', '/token/revocation/']) {
        const before = warn.mock.calls.length;
        const response = await testApp.app.inject({
          method: 'POST', url: `/oauth${path}`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: '',
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toBe('invalid_request');
        const events = warn.mock.calls.slice(before).map((call) => call[1]);
        expect(events).toEqual([expect.objectContaining({
          event: 'mcp_oauth_diagnostic', status: 400, oauthError: 'invalid_request',
          operation: path.toLowerCase().includes('revocation') ? 'revocation' : 'token',
        })]);
      }
      for (const path of ['/auth', '/AUTH', '/auth/']) {
        const before = warn.mock.calls.length;
        const response = await testApp.app.inject({ method: 'GET', url: `/oauth${path}` });
        expect(response.statusCode).toBe(400);
        expect(warn.mock.calls.slice(before).map((call) => call[1])).toEqual([
          expect.objectContaining({ event: 'mcp_oauth_diagnostic', operation: 'authorization', status: 400 }),
        ]);
      }
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it('preserves server-failure diagnostics when session persistence fails again during cleanup', async () => {
    const user = await seedUser();
    const browser = new Browser(testApp.app, user.refreshCookie);
    await issue(browser);
    const secret = 'session-persistence-private-credential-student-payload';
    const save = vi.spyOn(testApp.provider.Session.adapter, 'upsert').mockRejectedValue(new Error(secret));
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    const error = vi.spyOn(logger, 'error');
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const response = await browser.request('GET', authorizeUrl());
      expect(response.statusCode).toBe(500);
      expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
      const events = warn.mock.calls.map((call) => call[1]).filter((fields) => fields?.event === 'mcp_oauth_diagnostic');
      expect(events).toEqual([expect.objectContaining({
        operation: 'authorization', status: 500, oauthError: 'server_error', reason: 'server_failure',
      })]);
      expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls, ...error.mock.calls])).not.toContain(secret);
      expect(error).toHaveBeenCalledWith('MCP OAuth provider request failed', {
        event: 'mcp_oauth_provider_error', oauthError: 'server_error', reason: 'server_failure',
      });
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
      info.mockRestore();
      warn.mockRestore();
      error.mockRestore();
      stderr.mockRestore();
    }
  });

  it('authorizes an existing user with one workspace and exchanges a single-use PKCE code', async () => {
    const user = await seedUser();
    const browser = new Browser(testApp.app, user.refreshCookie);
    const { consent, callback } = await authorize(browser);
    expect(consent.body).toContain('Workspace 1');
    expect(callback?.statusCode).toBe(303);
    const callbackUrl = new URL(callback!.headers.location!);
    expect(callbackUrl.searchParams.get('iss')).toBe(issuer);
    const code = callbackUrl.searchParams.get('code')!;
    const tokenResponse = await exchange(testApp.app, code);
    expect(tokenResponse.statusCode).toBe(200);
    const issued = tokenResponse.json();
    expect(issued.refresh_token).toBeTypeOf('string');
    expect(
      await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig),
    ).toMatchObject({ userId: user.userId, workspaceId: user.workspaceIds[0] });
    expect((await exchange(testApp.app, code)).statusCode).toBe(400);
    expect(
      await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig),
    ).toBeNull();
    expect(
      (
        await testApp.app.inject({
          method: 'GET',
          url: '/rest-protected',
          headers: { authorization: `Bearer ${issued.access_token}` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      await verifyMcpOAuthCredential(testApp.provider, user.restToken, oauthConfig),
    ).toBeNull();
  });

  it('requires exact redirect, PKCE S256, resource, and read scope', async () => {
    const user = await seedUser();
    const browser = new Browser(testApp.app, user.refreshCookie);
    const invalidRedirect = await browser.request(
      'GET',
      authorizeUrl({ redirect_uri: 'http://127.0.0.1:3000/other' }),
    );
    expect(invalidRedirect.statusCode).toBe(400);
    for (const overrides of [
      { code_challenge_method: 'plain' },
      { resource: 'http://127.0.0.1:3000/api/other' },
      { scope: 'teaching_context.write' },
      { scope: 'openid teaching_context.read' },
    ] as Record<string, string>[]) {
      const response = await browser.request('GET', authorizeUrl(overrides));
      const outcome = await follow(browser, response);
      const rejected =
        outcome.statusCode === 403 ||
        (outcome.statusCode >= 300 &&
          outcome.statusCode < 400 &&
          !!new URL(outcome.headers.location!, redirectUri).searchParams.get('error'));
      expect(rejected).toBe(true);
    }
    const { callback } = await authorize(browser);
    const code = new URL(callback!.headers.location!).searchParams.get('code')!;
    expect((await exchange(testApp.app, code, 'b'.repeat(43))).statusCode).toBe(400);

    const withoutPkce = new URL(authorizeUrl());
    withoutPkce.searchParams.delete('code_challenge');
    const rejected = await browser.request('GET', withoutPkce.toString());
    expect(new URL(rejected.headers.location!, redirectUri).searchParams.get('error')).toBeTruthy();

    const next = await authorize(browser);
    const nextCode = new URL(next.callback!.headers.location!).searchParams.get('code')!;
    expect(
      (
        await exchange(testApp.app, nextCode, verifier, {
          redirect_uri: 'http://127.0.0.1:3000/other',
        })
      ).statusCode,
    ).toBe(400);

    const noResource = await authorize(browser);
    const noResourceCode = new URL(noResource.callback!.headers.location!).searchParams.get(
      'code',
    )!;
    expect(
      (await exchange(testApp.app, noResourceCode, verifier, { resource: '' })).statusCode,
    ).toBe(400);
  });

  it('denies zero memberships and requires an explicit choice for multiple workspaces', async () => {
    const zero = await seedUser(0);
    const denied = await authorize(new Browser(testApp.app, zero.refreshCookie));
    expect(denied.consent.statusCode).toBe(403);
    const many = await seedUser(2);
    const browser = new Browser(testApp.app, many.refreshCookie);
    const { consent, callback } = await authorize(browser);
    expect(consent.body).toContain('Choose a workspace');
    expect(callback?.statusCode).toBe(403);
    const selected = await authorize(browser, many.workspaceIds[1]);
    const code = new URL(selected.callback!.headers.location!).searchParams.get('code')!;
    const issued = (await exchange(testApp.app, code)).json();
    expect(
      await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig),
    ).toMatchObject({ userId: many.userId, workspaceId: many.workspaceIds[1] });
  });

  it('rotates refresh tokens and rejects replay', async () => {
    const user = await seedUser();
    const issued = await issue(new Browser(testApp.app, user.refreshCookie));
    const next = await refresh(issued.refresh_token);
    expect(next.statusCode).toBe(200);
    expect(next.json().refresh_token).not.toBe(issued.refresh_token);
    expect(
      await verifyMcpOAuthCredential(testApp.provider, next.json().access_token, oauthConfig),
    ).toMatchObject({ userId: user.userId });
    expect((await refresh(issued.refresh_token)).statusCode).toBe(400);
    expect((await refresh(next.json().refresh_token)).statusCode).toBe(400);
    expect(await verifyMcpOAuthCredential(testApp.provider, next.json().access_token, oauthConfig))
      .toBeNull();
    const grants = await withPgClient(async (client) => client.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM mcp_oauth_grants',
    ));
    expect(grants.rows[0]?.revoked_at).not.toBeNull();
  });

  it('revokes a bound grant and rejects expired access tokens', async () => {
    const user = await seedUser();
    const issued = await issue(new Browser(testApp.app, user.refreshCookie));
    const grant = await verifyMcpOAuthCredential(
      testApp.provider,
      issued.access_token,
      oauthConfig,
    );
    expect(grant).not.toBeNull();
    await withPgClient(async (client) => {
      await client.query(
        "UPDATE mcp_oauth_artifacts SET expires_at = NOW() - INTERVAL '1 second' WHERE kind = 'AccessToken'",
      );
    });
    expect(
      await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig),
    ).toBeNull();
    const rotated = await refresh(issued.refresh_token);
    expect(rotated.statusCode).toBe(200);
    const revoke = await testApp.app.inject({
      method: 'POST',
      url: `/oauth/grants/${grant!.id}/revoke`,
      headers: { authorization: `Bearer ${user.restToken}` },
    });
    expect(revoke.statusCode).toBe(204);
    expect(
      await verifyMcpOAuthCredential(testApp.provider, rotated.json().access_token, oauthConfig),
    ).toBeNull();
    expect((await refresh(rotated.json().refresh_token)).statusCode).toBe(400);
  });

  it('fails closed after membership removal or user deactivation and deletion', async () => {
    const user = await seedUser();
    const issued = await issue(new Browser(testApp.app, user.refreshCookie));
    await withPgClient(async (client) => {
      await client.query('DELETE FROM workspace_memberships WHERE user_id = $1', [user.userId]);
    });
    expect(
      await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig),
    ).toBeNull();
    await withPgClient(async (client) => {
      await client.query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        [user.workspaceIds[0], user.userId],
      );
      await client.query('UPDATE users SET is_active = FALSE WHERE id = $1', [user.userId]);
    });
    expect(
      await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig),
    ).toBeNull();
    await withPgClient(async (client) => {
      await client.query('DELETE FROM users WHERE id = $1', [user.userId]);
    });
    expect(
      await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig),
    ).toBeNull();
  });

  it('serves two read-only tools through stateless Streamable HTTP with workspace-bound OAuth', async () => {
    const user = await seedUser();
    const otherUser = await seedUser();
    const tokenOne = (await issue(new Browser(testApp.app, user.refreshCookie))).access_token;
    const tokenTwo = (await issue(new Browser(testApp.app, otherUser.refreshCookie))).access_token;
    const students = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        insertStudent({ student: `Anna ${index + 1}`, workspaceId: user.workspaceIds[0] }),
      ),
    );
    const foreign = await insertStudent({
      student: 'Foreign Learner',
      workspaceId: otherUser.workspaceIds[0],
    });

    const url = await testApp.app.listen({ host: '127.0.0.1', port: 0 });
    const connect = async (token?: string, modern = false) => {
      const client = new Client(
        { name: 'mcp-test-client', version: '1.0.0' },
        modern ? { versionNegotiation: { mode: 'auto' } } : {},
      );
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
        requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
      });
      await client.connect(transport);
      return client;
    };
    const client = await connect(tokenOne);
    const rawDiscovery = await testApp.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      payload: { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} },
    });
    expect(rawDiscovery.statusCode).toBe(200);
    const wireDiscovery = JSON.parse(
      rawDiscovery.body.startsWith('{')
        ? rawDiscovery.body
        : /^data: (.+)$/m.exec(rawDiscovery.body)![1]!,
    );
    expect(
      wireDiscovery.result.tools.map((tool: { securitySchemes: unknown }) => tool.securitySchemes),
    ).toEqual(Array(2).fill([{ type: 'oauth2', scopes: ['teaching_context.read'] }]));
    expect(rawDiscovery.body).not.toContain('Anna 1');
    const tools = (await client.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      'find_student',
      'get_student_teaching_context',
    ]);
    expect(Object.keys(tools[0]!.inputSchema.properties ?? {})).toEqual(['name']);
    expect(Object.keys(tools[1]!.inputSchema.properties ?? {})).toEqual(['studentId']);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(tool._meta?.securitySchemes).toEqual([
        { type: 'oauth2', scopes: ['teaching_context.read'] },
      ]);
      expect(tool.outputSchema).toBeTruthy();
    }
    const matches = await client.callTool({ name: 'find_student', arguments: { name: 'Anna' } });
    expect(matches.structuredContent).toMatchObject({
      status: 'ambiguous',
      hasMore: true,
      candidates: expect.arrayContaining([{ studentId: students[0]!.id, name: 'Anna 1' }]),
    });
    expect((matches.structuredContent as { candidates: unknown[] }).candidates).toHaveLength(5);
    const context = await client.callTool({
      name: 'get_student_teaching_context',
      arguments: { studentId: students[0]!.id },
    });
    expect(context.structuredContent).toMatchObject({
      context: {
        contractVersion: 'mcp_teaching_context.v1',
        student: { studentId: students[0]!.id, name: 'Anna 1' },
        profile: null,
        memory: null,
        recentLessons: [],
        recentHomework: [],
      },
    });
    expect(JSON.stringify(context)).not.toMatch(
      /workspaceId|userId|provenance|profileId|snapshotId|revisionId/,
    );
    const foreignResult = await client.callTool({
      name: 'get_student_teaching_context',
      arguments: { studentId: foreign.id },
    });
    const missingResult = await client.callTool({
      name: 'get_student_teaching_context',
      arguments: { studentId: randomUUID() },
    });
    expect(foreignResult).toEqual(missingResult);
    expect(
      (await client.callTool({ name: 'find_student', arguments: { name: 'Foreign' } }))
        .structuredContent,
    ).toMatchObject({ status: 'none', candidates: [], hasMore: false });

    const second = await connect(tokenTwo, true);
    expect(second.getProtocolEra()).toBe('modern');
    expect(
      (await second.callTool({ name: 'find_student', arguments: { name: 'Anna' } }))
        .structuredContent,
    ).toMatchObject({ status: 'none', candidates: [], hasMore: false });
    expect(
      (await second.callTool({ name: 'find_student', arguments: { name: 'Foreign' } }))
        .structuredContent,
    ).toMatchObject({
      status: 'single', candidates: [{ studentId: foreign.id, name: 'Foreign Learner' }], hasMore: false,
    });
    expect(
      (
        await second.callTool({
          name: 'get_student_teaching_context',
          arguments: { studentId: foreign.id },
        })
      ).structuredContent,
    ).toMatchObject({ context: { student: { studentId: foreign.id, name: 'Foreign Learner' } } });
    expect(
      (
        await second.callTool({
          name: 'get_student_teaching_context',
          arguments: { studentId: students[0]!.id },
        })
      ).isError,
    ).toBe(true);

    const anonymous = await connect();
    expect((await anonymous.listTools()).tools).toHaveLength(2);
    const linking = await anonymous.callTool({ name: 'find_student', arguments: { name: 'Anna' } });
    expect(linking.isError).toBe(true);
    expect(linking._meta?.['mcp/www_authenticate']).toEqual([
      expect.stringContaining(`resource_metadata="${canonicalResourceMetadataUrl}"`),
    ]);
    const contextLinking = await anonymous.callTool({
      name: 'get_student_teaching_context', arguments: { studentId: students[0]!.id },
    });
    expect(contextLinking.isError).toBe(true);
    expect(contextLinking._meta?.['mcp/www_authenticate']).toEqual([
      expect.stringContaining(`resource_metadata="${canonicalResourceMetadataUrl}"`),
    ]);
    const rpc = async (
      authorization: string,
      name: 'find_student' | 'get_student_teaching_context',
    ) =>
      testApp.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name,
            arguments: name === 'find_student' ? { name: 'Anna' } : { studentId: students[0]!.id },
          },
        },
      });
    for (const credential of [user.restToken, 'invalid']) {
      for (const name of ['find_student', 'get_student_teaching_context'] as const) {
        const denied = await rpc(`Bearer ${credential}`, name);
        expect(denied.statusCode).toBe(401);
        expect(denied.headers['www-authenticate']).toContain('scope="teaching_context.read"');
        expect(denied.headers['www-authenticate']).toContain(
          `resource_metadata="${canonicalResourceMetadataUrl}"`,
        );
      }
    }
    const getChallenge = await testApp.app.inject('/mcp');
    expect(getChallenge.statusCode).toBe(401);
    expect(getChallenge.headers['www-authenticate']).toContain(
      `resource_metadata="${canonicalResourceMetadataUrl}"`,
    );
    expect((await testApp.app.inject({
      method: 'GET', url: '/mcp', headers: { authorization: `Bearer ${tokenOne}` },
    })).statusCode).toBe(405);
    await withPgClient(async (db) =>
      db.query('DELETE FROM workspace_memberships WHERE user_id = $1 AND workspace_id = $2', [
        user.userId,
        user.workspaceIds[0],
      ]),
    );
    for (const name of ['find_student', 'get_student_teaching_context'] as const)
      expect((await rpc(`Bearer ${tokenOne}`, name)).statusCode).toBe(401);
    await withPgClient(async (db) =>
      db.query('UPDATE mcp_oauth_grants SET revoked_at = NOW() WHERE workspace_id = $1', [
        otherUser.workspaceIds[0],
      ]),
    );
    for (const name of ['find_student', 'get_student_teaching_context'] as const)
      expect((await rpc(`Bearer ${tokenTwo}`, name)).statusCode).toBe(401);
    const expiringUser = await seedUser();
    const expiringToken = (await issue(new Browser(testApp.app, expiringUser.refreshCookie)))
      .access_token;
    await withPgClient(async (db) =>
      db.query(
        "UPDATE mcp_oauth_artifacts SET expires_at = NOW() - INTERVAL '1 second' WHERE kind = 'AccessToken'",
      ),
    );
    for (const name of ['find_student', 'get_student_teaching_context'] as const)
      expect((await rpc(`Bearer ${expiringToken}`, name)).statusCode).toBe(401);
    await Promise.all([client.close(), second.close(), anonymous.close()]);
  });

  it('validates browser Origin before MCP discovery or authenticated execution', async () => {
    const user = await seedUser();
    const token = (await issue(new Browser(testApp.app, user.refreshCookie))).access_token;
    const student = await insertStudent({ student: 'Origin Learner', workspaceId: user.workspaceIds[0] });
    const post = (origin: string | undefined, method: 'tools/list' | 'tools/call') =>
      testApp.app.inject({
        method: 'POST', url: '/mcp',
        headers: {
          ...(origin === undefined ? {} : { origin }),
          authorization: `Bearer ${token}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: {
          jsonrpc: '2.0', id: 1, method,
          params: method === 'tools/list' ? {} : {
            name: 'get_student_teaching_context', arguments: { studentId: student.id },
          },
        },
      });

    for (const allowed of [undefined, new URL(resource).origin]) {
      expect((await post(allowed, 'tools/list')).statusCode).toBe(200);
      expect((await post(allowed, 'tools/call')).statusCode).toBe(200);
    }
    for (const rejected of [
      'https://attacker.example', 'null', 'not-an-origin',
      'http://127.0.0.1:3000/path', 'http://127.0.0.1:3000, https://attacker.example',
    ]) {
      for (const method of ['tools/list', 'tools/call'] as const) {
        const response = await post(rejected, method);
        expect(response.statusCode).toBe(403);
        expect(response.headers['www-authenticate']).toBeUndefined();
      }
      expect((await testApp.app.inject({ method: 'GET', url: '/mcp', headers: {
        origin: rejected, authorization: `Bearer ${token}`,
      } })).statusCode).toBe(403);
    }
    expect((await testApp.app.inject({ method: 'GET', url: '/mcp', headers: {
      origin: new URL(resource).origin, authorization: `Bearer ${token}`,
    } })).statusCode).toBe(405);
    expect((await testApp.app.inject({ method: 'GET', url: '/mcp', headers: {
      origin: 'https://attacker.example', 'x-forwarded-host': 'attacker.example',
      'x-forwarded-proto': 'https', authorization: `Bearer ${token}`,
    } })).statusCode).toBe(403);
  });

  it('logs only safe database failure codes for both tools and credential verification', async () => {
    const user = await seedUser();
    const token = (await issue(new Browser(testApp.app, user.refreshCookie))).access_token;
    const student = await insertStudent({ student: 'Private Learner', workspaceId: user.workspaceIds[0] });
    const originalQuery = PgClient.prototype.query;
    const querySpy = vi.spyOn(PgClient.prototype, 'query');
    const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const failure = Object.assign(new Error('permission denied for table students; Private Learner'), {
      code: '42501',
    });
    failure.stack = 'private SQL and learner data in database exception stack';
    let failingTable = 'students';
    querySpy.mockImplementation(function (this: PgClient, ...args) {
      if (typeof args[0] === 'string' && args[0].includes(`FROM ${failingTable}`)) {
        return Promise.reject(failure);
      }
      return Reflect.apply(originalQuery, this, args);
    });
    const call = (name: string, args: Record<string, string>) => testApp.app.inject({
      method: 'POST', url: '/mcp',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream',
        'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
    });
    try {
      for (const [name, args] of [
        ['find_student', { name: 'Private Learner' }],
        ['get_student_teaching_context', { studentId: student.id }],
      ] as const) {
        const response = await call(name, args);
        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('Teaching context unavailable.');
      }
      failingTable = 'mcp_oauth_artifacts';
      const denied = await call('find_student', { name: 'Private Learner' });
      expect(denied.statusCode).toBe(401);
      expect(denied.headers['www-authenticate']).toContain('resource_metadata=');
      expect(errorSpy).toHaveBeenCalledTimes(3);
      for (const [message, fields] of errorSpy.mock.calls) {
        expect(message).toBe('Sensitive Postgres operation failed');
        expect(fields).toEqual({ component: 'pg', event: 'sensitive_pg_failed', code: '42501' });
      }
      expect(JSON.stringify([errorSpy.mock.calls, warnSpy.mock.calls, denied.body]))
        .not.toMatch(/permission denied|Private Learner|private SQL|SELECT|stack/i);
    } finally {
      querySpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('publishes discovery and keeps bearer secrets out of persisted artifact keys', async () => {
    expect(
      getProtectedResourceMetadataUrl('https://esl-pipeline.run.place/api/mcp'),
    ).toBe(
      'https://esl-pipeline.run.place/.well-known/oauth-protected-resource/api/mcp',
    );
    const canonicalMetadata = await testApp.app.inject(
      new URL(canonicalResourceMetadataUrl).pathname,
    );
    expect(canonicalMetadata.statusCode).toBe(200);
    expect(canonicalMetadata.headers['content-type']).toContain('application/json');
    expect(canonicalMetadata.json()).toEqual({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['teaching_context.read'],
    });
    const compatibilityMetadata = await testApp.app.inject(
      '/.well-known/oauth-protected-resource',
    );
    expect(compatibilityMetadata.statusCode).toBe(200);
    expect(compatibilityMetadata.headers['content-type']).toContain('application/json');
    expect(compatibilityMetadata.json()).toEqual(canonicalMetadata.json());
    const discovery = await new Browser(testApp.app).request('GET', `${issuer}/.well-known/oauth-authorization-server`);
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      issuer,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: expect.arrayContaining(['S256']),
      authorization_endpoint: `${issuer}/auth`,
      token_endpoint: `${issuer}/token`,
      revocation_endpoint: `${issuer}/token/revocation`,
      scopes_supported: ['teaching_context.read'],
    });
    expect(discovery.json()).not.toHaveProperty('dpop_signing_alg_values_supported');
    expect(discovery.json()).not.toHaveProperty('userinfo_endpoint');
    const user = await seedUser();
    const issued = await issue(new Browser(testApp.app, user.refreshCookie));
    await withPgClient(async (client) => {
      const rows = await client.query<{ id_hash: string; payload: unknown }>(
        "SELECT id_hash, payload FROM mcp_oauth_artifacts WHERE kind IN ('AccessToken', 'RefreshToken')",
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      for (const row of rows.rows) {
        expect(row.id_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(row.payload)).not.toContain(issued.access_token);
        expect(JSON.stringify(row.payload)).not.toContain(issued.refresh_token);
      }
    });
  });

  it('accepts ChatGPT CIMD metadata without registering another user identity', async () => {
    const metadata = {
      client_id: 'https://chatgpt.com/oauth/client.json',
      redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      client_name: 'ChatGPT',
    };
    const fetched: string[] = [];
    const cimdApp = await makeApp({
      ...oauthConfig,
      clients: undefined,
      fetch: async (input) => {
        fetched.push(String(input));
        return new Response(JSON.stringify(metadata), {
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    try {
      const user = await seedUser();
      const browser = new Browser(cimdApp.app, user.refreshCookie);
      const response = await browser.request(
        'GET',
        authorizeUrl({
          client_id: metadata.client_id,
          redirect_uri: metadata.redirect_uris[0]!,
        }),
      );
      expect(response.statusCode).toBe(303);
      expect(response.headers.location).toMatch(/^\/api\/oauth\/interaction\//);
      expect(fetched).toContain(metadata.client_id);
    } finally {
      await cimdApp.app.close();
    }
  });

  it('accepts the exact Codex desktop CIMD client only with its constrained loopback callback', async () => {
    const desktopClientId = 'https://chatgpt.com/oauth/codex/client.json';
    const webClientId = 'https://chatgpt.com/oauth/client.json';
    const callbackClientId = 'https://chatgpt.com/oauth/callback-42/client.json';
    const arbitraryClientId = 'https://chatgpt.com/oauth/codex-copy/client.json';
    const desktopMetadata = {
      client_id: desktopClientId,
      client_name: 'Codex',
      application_type: 'native',
      redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      token_endpoint_auth_methods_supported: ['none'],
    };
    const clientMetadata = new Map<string, Record<string, unknown>>([
      [desktopClientId, desktopMetadata],
      [webClientId, {
        client_id: webClientId,
        client_name: 'ChatGPT',
        redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }],
      [callbackClientId, {
        client_id: callbackClientId,
        client_name: 'ChatGPT connector',
        redirect_uris: ['https://chatgpt.com/connector/oauth/callback-42'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }],
      [arbitraryClientId, {
        ...desktopMetadata,
        client_id: arbitraryClientId,
        redirect_uris: ['http://127.0.0.1/callback'],
      }],
    ]);
    const fetched: string[] = [];
    const cimdApp = await makeApp({
      ...oauthConfig,
      clients: undefined,
      fetch: async (input) => {
        const clientId = String(input);
        fetched.push(clientId);
        const metadata = clientMetadata.get(clientId);
        return metadata
          ? new Response(JSON.stringify(metadata), {
            headers: { 'content-type': 'application/json' },
          })
          : new Response('Not found', { status: 404 });
      },
    });
    try {
      const user = await seedUser();
      const requestAuthorization = (clientId: string, redirectUri: string) =>
        new Browser(cimdApp.app, user.refreshCookie).request(
          'GET',
          authorizeUrl({ client_id: clientId, redirect_uri: redirectUri }),
        );

      for (const redirectUri of [
        'http://127.0.0.1:57549/callback',
        'http://127.0.0.1:49152/callback',
      ]) {
        const response = await requestAuthorization(desktopClientId, redirectUri);
        expect(response.statusCode).toBe(303);
        expect(response.headers.location).toMatch(/^\/api\/oauth\/interaction\//);
      }

      for (const redirectUri of [
        'http://127.0.0.2:57549/callback',
        'http://localhost:57549/callback',
        'http://[::1]:57549/callback',
        'https://127.0.0.1:57549/callback',
        'http://127.0.0.1/callback',
        'http://127.0.0.1:not-a-port/callback',
        'http://127.0.0.1:0/callback',
        'http://127.0.0.1:65536/callback',
        'http://127.0.0.1:57549/other',
        'http://127.0.0.1:57549/callback?next=https://attacker.example',
        'http://127.0.0.1:57549/callback#fragment',
        'http://user:password@127.0.0.1:57549/callback',
        'https://chatgpt.com/connector_platform_oauth_redirect',
      ]) {
        const response = await requestAuthorization(desktopClientId, redirectUri);
        expect(response.statusCode).toBe(400);
      }

      for (const [clientId, redirectUri] of [
        [webClientId, 'http://127.0.0.1:57549/callback'],
        [callbackClientId, 'http://127.0.0.1:57549/callback'],
        [arbitraryClientId, 'http://127.0.0.1:57549/callback'],
        [desktopClientId, 'https://chatgpt.com/connector/oauth/callback-42'],
      ]) {
        const response = await requestAuthorization(clientId!, redirectUri!);
        expect(response.statusCode).toBe(400);
      }

      const callbackResponse = await requestAuthorization(
        callbackClientId,
        'https://chatgpt.com/connector/oauth/callback-42',
      );
      expect(callbackResponse.statusCode).toBe(303);
      expect(fetched).toContain(desktopClientId);
      expect(fetched).toContain(webClientId);
      expect(fetched).toContain(callbackClientId);
      expect(fetched).toContain(arbitraryClientId);
    } finally {
      await cimdApp.app.close();
    }
  });

  it('uses the externally mounted interaction path for browser cookies and discovery-driven scope', async () => {
    const user = await seedUser();
    const browser = new Browser(testApp.app, user.refreshCookie);
    const discovery = (await browser.request('GET', `${issuer}/.well-known/openid-configuration`)).json();
    const metadata = (await browser.request('GET', '/api/.well-known/oauth-protected-resource')).json();
    expect(discovery.scopes_supported).toEqual(metadata.scopes_supported);
    const initial = await browser.request('GET', authorizeUrl({ scope: discovery.scopes_supported.join(' ') }));
    const interactionPath = initial.headers.location!;
    expect(interactionPath).toMatch(/^\/api\/oauth\/interaction\//);
    expect(browser.cookieHeaderFor(interactionPath)).toContain('mcp_oauth_interaction=');
    expect(browser.cookieHeaderFor('/api/other')).not.toContain('mcp_oauth_interaction=');
    const consent = await follow(browser, initial);
    expect(consent.statusCode).toBe(200);
    const path = /action="([^"]+)"/.exec(consent.body)![1]!;
    const csrf = /name="csrf" value="([^"]+)"/.exec(consent.body)![1]!;
    const offeredWorkspaceIds = /name="offeredWorkspaceIds" value="([^"]+)"/.exec(consent.body)![1]!;
    const workspaceId = /name="workspaceId" value="([^"]+)"/.exec(consent.body)![1]!;
    const submitted = await browser.request('POST', path, new URLSearchParams({
      csrf, offeredWorkspaceIds, workspaceId,
    }).toString());
    expect(submitted.statusCode).toBe(303);
    expect(submitted.headers.location).toMatch(/^\/api\/oauth\/auth\//);
    expect(browser.cookieHeaderFor(submitted.headers.location!)).toContain('mcp_oauth_resume=');
    expect(browser.cookieHeaderFor('/api/other')).not.toContain('mcp_oauth_resume=');
    expect((await follow(browser, submitted)).statusCode).toBe(303);
  });

  it('keeps the displayed sole workspace fixed when membership changes before confirmation', async () => {
    const user = await seedUser();
    const browser = new Browser(testApp.app, user.refreshCookie);
    const consent = await follow(browser, await browser.request('GET', authorizeUrl()));
    expect(consent.body).toContain('Workspace 1');
    const oldWorkspaceId = user.workspaceIds[0]!;
    const newWorkspaceId = randomUUID();
    await withPgClient(async (client) => {
      await client.query('INSERT INTO workspaces (id, name) VALUES ($1, $2)',
        [newWorkspaceId, 'Replacement workspace']);
      await client.query('DELETE FROM workspace_memberships WHERE user_id = $1', [user.userId]);
      await client.query("INSERT INTO workspace_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
        [newWorkspaceId, user.userId]);
    });
    const path = /action="([^"]+)"/.exec(consent.body)![1]!;
    const csrf = /name="csrf" value="([^"]+)"/.exec(consent.body)![1]!;
    const offered = /name="offeredWorkspaceIds" value="([^"]+)"/.exec(consent.body)![1]!;
    expect(offered).toBe(oldWorkspaceId);
    const response = await browser.request('POST', path, new URLSearchParams({
      csrf, offeredWorkspaceIds: offered, workspaceId: oldWorkspaceId,
    }).toString());
    expect(response.statusCode).toBe(403);
    const grants = await withPgClient(async (client) => client.query('SELECT id FROM mcp_oauth_grants'));
    expect(grants.rowCount).toBe(0);
  });

  it('handles concurrent code and refresh consumption as OAuth errors and revokes the family', async () => {
    const user = await seedUser();
    const browser = new Browser(testApp.app, user.refreshCookie);
    const { callback } = await authorize(browser);
    const code = new URL(callback!.headers.location!).searchParams.get('code')!;
    const codeResults = await Promise.all([exchange(testApp.app, code), exchange(testApp.app, code)]);
    expect(codeResults.every((result) => [200, 400].includes(result.statusCode))).toBe(true);
    expect(codeResults.some((result) => result.statusCode === 400)).toBe(true);
    for (const result of codeResults.filter((item) => item.statusCode === 200)) {
      expect(await verifyMcpOAuthCredential(testApp.provider, result.json().access_token, oauthConfig))
        .toBeNull();
    }
    const codeGrant = await withPgClient(async (client) => client.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM mcp_oauth_grants',
    ));
    expect(codeGrant.rows).toHaveLength(1);
    expect(codeGrant.rows[0]?.revoked_at).not.toBeNull();

    const fresh = await issue(new Browser(testApp.app, user.refreshCookie));
    const refreshResults = await Promise.all([refresh(fresh.refresh_token), refresh(fresh.refresh_token)]);
    expect(refreshResults.every((result) => [200, 400].includes(result.statusCode))).toBe(true);
    expect(refreshResults.some((result) => result.statusCode === 400)).toBe(true);
    for (const result of refreshResults.filter((result) => result.statusCode === 200)) {
      expect(await verifyMcpOAuthCredential(testApp.provider, result.json().access_token, oauthConfig))
        .toBeNull();
    }
    expect(await verifyMcpOAuthCredential(testApp.provider, fresh.access_token, oauthConfig))
      .toBeNull();
  });

  it('revokes the Pipeline grant when the provider revocation endpoint revokes a token', async () => {
    const user = await seedUser();
    const issued = await issue(new Browser(testApp.app, user.refreshCookie));
    const bound = await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig);
    expect(bound).not.toBeNull();
    const info = vi.spyOn(logger, 'info');
    const response = await testApp.app.inject({
      method: 'POST',
      url: '/oauth/token/revocation',
      headers: { host: '127.0.0.1:3000', 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ client_id: clientId, token: issued.refresh_token }).toString(),
    });
    const diagnostic = info.mock.calls.map((call) => call[1]).find((fields) => fields?.event === 'mcp_oauth_diagnostic');
    info.mockRestore();
    expect(diagnostic).toMatchObject({ operation: 'revocation', status: 200, familyRevoked: true });
    expect(response.statusCode).toBe(200);
    const rows = await withPgClient(async (client) => client.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM mcp_oauth_grants WHERE id = $1', [bound!.id],
    ));
    expect(rows.rows[0]?.revoked_at).not.toBeNull();
    expect(await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig))
      .toBeNull();
    expect((await refresh(issued.refresh_token)).statusCode).toBe(400);
  });

  it('invalidates the family when two consumers race on the same PostgreSQL artifact', async () => {
    const user = await seedUser();
    const issued = await issue(new Browser(testApp.app, user.refreshCookie));
    const adapter = new McpOAuthAdapter('RefreshToken');
    const outcomes = await Promise.allSettled([
      adapter.consume(issued.refresh_token), adapter.consume(issued.refresh_token),
    ]);
    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejected).toMatchObject({ reason: { error: 'invalid_grant' } });
    const rows = await withPgClient(async (client) => client.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM mcp_oauth_grants',
    ));
    expect(rows.rows[0]?.revoked_at).not.toBeNull();
    expect(await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig))
      .toBeNull();
  });

  it('serializes provider revocation and overlapping token writes on the durable grant row', async () => {
    const user = await seedUser();
    const issued = await issue(new Browser(testApp.app, user.refreshCookie));
    const grant = await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig);
    expect(grant).not.toBeNull();
    const accessAdapter = new McpOAuthAdapter('AccessToken');
    const payload = await accessAdapter.find(issued.access_token);
    expect(payload).toBeTruthy();

    let signalLocked!: () => void;
    let releaseLock!: () => void;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseLock = resolve; });
    const blocker = withPgClient(async (client) => {
      await client.query('BEGIN');
      try {
        await client.query('SELECT id FROM mcp_oauth_grants WHERE id = $1 FOR UPDATE', [grant!.id]);
        signalLocked();
        await release;
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    await locked;
    const overlappingWrite = accessAdapter.upsert('overlap-token', { ...payload!, jti: 'overlap-token' }, 900);
    const providerRevocation = accessAdapter.revokeByGrantId(grant!.id);
    releaseLock();
    await blocker;
    const outcomes = await Promise.allSettled([overlappingWrite, providerRevocation]);
    expect(outcomes[1]?.status).toBe('fulfilled');
    expect(await verifyMcpOAuthCredential(testApp.provider, issued.access_token, oauthConfig)).toBeNull();
    expect(await verifyMcpOAuthCredential(testApp.provider, 'overlap-token', oauthConfig)).toBeNull();
    const rows = await withPgClient(async (client) => client.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM mcp_oauth_grants WHERE id = $1', [grant!.id],
    ));
    expect(rows.rows[0]?.revoked_at).not.toBeNull();
  });

  it('rejects sender-constrained artifacts and supports HTTPS behind Caddy and nginx', async () => {
    const caddy = readFileSync(new URL('../../../deploy/caddy/Caddyfile', import.meta.url), 'utf8');
    const nginx = readFileSync(new URL('../../batch-frontend/nginx.conf', import.meta.url), 'utf8');
    expect(caddy).toContain('header_up X-Forwarded-Proto {scheme}');
    const canonicalMetadataRoute =
      /location = \/\.well-known\/oauth-protected-resource\/api\/mcp \{([\s\S]*?)\n {2}\}/u.exec(
        nginx,
      )?.[1];
    expect(canonicalMetadataRoute).toBeDefined();
    expect(canonicalMetadataRoute).toContain(
      'proxy_pass http://batch-backend:8080$request_uri;',
    );
    expect(canonicalMetadataRoute).toContain(
      'proxy_set_header X-Forwarded-Proto $pipeline_external_proto;',
    );
    expect(canonicalMetadataRoute).toContain('proxy_set_header Host $host;');
    expect(canonicalMetadataRoute).toContain('proxy_set_header X-Forwarded-Host $host;');
    expect(canonicalMetadataRoute).not.toContain('try_files');
    expect(nginx).toContain('location /api/ {');
    expect(nginx).toContain('proxy_pass http://batch-backend:8080$backend_request_uri;');
    expect(nginx).toContain('proxy_set_header X-Forwarded-Proto $pipeline_external_proto;');
    expect(nginx).toContain('https https;');
    expect(nginx).toContain('proxy_set_header X-Forwarded-Host $host;');
    expect(nginx).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    const httpsIssuer = 'https://pipeline.example.test/api/oauth';
    const httpsResource = 'https://pipeline.example.test/api/mcp';
    const config: McpOAuthConfig = { ...oauthConfig, issuer: httpsIssuer, resource: httpsResource,
      allowHttpForTests: false };
    const httpsApp = await makeApp(config);
    try {
      const user = await seedUser();
      const browser = new Browser(httpsApp.app, user.refreshCookie, 'https://pipeline.example.test');
      const discovery = await browser.request('GET', `${httpsIssuer}/.well-known/openid-configuration`);
      expect(discovery.statusCode).toBe(200);
      expect(discovery.json()).toMatchObject({
        issuer: httpsIssuer,
        authorization_endpoint: `${httpsIssuer}/auth`,
        token_endpoint: `${httpsIssuer}/token`,
      });
      expect(discovery.json()).not.toHaveProperty('dpop_signing_alg_values_supported');
      const initial = await browser.request('GET', authorizeUrl({}, httpsIssuer, httpsResource));
      expect(initial.statusCode).toBe(303);
      expect(initial.headers.location).toMatch(/^\/api\/oauth\/interaction\//);
      const setCookie = initial.headers['set-cookie'];
      expect(JSON.stringify(setCookie)).toMatch(/; secure(?:;|\")/i);
      expect(browser.cookieHeaderFor(initial.headers.location!)).toContain('mcp_oauth_interaction=');
      expect(browser.cookieHeaderFor('http://pipeline.example.test/api/oauth/interaction/x'))
        .not.toContain('mcp_oauth_interaction=');
      const consent = await follow(browser, initial);
      expect(consent.statusCode).toBe(200);
    } finally {
      await httpsApp.app.close();
    }

    const restUser = await seedUser();
    const issued = await issue(new Browser(testApp.app, restUser.refreshCookie));
    const adapter = new McpOAuthAdapter('AccessToken');
    const payload = await adapter.find(issued.access_token);
    expect(payload).toBeTruthy();
    await adapter.upsert('dpop-bound-token', { ...payload!, jti: 'dpop-bound-token', jkt: 'key-thumbprint' }, 900);
    expect(await verifyMcpOAuthCredential(testApp.provider, 'dpop-bound-token', oauthConfig))
      .toBeNull();
    await adapter.upsert('mtls-bound-token', {
      ...payload!, jti: 'mtls-bound-token', 'x5t#S256': 'certificate-thumbprint',
    }, 900);
    expect(await verifyMcpOAuthCredential(testApp.provider, 'mtls-bound-token', oauthConfig))
      .toBeNull();
  });
});
