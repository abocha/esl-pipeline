import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import type Provider from 'oidc-provider';
import { errors, type KoaContextWithOIDC } from 'oidc-provider';

import { withSanitizedPgLogging } from './db.js';
import { logger } from './logger.js';

type DiagnosticState = {
  requestId: string;
  grantRef?: string;
  refreshConsumed?: boolean;
  refreshSaved?: boolean;
  familyRevoked?: boolean;
  adapterReason?: 'grant_unavailable' | 'consume_conflict';
  error?: { code: string; reason: string };
  reference: (id: string) => string;
};
const context = new AsyncLocalStorage<DiagnosticState>();

export function oauthGrantReference(id: string, key: string): string {
  return createHmac('sha256', key)
    .update(`mcp-oauth-diagnostics\0${id}`)
    .digest('hex')
    .slice(0, 24);
}

export function oauthClientClass(clientId: unknown): 'chatgpt_web' | 'codex' | 'other' {
  if (clientId === 'https://chatgpt.com/oauth/codex/client.json') return 'codex';
  if (
    typeof clientId === 'string' &&
    (clientId === 'https://chatgpt.com/oauth/client.json' ||
      /^https:\/\/chatgpt\.com\/oauth\/[A-Za-z0-9_-]+\/client\.json$/.test(clientId))
  )
    return 'chatgpt_web';
  return 'other';
}

// Mutating outcomes are recorded only after commit; observations contain no raw identifiers.
export function recordOAuthLifecycle(
  outcome:
    | 'grant_observed'
    | 'refresh_consumed'
    | 'refresh_saved'
    | 'family_revoked'
    | 'grant_unavailable'
    | 'consume_conflict',
  grantId?: string,
): void {
  const state = context.getStore();
  if (!state) return;
  if (grantId) state.grantRef = state.reference(grantId);
  if (outcome === 'refresh_consumed') state.refreshConsumed = true;
  if (outcome === 'refresh_saved') state.refreshSaved = true;
  if (outcome === 'family_revoked') state.familyRevoked = true;
  if (outcome === 'grant_unavailable' || outcome === 'consume_conflict')
    state.adapterReason = outcome;
}

const errorCodes = new Set([
  'invalid_request',
  'invalid_client',
  'invalid_grant',
  'unauthorized_client',
  'unsupported_grant_type',
  'invalid_scope',
  'invalid_target',
  'access_denied',
  'server_error',
  'temporarily_unavailable',
  'invalid_redirect_uri',
  'invalid_client_metadata',
]);
// Exact matches against the pinned provider, never log descriptions, details, causes or stacks.
const reasons = new Map([
  ['refresh token not found', 'refresh_not_found'],
  ['refresh token is expired', 'refresh_expired'],
  ['refresh token already used', 'refresh_replayed'],
  ['authorization code not found', 'code_not_found'],
  ['authorization code is expired', 'code_expired'],
  ['authorization code already consumed', 'code_replayed'],
  ['authorization code redirect_uri mismatch', 'redirect_mismatch'],
  ['client mismatch', 'client_mismatch'],
  ['grant not found', 'grant_not_found'],
  ['grant is expired', 'grant_expired'],
  ['Pipeline grant is no longer valid', 'pipeline_grant_invalid'],
  ['failed to parse the request body', 'body_parse_failed'],
  [
    'only application/x-www-form-urlencoded content-type bodies are supported on POST /token',
    'unsupported_content_type',
  ],
  ["missing required parameter 'refresh_token'", 'refresh_parameter_missing'],
  ["missing required parameter 'code'", 'code_parameter_missing'],
  ["missing required parameter 'grant_type'", 'grant_type_missing'],
  ["'grant_type' parameter must not be provided twice", 'duplicate_grant_type'],
  ["'client_id' parameter must not be provided twice", 'duplicate_client_id'],
  ["'refresh_token' parameter must not be provided twice", 'duplicate_refresh_token'],
]);

export function classifyOAuthError(error: unknown): { code: string; reason: string } {
  const err = error as {
    message?: unknown;
    error_detail?: unknown;
    error_description?: unknown;
    cause?: { message?: unknown };
  } | null;
  const code =
    typeof err?.message === 'string' && errorCodes.has(err.message) ? err.message : 'unclassified';
  const detail = err?.error_detail;
  const description = err?.error_description;
  const knownReason =
    (typeof detail === 'string' ? reasons.get(detail) : undefined) ??
    (typeof description === 'string' ? reasons.get(description) : undefined);
  if (knownReason) return { code, reason: knownReason };
  if (
    code === 'invalid_grant' &&
    (err?.cause?.message === 'code_verifier does not match code_challenge' ||
      err?.cause?.message === 'code_verifier must be provided')
  )
    return { code, reason: 'pkce_verification_failed' };
  return { code, reason: code === 'unclassified' ? 'unclassified_failure' : code };
}

