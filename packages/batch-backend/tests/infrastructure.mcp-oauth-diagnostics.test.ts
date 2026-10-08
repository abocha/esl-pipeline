import { errors } from 'oidc-provider';
import { describe, expect, it } from 'vitest';

import {
  classifyOAuthError,
  oauthClientClass,
  oauthGrantReference,
} from '../src/infrastructure/mcp-oauth-diagnostics.js';

describe('bounded OAuth diagnostic fields', () => {
  it('classifies published client shapes without exposing IDs or trusting suffixes', () => {
    expect(oauthClientClass('https://chatgpt.com/oauth/client.json')).toBe('chatgpt_web');
    expect(oauthClientClass('https://chatgpt.com/oauth/private-connector/client.json')).toBe(
      'chatgpt_web',
    );
    expect(oauthClientClass('https://chatgpt.com/oauth/codex/client.json')).toBe('codex');
    expect(oauthClientClass('https://chatgpt.com.evil.test/oauth/client.json')).toBe('other');
    expect(oauthClientClass(['https://chatgpt.com/oauth/client.json'])).toBe('other');
  });

  it('uses only exact safe provider reason mappings and rejects arbitrary exception payloads', () => {
    expect(classifyOAuthError(new errors.InvalidGrant('client mismatch'))).toEqual({
      code: 'invalid_grant',
      reason: 'client_mismatch',
    });
    expect(
      classifyOAuthError(
        new errors.InvalidRequest("'grant_type' parameter must not be provided twice"),
      ),
    ).toEqual({ code: 'invalid_request', reason: 'duplicate_grant_type' });
    const secret = 'private-token-secret-cookie-student-value';
    const unknown = Object.assign(new Error(secret), {
      error_description: secret,
      error_detail: secret,
      cause: new Error(secret),
      token: secret,
    });
    expect(classifyOAuthError(unknown)).toEqual({
      code: 'unclassified',
      reason: 'unclassified_failure',
    });
    expect(classifyOAuthError(new errors.InvalidGrant(secret))).toEqual({
      code: 'invalid_grant',
      reason: 'invalid_grant',
    });
    expect(JSON.stringify(classifyOAuthError(unknown))).not.toContain(secret);
  });

  it('derives grant references with domain-separated keyed hashes', () => {
    const first = oauthGrantReference('private-grant-id', 'private-key');
    expect(first).toMatch(/^[0-9a-f]{24}$/);
    expect(oauthGrantReference('private-grant-id', 'private-key')).toBe(first);
    expect(oauthGrantReference('private-grant-id', 'other-key')).not.toBe(first);
    expect(oauthGrantReference('other-grant-id', 'private-key')).not.toBe(first);
    expect(first).not.toContain('private');
  });
});
