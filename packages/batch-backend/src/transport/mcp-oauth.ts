import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import Provider, { type Configuration, errors, interactionPolicy } from 'oidc-provider';

import {
  type BoundOAuthGrant,
  bindOAuthGrant,
  findValidOAuthGrant,
  listOAuthWorkspaces,
  MCP_READ_SCOPE,
  revokeOAuthGrant,
} from '../domain/mcp-oauth-grants.js';
import { getUserById } from '../domain/user-repository.js';
import type { AuthService } from '../infrastructure/auth-service.js';
import { logger } from '../infrastructure/logger.js';
import { McpOAuthAdapter } from '../infrastructure/mcp-oauth-adapter.js';
import { authenticate, getAuthenticatedUser } from './auth-middleware.js';

const GRANT_TTL_SECONDS = 14 * 24 * 60 * 60;
const CHATGPT_CLIENT = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_CODEX_CLIENT = 'https://chatgpt.com/oauth/codex/client.json';
const CALLBACK_CLIENT = /^https:\/\/chatgpt\.com\/oauth\/([A-Za-z0-9_-]+)\/client\.json$/;
// Pin Codex metadata to its current published redirect set. The request
// validator below deliberately accepts only its observed IPv4 callback.
const CHATGPT_CODEX_METADATA_REDIRECTS = new Set([
  'http://127.0.0.1/callback',
  'http://localhost/callback',
]);

export interface McpOAuthConfig {
  issuer: string;
  resource: string;
  refreshCookieName: string;
  cookieKeys: string[];
  jwks: { keys: Array<Record<string, unknown>> };
  allowHttpForTests?: boolean;
  clients?: Configuration['clients'];
  fetch?: Configuration['fetch'];
}

export function loadMcpOAuthConfig(refreshCookieName: string): McpOAuthConfig | null {
  if (process.env.MCP_OAUTH_ENABLED !== 'true') return null;
  const issuer = process.env.MCP_OAUTH_ISSUER;
  const resource = process.env.MCP_OAUTH_RESOURCE;
  const cookieKeysText = process.env.MCP_OAUTH_COOKIE_KEYS;
  const jwksText = process.env.MCP_OAUTH_JWKS;
  if (!issuer || !resource || !cookieKeysText || !jwksText) {
    throw new Error(
      'MCP OAuth is enabled but its issuer, resource, cookie keys, or JWKS is missing',
    );
  }
  let cookieKeys: string[];
  let jwks: McpOAuthConfig['jwks'];
  try {
    cookieKeys = JSON.parse(cookieKeysText);
    jwks = JSON.parse(jwksText);
  } catch {
    throw new Error('MCP OAuth key configuration is invalid JSON');
  }
  return validateMcpOAuthConfig({ issuer, resource, refreshCookieName, cookieKeys, jwks });
}

export function validateMcpOAuthConfig(config: McpOAuthConfig): McpOAuthConfig {
  const issuer = new URL(config.issuer);
  const resource = new URL(config.resource);
  const scheme = config.allowHttpForTests ? 'http:' : 'https:';
  if (
    (issuer.protocol !== 'https:' && issuer.protocol !== scheme) ||
    issuer.origin !== resource.origin ||
    resource.protocol !== issuer.protocol ||
    issuer.pathname !== '/api/oauth' ||
    resource.pathname !== '/api/mcp' ||
    issuer.search ||
    issuer.hash ||
    resource.search ||
    resource.hash ||
    config.issuer !== issuer.href.replace(/\/$/, '') ||
    config.resource !== resource.href.replace(/\/$/, '')
  ) {
    throw new Error(
      'MCP OAuth issuer and resource must be canonical same-origin /api/oauth and /api/mcp URLs',
    );
  }
  if (
    !Array.isArray(config.cookieKeys) ||
    config.cookieKeys.length === 0 ||
    config.cookieKeys.some((key) => typeof key !== 'string' || key.length < 32)
  ) {
    throw new Error('MCP OAuth cookie signing keys must each contain at least 32 characters');
  }
  if (
    !Array.isArray(config.jwks?.keys) ||
    config.jwks.keys.length === 0 ||
    config.jwks.keys.some((key) => !key || typeof key !== 'object' || !('d' in key))
  ) {
    throw new Error('MCP OAuth requires a private signing JWKS');
  }
  return config;
}