/** Supported provider middleware/events; one summary per token or initial authorization request. */
export function installOAuthDiagnostics(provider: Provider, resource: string, key: string): void {
  // Koa otherwise installs a default listener that prints escaping exception messages/stacks
  // to stderr. Endpoint diagnostics alone cannot sanitize those container log records.
  // Provider's narrowed event typings omit this inherited Koa/EventEmitter event.
  (provider as EventEmitter).on('error', () => {
    logger.error('MCP OAuth provider request failed', {
      event: 'mcp_oauth_provider_error',
      oauthError: 'server_error',
      reason: 'server_failure',
    });
  });
  const captureError = (_ctx: KoaContextWithOIDC, error: unknown) => {
    const state = context.getStore();
    if (state) state.error = classifyOAuthError(error);
  };
  provider.on('grant.error', captureError);
  provider.on('authorization.error', captureError);
  provider.on('revocation.error', captureError);
  provider.on('server_error', (ctx, error) => {
    captureError(ctx, error);
    const state = context.getStore();
    if (state) state.error = { code: 'server_error', reason: 'server_failure' };
  });
  provider.use(async (ctx, next) => {
    // Match the pinned provider's static routes: case-insensitive, with one optional trailing slash.
    // This only selects diagnostics; the provider still owns request routing and validation.
    const path = ctx.path.replace(/\/$/, '').toLowerCase();
    const operation =
      path === '/token'
        ? 'token'
        : path === '/auth'
          ? 'authorization'
          : path === '/token/revocation'
            ? 'revocation'
            : undefined;
    if (!operation || ctx.method === 'OPTIONS') return next();
    const started = performance.now();
    const state: DiagnosticState = {
      requestId: randomUUID(),
      reference: (id) => oauthGrantReference(id, key),
    };
    await context.run(state, () =>
      withSanitizedPgLogging(async () => {
        let escapedStatus: number | undefined;
        try {
          await next();
        } catch (error) {
          const classified = classifyOAuthError(error);
          state.error ??=
            classified.code === 'unclassified'
              ? { code: 'server_error', reason: 'server_failure' }
              : classified;
          // Endpoint handlers normally assign the response status. Cleanup failures can escape
          // them; account for the provider error status or Koa's default 500 without altering it.
          escapedStatus = error instanceof errors.OIDCProviderError ? error.statusCode : 500;
          throw error;
        } finally {
          const params = ctx.oidc?.params;
          const entities = ctx.oidc?.entities;
          const grantId =
            entities?.Grant?.jti ??
            entities?.RefreshToken?.grantId ??
            entities?.AuthorizationCode?.grantId;
          if (grantId && !state.grantRef) state.grantRef = state.reference(grantId);
          const failed = !!state.error || ctx.status >= 400;
          const fields = {
            event: 'mcp_oauth_diagnostic',
            operation,
            requestId: state.requestId,
            timestamp: new Date().toISOString(),
            durationMs: Math.round(performance.now() - started),
            status: escapedStatus ?? ctx.status,
            outcome: failed ? 'rejected' : 'completed',
            clientClass: oauthClientClass(params?.client_id ?? ctx.oidc?.client?.clientId),
            grantType:
              operation === 'authorization'
                ? 'authorization_code'
                : params?.grant_type === 'authorization_code' ||
                    params?.grant_type === 'refresh_token'
                  ? params.grant_type
                  : 'other_or_unavailable',
            resourceState: !params
              ? 'unavailable'
              : params.resource === undefined
                ? 'absent'
                : params.resource === resource
                  ? 'expected'
                  : 'unexpected',
            ...(state.grantRef ? { grantRef: state.grantRef } : {}),
            ...(failed
              ? {
                  oauthError: state.error?.code ?? 'unclassified',
                  reason: state.adapterReason ?? state.error?.reason ?? 'unclassified_failure',
                }
              : {}),
            refreshConsumed: state.refreshConsumed === true,
            refreshSaved: state.refreshSaved === true,
            refreshRotated: !!entities?.RotatedRefreshToken && state.refreshSaved === true,
            familyRevoked: state.familyRevoked === true,
          };
          if (failed) logger.warn('MCP OAuth request rejected', fields);
          else logger.info('MCP OAuth request completed', fields);
        }
      }),
    );
  });
}
