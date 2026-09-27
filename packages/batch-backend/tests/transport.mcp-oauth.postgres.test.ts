import './support/bootstrap-pg-test-env.js';

import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createAuthService } from '../src/infrastructure/auth-service.js';
import { closePgPool, withPgClient } from '../src/infrastructure/db.js';
import { runMigrations } from '../src/infrastructure/migrations.js';
import { authenticate, configureAuthMiddleware } from '../src/transport/auth-middleware.js';
import {
  type McpOAuthConfig,
  registerMcpOAuthRoutes,
  verifyMcpOAuthCredential,
} from '../src/transport/mcp-oauth.js';
import { requirePgTestEnv } from './support/test-env.js';

requirePgTestEnv();

const issuer = 'http://127.0.0.1:3000/api/oauth';
const resource = 'http://127.0.0.1:3000/api/mcp';
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
  private cookies = new Map<string, string>();
  constructor(
    private app: TestApp['app'],
    refreshCookie?: string,
  ) {
    if (refreshCookie) this.cookies.set('esl_refresh', refreshCookie);
  }

  async request(method: 'GET' | 'POST', url: string, payload?: string): Promise<Injection> {
    const response = await this.app.inject({
      method,
      url: internalPath(url),
      headers: {
        host: '127.0.0.1:3000',
        ...(this.cookies.size
          ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
          : {}),
        ...(payload ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(payload ? { payload } : {}),
    });
    for (const header of Array.isArray(response.headers['set-cookie'])
      ? response.headers['set-cookie']
      : response.headers['set-cookie']
        ? [response.headers['set-cookie']]
        : []) {
      const [pair] = header.split(';');
      const position = pair!.indexOf('=');
      this.cookies.set(pair!.slice(0, position), pair!.slice(position + 1));
    }
    return response;
  }
}

const verifier = 'a'.repeat(43);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function authorizeUrl(overrides: Record<string, string> = {}): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'teaching_context.read',
    resource,
    state: 'test-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...overrides,
  });
  return `${issuer}/auth?${params}`;
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

async function authorize(browser: Browser, workspaceId?: string) {
  const initial = await browser.request('GET', authorizeUrl());
  const consent = await follow(browser, initial);
  if (consent.statusCode !== 200) return { consent };
  const csrf = /name="csrf" value="([^"]+)"/.exec(consent.body)?.[1];
  expect(csrf).toBeTruthy();
  const path = /action="([^"]+)"/.exec(consent.body)?.[1];
  expect(path).toBeTruthy();
  const submitted = await browser.request(
    'POST',
    path!,
    new URLSearchParams({
      csrf: csrf!,
      ...(workspaceId ? { workspaceId } : {}),
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

  it('publishes discovery and keeps bearer secrets out of persisted artifact keys', async () => {
    const resourceMetadata = await testApp.app.inject('/.well-known/oauth-protected-resource');
    expect(resourceMetadata.json()).toMatchObject({
      resource,
      authorization_servers: [issuer],
      scopes_supported: ['teaching_context.read'],
    });
    const discovery = await testApp.app.inject('/oauth/.well-known/openid-configuration');
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json()).toMatchObject({
      issuer,
      client_id_metadata_document_supported: true,
      code_challenge_methods_supported: expect.arrayContaining(['S256']),
    });
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
});
