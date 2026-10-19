import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library';

export const GOOGLE_CALENDAR_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events',
] as const;

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

function createBoundedOAuthClient(config: GoogleOAuthConfig): OAuth2Client {
  return new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
    // Exchange makes at most token, certificate and token-info requests: 45s total,
    // below the 60s credential lease. A refresh makes one request. The SDK enables
    // retry:true per request, so explicitly zero retryConfig rather than relying on
    // the transporter's retry:false default being preserved by SDK request options.
    transporterOptions: {
      timeout: 15_000,
      retryConfig: { retry: 0, noResponseRetries: 0, totalTimeout: 15_000 },
    },
  });
}

export class GoogleOAuthError extends Error {
  constructor(
    public readonly code:
      | 'google_unavailable'
      | 'google_reauthorization_required'
      | 'google_identity_invalid'
      | 'google_scopes_incomplete'
      | 'google_offline_required',
  ) {
    super(code);
    this.name = 'GoogleOAuthError';
  }
}

export interface GoogleGrantTokens {
  subject: string;
  issuer: string;
  email: string;
  scopes: string[];
  accessToken: string;
  expiresAt: Date;
  refreshToken: string | null;
}

/** No SDK request() calls: event-write retries belong exclusively to durable Calendar operations. */
export class GoogleOAuthClient {
  private readonly client: OAuth2Client;
  constructor(private readonly config: GoogleOAuthConfig) {
    this.client = createBoundedOAuthClient(config);
  }

  authorizationUrl(state: string, nonce: string, challenge: string): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [...GOOGLE_CALENDAR_SCOPES],
      include_granted_scopes: false,
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
  }

  async exchange(code: string, verifier: string, nonce: string): Promise<GoogleGrantTokens> {
    try {
      const { tokens } = await this.client.getToken({
        code,
        codeVerifier: verifier,
        redirect_uri: this.config.redirectUri,
      });
      if (!tokens.id_token || !tokens.access_token || !tokens.expiry_date)
        throw new GoogleOAuthError('google_identity_invalid');
      const ticket = await this.client.verifyIdToken({
        idToken: tokens.id_token,
        audience: this.config.clientId,
      });
      const identity = ticket.getPayload();
      if (
        !identity?.sub ||
        !identity.email ||
        identity.email_verified !== true ||
        identity.nonce !== nonce ||
        !['https://accounts.google.com', 'accounts.google.com'].includes(identity.iss)
      )
        throw new GoogleOAuthError('google_identity_invalid');
      // Token info reports the actual access-token scopes, never the requested scope list.
      const info = await this.client.getTokenInfo(tokens.access_token);
      const scopes = info.scopes;
      if (
        !GOOGLE_CALENDAR_SCOPES.filter((s) => s !== 'email').every((s) => scopes.includes(s)) ||
        !scopes.some((s) => s === 'email' || s === 'https://www.googleapis.com/auth/userinfo.email')
      )
        throw new GoogleOAuthError('google_scopes_incomplete');
      return {
        subject: identity.sub,
        issuer: 'https://accounts.google.com',
        email: identity.email,
        scopes,
        accessToken: tokens.access_token,
        expiresAt: new Date(tokens.expiry_date),
        refreshToken: tokens.refresh_token ?? null,
      };
    } catch (error) {
      throw safeGoogleOAuthError(error);
    }
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; expiresAt: Date; refreshToken: string | null }> {
    try {
      // A new client per refresh prevents mutable credentials crossing requests/grants.
      const client = createBoundedOAuthClient(this.config);
      client.setCredentials({ refresh_token: refreshToken });
      const { credentials } = await client.refreshAccessToken();
      if (!credentials.access_token || !credentials.expiry_date)
        throw new GoogleOAuthError('google_reauthorization_required');
      return {
        accessToken: credentials.access_token,
        expiresAt: new Date(credentials.expiry_date),
        refreshToken: credentials.refresh_token ?? null,
      };
    } catch (error) {
      throw safeGoogleOAuthError(error);
    }
  }
}

function safeGoogleOAuthError(error: unknown): GoogleOAuthError {
  if (error instanceof GoogleOAuthError) return error;
  const data = (error as { response?: { data?: { error?: unknown } } })?.response?.data;
  return new GoogleOAuthError(
    data?.error === 'invalid_grant' ? 'google_reauthorization_required' : 'google_unavailable',
  );
}
