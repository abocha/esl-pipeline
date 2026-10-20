import { OAuth2Client } from 'google-auth-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GOOGLE_CALENDAR_SCOPES,
  GoogleOAuthClient,
} from '../src/infrastructure/google-oauth-client.js';

describe('Google OAuth verification adapter', () => {
  const config = {
    clientId: 'audience',
    clientSecret: 'client-secret',
    redirectUri: 'https://app.example.test/api/google/calendar/callback',
  };
  beforeEach(() => {
    vi.spyOn(OAuth2Client.prototype, 'getToken').mockResolvedValue({
      tokens: {
        id_token: 'opaque-signed-id-token',
        access_token: 'access',
        expiry_date: Date.now() + 3600_000,
      },
    } as never);
    vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
      getPayload: () => ({
        sub: 'verified-subject',
        email: 'verified@example.test',
        email_verified: true,
        iss: 'https://accounts.google.com',
        nonce: 'expected-nonce',
      }),
    } as never);
    vi.spyOn(OAuth2Client.prototype, 'getTokenInfo').mockResolvedValue({
      scopes: [...GOOGLE_CALENDAR_SCOPES],
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());
  it('passes audience to maintained verification and persists actual scopes, not requested scope claims', async () => {
    vi.mocked(OAuth2Client.prototype.getTokenInfo).mockResolvedValue({
      scopes: [...GOOGLE_CALENDAR_SCOPES, 'actual-extra-scope'],
    } as never);
    const result = await new GoogleOAuthClient(config).exchange(
      'code',
      'pkce-verifier',
      'expected-nonce',
    );
    expect(OAuth2Client.prototype.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'opaque-signed-id-token',
      audience: 'audience',
    });
    expect(OAuth2Client.prototype.getToken).toHaveBeenCalledWith({
      code: 'code',
      codeVerifier: 'pkce-verifier',
      redirect_uri: config.redirectUri,
    });
    expect(result.scopes).toContain('actual-extra-scope');
    expect(result.refreshToken).toBeNull();
  });
  it.each([
    { nonce: 'wrong' },
    { email_verified: false },
    { iss: 'https://attacker.example' },
    { sub: undefined },
  ])('rejects verified token with invalid connection identity %j', async (invalid) => {
    vi.mocked(OAuth2Client.prototype.verifyIdToken).mockResolvedValue({
      getPayload: () => ({
        sub: 'subject',
        email: 'verified@example.test',
        email_verified: true,
        iss: 'https://accounts.google.com',
        nonce: 'expected-nonce',
        ...invalid,
      }),
    } as never);
    await expect(
      new GoogleOAuthClient(config).exchange('code', 'verifier', 'expected-nonce'),
    ).rejects.toMatchObject({ code: 'google_identity_invalid' });
  });
  it('rejects incomplete actual scopes despite a complete consent request', async () => {
    vi.mocked(OAuth2Client.prototype.getTokenInfo).mockResolvedValue({
      scopes: ['openid', 'email'],
    } as never);
    await expect(
      new GoogleOAuthClient(config).exchange('code', 'verifier', 'expected-nonce'),
    ).rejects.toMatchObject({ code: 'google_scopes_incomplete' });
  });
  it('sanitizes revoked grants and arbitrary SDK errors', async () => {
    vi.mocked(OAuth2Client.prototype.getToken).mockRejectedValueOnce({
      response: { data: { error: 'invalid_grant', error_description: 'credential-sentinel' } },
    });
    await expect(
      new GoogleOAuthClient(config).exchange('code', 'verifier', 'expected-nonce'),
    ).rejects.toMatchObject({
      code: 'google_reauthorization_required',
      message: 'google_reauthorization_required',
    });
    vi.mocked(OAuth2Client.prototype.getToken).mockRejectedValueOnce(
      new Error('code-state-credential-sentinel'),
    );
    await expect(
      new GoogleOAuthClient(config).exchange('code', 'verifier', 'expected-nonce'),
    ).rejects.toMatchObject({ code: 'google_unavailable', message: 'google_unavailable' });
  });

  it.each(['exchange-token', 'exchange-certificates', 'exchange-token-info', 'refresh'] as const)(
    'bounds actual SDK transport and disables automatic retries for %s',
    async (scenario) => {
      // Keep the actual SDK request preparation/retry machinery; replace only its
      // final HTTP adapter. No provider request leaves the process.
      vi.restoreAllMocks();
      const originalGetToken = OAuth2Client.prototype.getToken;
      const originalRefresh = OAuth2Client.prototype.refreshAccessToken;
      const prepared: {
        url: string;
        timeout?: number;
        retries?: number;
        noResponseRetries?: number;
        hasSignal: boolean;
      }[] = [];
      function installAdapter(client: OAuth2Client) {
        client.transporter.defaults.adapter = async (options) => {
          prepared.push({
            url: String(options.url),
            timeout: options.timeout,
            retries: options.retryConfig?.retry,
            noResponseRetries: options.retryConfig?.noResponseRetries,
            hasSignal: Boolean(options.signal),
          });
          const tokenRequest = String(options.url).endsWith('/token');
          const continueExchange =
            tokenRequest && scenario !== 'exchange-token' && scenario !== 'refresh';
          const data = continueExchange
            ? { id_token: 'synthetic-id-token', access_token: 'synthetic-access', expires_in: 3600 }
            : { error: 'temporarily_unavailable' };
          return Object.assign(
            new Response(JSON.stringify(data), { status: continueExchange ? 200 : 503 }),
            { data, config: options },
          ) as never;
        };
      }
      vi.spyOn(OAuth2Client.prototype, 'getToken').mockImplementation(function (
        this: OAuth2Client,
        ...args: Parameters<OAuth2Client['getToken']>
      ) {
        installAdapter(this);
        return Reflect.apply(originalGetToken, this, args);
      });
      vi.spyOn(OAuth2Client.prototype, 'refreshAccessToken').mockImplementation(function (
        this: OAuth2Client,
      ) {
        installAdapter(this);
        return Reflect.apply(originalRefresh, this, []);
      });
      if (scenario === 'exchange-token-info') {
        vi.spyOn(OAuth2Client.prototype, 'verifyIdToken').mockResolvedValue({
          getPayload: () => ({
            sub: 'subject',
            email: 'verified@example.test',
            email_verified: true,
            iss: 'https://accounts.google.com',
            nonce: 'nonce',
          }),
        } as never);
      }
      const client = new GoogleOAuthClient(config);
      await expect(
        scenario === 'refresh'
          ? client.refresh('synthetic-refresh')
          : client.exchange('synthetic-code', 'verifier', 'nonce'),
      ).rejects.toMatchObject({ code: 'google_unavailable' });
      expect(prepared).toHaveLength(
        scenario === 'exchange-token' || scenario === 'refresh' ? 1 : 2,
      );
      expect(
        prepared.map(({ timeout, retries, noResponseRetries, hasSignal }) => ({
          timeout,
          retries,
          noResponseRetries,
          hasSignal,
        })),
      ).toEqual(
        prepared.map(() => ({
          timeout: 15_000,
          retries: 0,
          noResponseRetries: 0,
          hasSignal: true,
        })),
      );
      expect(prepared.at(-1)?.url).toMatch(
        scenario === 'exchange-certificates'
          ? /\/certs$/
          : scenario === 'exchange-token-info'
            ? /tokeninfo$/
            : /\/token$/,
      );
    },
  );
});