function expectedRedirect(clientId: string): string | null {
  if (clientId === CHATGPT_CODEX_CLIENT) return null;
  if (clientId === CHATGPT_CLIENT) return 'https://chatgpt.com/connector_platform_oauth_redirect';
  const match = CALLBACK_CLIENT.exec(clientId);
  return match ? `https://chatgpt.com/connector/oauth/${match[1]}` : null;
}

function isAllowedCodexRedirect(redirectUri: string | null): boolean {
  if (!redirectUri) return false;

  let redirect: URL;
  try {
    redirect = new URL(redirectUri);
  } catch {
    return false;
  }

  if (
    redirect.protocol !== 'http:' ||
    redirect.hostname !== '127.0.0.1' ||
    redirect.username ||
    redirect.password ||
    redirect.pathname !== '/callback' ||
    redirect.search ||
    redirect.hash
  ) {
    return false;
  }

  // URL normalizes the default HTTP port away, so read the explicit port from
  // the parsed URL's authority and then require its canonical serialization.
  const authorityStart = redirectUri.indexOf('://') + 3;
  const authorityEndOffset = redirectUri.slice(authorityStart).search(/[/?#]/u);
  const authorityEnd =
    authorityEndOffset === -1 ? redirectUri.length : authorityStart + authorityEndOffset;
  const authority = redirectUri.slice(authorityStart, authorityEnd);
  if (authority.includes('@')) return false;
  const portSeparator = authority.lastIndexOf(':');
  if (portSeparator === -1 || authority.slice(0, portSeparator) !== redirect.hostname) {
    return false;
  }
  const portText = authority.slice(portSeparator + 1);
  if (!/^\d+$/u.test(portText)) return false;
  const port = Number(portText);
  return (
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65_535 &&
    redirectUri === `http://${redirect.hostname}:${port}/callback`
  );
}

function isAllowedClient(
  clientId: string,
  redirectUris?: readonly string[],
  applicationType?: string,
): boolean {
  if (clientId === CHATGPT_CODEX_CLIENT) {
    return (
      applicationType === 'native' &&
      !!redirectUris &&
      redirectUris.length === CHATGPT_CODEX_METADATA_REDIRECTS.size &&
      new Set(redirectUris).size === CHATGPT_CODEX_METADATA_REDIRECTS.size &&
      redirectUris.every((redirect) => CHATGPT_CODEX_METADATA_REDIRECTS.has(redirect))
    );
  }
  const redirect = expectedRedirect(clientId);
  return !!redirect && !!redirectUris && redirectUris.length === 1 && redirectUris[0] === redirect;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );
}

function consentCsrf(
  key: string, uid: string, refreshToken: string, userId: string, offeredWorkspaceIds: string,
): string {
  return createHmac('sha256', key)
    .update(`${uid}\0${refreshToken}\0${userId}\0${offeredWorkspaceIds}`)
    .digest('hex');
}

function csrfMatches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicResumePath(returnTo: string, issuer: string): string {
  const parsed = new URL(returnTo, issuer);
  if (
    parsed.origin !== new URL(issuer).origin ||
    !/^\/api\/oauth\/auth\/[A-Za-z0-9_-]+$/.test(parsed.pathname)
  ) {
    throw new Error('Unexpected OAuth interaction resume path');
  }
  return `${parsed.pathname}${parsed.search}`;
}

async function pipelineUserFromCookie(
  refreshToken: string | undefined,
  authService: AuthService,
): Promise<string | null> {
  if (!refreshToken) return null;
  try {
    const payload = authService.verifyRefreshToken(refreshToken);
    const user = await getUserById(payload.sub);
    return user?.isActive ? user.id : null;
  } catch {
    return null;
  }
}

export function createMcpOAuthProvider(config: McpOAuthConfig, authService: AuthService): Provider {
  validateMcpOAuthConfig(config);
  const policy = interactionPolicy.base();
  policy.get('login')?.checks.add(
    new interactionPolicy.Check(
      'pipelineLogin',
      'A current Pipeline login is required',
      async (ctx) => {
        if (ctx.oidc.result?.login) return false;
        const userId = await pipelineUserFromCookie(
          ctx.cookies.get(config.refreshCookieName),
          authService,
        );
        return !userId || ctx.oidc.session?.accountId !== userId;
      },
    ),
  );
  policy
    .get('consent')
    ?.checks.add(
      new interactionPolicy.Check(
        'pipelineWorkspaceConsent',
        'A workspace-specific grant requires explicit consent',
        (ctx) => !ctx.oidc.result?.consent,
      ),
    );

  const provider = new Provider(config.issuer, {
    adapter: (name) => new McpOAuthAdapter(name),
    clients: config.clients,
    fetch: config.fetch,
    clientAuthMethods: ['none', 'private_key_jwt'],
    scopes: [MCP_READ_SCOPE],
    cookies: {
      keys: config.cookieKeys,
      names: {
        session: 'mcp_oauth_session',
        interaction: 'mcp_oauth_interaction',
        resume: 'mcp_oauth_resume',
      },
      long: {
        secure: !config.allowHttpForTests,
        sameSite: 'lax',
        httpOnly: true,
        path: '/api/oauth',
      },
      short: {
        secure: !config.allowHttpForTests,
        sameSite: 'lax',
        httpOnly: true,
        path: '/api/oauth',
      },
    },
    findAccount: async (_ctx, userId) => {
      const user = await getUserById(userId);
      return user?.isActive
        ? { accountId: user.id, claims: async () => ({ sub: user.id }) }
        : undefined;
    },
    features: {
      devInteractions: { enabled: false },
      dPoP: { enabled: false },
      userinfo: { enabled: false },
      clientIdMetadataDocument: {
        enabled: true,
        ack: 'draft-02',
        allowFetch: (_ctx, clientId) =>
          clientId === CHATGPT_CODEX_CLIENT || !!expectedRedirect(clientId),
        allowClient: (_ctx, client) =>
          isAllowedClient(client.clientId, client.redirectUris, client.applicationType),
      },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => undefined,
        useGrantedResource: () => false,
        getResourceServerInfo: (ctx, resource) => {
          // oidc-provider can infer a previously granted resource at the token
          // endpoint. ChatGPT sends resource on both legs; require it there.
          if (resource !== config.resource || ctx.oidc.params?.resource !== config.resource) {
            throw new errors.InvalidTarget();
          }
          return {
            scope: MCP_READ_SCOPE,
            audience: config.resource,
            accessTokenFormat: 'opaque',
            accessTokenTTL: 900,
          };
        },
      },
      revocation: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) => token.clientId === client.clientId,
      },
    },
    pkce: { required: () => true },
    responseTypes: ['code'],
    issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
    rotateRefreshToken: true,
    interactions: {
      policy,
      url: (_ctx, interaction) => `/api/oauth/interaction/${interaction.uid}`,
    },
    jwks: config.jwks as Configuration['jwks'],
    ttl: {
      AccessToken: 900,
      AuthorizationCode: 60,
      RefreshToken: GRANT_TTL_SECONDS,
      Grant: GRANT_TTL_SECONDS,
      Interaction: 600,
      Session: 3600,
    },
    async extraTokenClaims(_ctx, token) {
      if (token.kind !== 'AccessToken') return undefined;
      const grant = await findValidOAuthGrant(token.grantId);
      if (
        !grant ||
        grant.userId !== token.accountId ||
        grant.clientId !== token.clientId ||
        grant.resource !== config.resource ||
        grant.scope !== MCP_READ_SCOPE
      ) {
        throw new errors.AccessDenied('Pipeline grant is no longer valid');
      }
      return undefined;
    },
  });
  // oidc-provider always includes its built-in `openid` claim scope in
  // discovery. This OAuth-only integration does not offer an OIDC identity
  // scope; consent accepts only the resource's read scope.
  provider.use(async (ctx, next) => {
    await next();
    if (ctx.oidc?.route === 'discovery' && ctx.body && typeof ctx.body === 'object') {
      (ctx.body as Record<string, unknown>).scopes_supported = [MCP_READ_SCOPE];
    }
  });
  // Only this provider trusts the nginx-forwarded scheme. Fastify REST routes
  // retain their existing proxy policy; nginx overwrites forwarded host/IP.
  provider.proxy = true;
  return provider;
}

export async function verifyMcpOAuthCredential(
  provider: Provider,
  credential: string,
  config: McpOAuthConfig,
): Promise<BoundOAuthGrant | null> {
  if (!credential || credential.includes(' ')) return null;
  try {
    const token = await provider.AccessToken.find(credential);
    if (
      !token ||
      !token.isValid ||
      token.isExpired ||
      token.aud !== config.resource ||
      token.jkt ||
      token['x5t#S256'] ||
      !token.scopes.has(MCP_READ_SCOPE)
    )
      return null;
    const grant = await findValidOAuthGrant(token.grantId);
    return grant &&
      grant.userId === token.accountId &&
      grant.clientId === token.clientId &&
      grant.resource === config.resource &&
      grant.scope === MCP_READ_SCOPE
      ? grant
      : null;
  } catch {
    return null;
  }
}

export function registerMcpOAuthRoutes(
  app: FastifyInstance,
  config: McpOAuthConfig,
  authService: AuthService,
): Provider {
  const provider = createMcpOAuthProvider(config, authService);
  const callback = provider.callback();

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body as string))),
  );

  // nginx strips /api before forwarding. Present the external originalUrl and
  // the provider-relative url as documented by oidc-provider's mount API.
  app.addHook('onRequest', async (request, reply) => {
    if (
      !request.raw.url?.startsWith('/oauth/') ||
      request.raw.url.startsWith('/oauth/interaction/') ||
      request.raw.url.startsWith('/oauth/grants/')
    )
      return;
    const authorizationUrl = new URL(request.raw.url, config.issuer);
    let authorizationPath = authorizationUrl.pathname;
    try {
      authorizationPath = decodeURIComponent(authorizationPath);
    } catch {
      // Leave malformed paths for oidc-provider to reject.
    }
    const clientIds = authorizationUrl.searchParams.getAll('client_id');
    if (
      authorizationPath === '/oauth/auth' &&
      clientIds.includes(CHATGPT_CODEX_CLIENT) &&
      (clientIds.length !== 1 ||
        clientIds[0] !== CHATGPT_CODEX_CLIENT ||
        authorizationUrl.searchParams.getAll('redirect_uri').length !== 1 ||
        !isAllowedCodexRedirect(authorizationUrl.searchParams.get('redirect_uri')))
    ) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    reply.hijack();
    const externalUrl = `/api${request.raw.url}`;
    (request.raw as typeof request.raw & { originalUrl: string }).originalUrl = externalUrl;
    request.raw.url = request.raw.url.slice('/oauth'.length);
    callback(request.raw, reply.raw);
  });

  // Fastify must match a route for its onRequest hook to run. Interaction
  // routes below remain Fastify-owned; protocol routes are provider-owned.
  app.all('/oauth/*', async (_request, reply) => reply.code(404).send());

  app.get('/.well-known/oauth-protected-resource', async (_request, reply) =>
    reply.header('cache-control', 'public, max-age=300').send({
      resource: config.resource,
      authorization_servers: [config.issuer],
      scopes_supported: [MCP_READ_SCOPE],
    }),
  );

  const requirePipelineUser = async (
    request: FastifyRequest,
  ): Promise<{ id: string; refreshToken: string } | null> => {
    const refreshToken = request.cookies?.[config.refreshCookieName];
    const id = await pipelineUserFromCookie(refreshToken, authService);
    return id && refreshToken ? { id, refreshToken } : null;
  };

  app.get<{ Params: { uid: string } }>('/oauth/interaction/:uid', async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const details = await provider.interactionDetails(request.raw, reply.raw);
    if (details.uid !== request.params.uid)
      return reply.code(400).send({ error: 'invalid_interaction' });
    const user = await requirePipelineUser(request);
    if (!user) {
      const continuePath = `/api/oauth/interaction/${encodeURIComponent(details.uid)}`;
      return reply.redirect(`/?oauth_continue=${encodeURIComponent(continuePath)}`);
    }
    if (details.prompt.name === 'login') {
      const returnTo = await provider.interactionResult(
        request.raw,
        reply.raw,
        { login: { accountId: user.id } },
        { mergeWithLastSubmission: false },
      );
      return reply.code(303).redirect(publicResumePath(returnTo, config.issuer));
    }
    if (
      details.prompt.name !== 'consent' ||
      details.session?.accountId !== user.id ||
      details.params.resource !== config.resource ||
      details.params.scope !== MCP_READ_SCOPE ||
      typeof details.params.client_id !== 'string'
    ) {
      return reply.code(403).send({ error: 'authorization_denied' });
    }
    const workspaces = await listOAuthWorkspaces(user.id);
    if (workspaces.length === 0) return reply.code(403).send({ error: 'workspace_required' });
    const offeredWorkspaceIds = workspaces.map((workspace) => workspace.id).join(',');
    const csrf = consentCsrf(
      config.cookieKeys[0]!, details.uid, user.refreshToken, user.id, offeredWorkspaceIds,
    );
    const choices =
      workspaces.length === 1
        ? `<p>Workspace: <strong>${escapeHtml(workspaces[0]!.name)}</strong></p>
           <input type="hidden" name="workspaceId" value="${workspaces[0]!.id}">`
        : `<label for="workspace">Workspace</label><select id="workspace" name="workspaceId" required>
           <option value="">Choose a workspace</option>${workspaces
             .map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}</option>`)
             .join('')}</select>`;
    return reply
      .type('text/html; charset=utf-8')
      .header(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
      )
      .send(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Authorize ChatGPT</title>
       <style>body{font:16px system-ui;max-width:34rem;margin:8vh auto;padding:1rem;line-height:1.5}select,button{font:inherit;padding:.5rem;margin:.4rem 0}button{cursor:pointer}</style>
       <h1>Connect ChatGPT</h1><p>ChatGPT will receive read access to teaching context in one ESL Pipeline workspace. It cannot change learner state.</p>
       <form method="post" action="/api/oauth/interaction/${encodeURIComponent(details.uid)}/confirm">
       <input type="hidden" name="csrf" value="${csrf}">
       <input type="hidden" name="offeredWorkspaceIds" value="${offeredWorkspaceIds}">
       ${choices}<p><button type="submit">Authorize read access</button></p></form></html>`,
      );
  });

  app.post<{ Params: { uid: string }; Body: { csrf?: string; workspaceId?: string; offeredWorkspaceIds?: string } }>(
    '/oauth/interaction/:uid/confirm',
    async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const details = await provider.interactionDetails(request.raw, reply.raw);
      const user = await requirePipelineUser(request);
      if (
        !user ||
        details.uid !== request.params.uid ||
        details.prompt.name !== 'consent' ||
        details.session?.accountId !== user.id ||
        details.params.resource !== config.resource ||
        details.params.scope !== MCP_READ_SCOPE ||
        typeof details.params.client_id !== 'string'
      ) {
        return reply.code(403).send({ error: 'authorization_denied' });
      }
      const offeredWorkspaceIds = request.body?.offeredWorkspaceIds;
      const expected = consentCsrf(
        config.cookieKeys[0]!, details.uid, user.refreshToken, user.id,
        offeredWorkspaceIds ?? '',
      );
      if (!request.body?.csrf || !offeredWorkspaceIds ||
          !csrfMatches(request.body.csrf, expected)) {
        return reply.code(403).send({ error: 'invalid_csrf' });
      }
      const workspaces = await listOAuthWorkspaces(user.id);
      const selected = offeredWorkspaceIds.split(',').includes(request.body.workspaceId ?? '')
        ? workspaces.find((workspace) => workspace.id === request.body.workspaceId)
        : undefined;
      if (!selected) return reply.code(403).send({ error: 'workspace_required' });
      const grant = new provider.Grant({ accountId: user.id, clientId: details.params.client_id });
      // oidc-provider tracks advertised static scopes separately from resource
      // scopes. Cover its static-scope consent check without enabling OIDC identity.
      grant.addOIDCScope(MCP_READ_SCOPE);
      grant.addResourceScope(config.resource, MCP_READ_SCOPE);
      const grantId = await grant.save();
      const bound = await bindOAuthGrant(
        {
          id: grantId,
          userId: user.id,
          workspaceId: selected.id,
          clientId: details.params.client_id,
          resource: config.resource,
          scope: MCP_READ_SCOPE,
        },
        GRANT_TTL_SECONDS,
      );
      if (!bound) {
        await grant.destroy();
        return reply.code(403).send({ error: 'workspace_required' });
      }
      logger.info('MCP OAuth grant authorized', {
        event: 'mcp_oauth_authorized',
        userId: user.id,
        workspaceId: selected.id,
      });
      const returnTo = await provider.interactionResult(
        request.raw,
        reply.raw,
        { consent: { grantId } },
        { mergeWithLastSubmission: true },
      );
      return reply.code(303).redirect(publicResumePath(returnTo, config.issuer));
    },
  );

  app.post<{ Params: { grantId: string } }>(
    '/oauth/grants/:grantId/revoke',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = getAuthenticatedUser(request);
      if (!user || !(await revokeOAuthGrant(request.params.grantId, user.id))) {
        return reply.code(404).send({ error: 'not_found' });
      }
      await provider.AccessToken.revokeByGrantId(request.params.grantId);
      await provider.RefreshToken.revokeByGrantId(request.params.grantId);
      logger.info('MCP OAuth grant revoked', { event: 'mcp_oauth_revoked', userId: user.id });
      return reply.code(204).send();
    },
  );

  return provider;
}
