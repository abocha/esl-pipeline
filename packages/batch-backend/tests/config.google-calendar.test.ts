import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadConfig } from '../src/config/env.js';
import { calendarCredentialServices } from '../src/domain/google-connection-repository.js';

describe('Calendar-only configuration availability', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(['missing', 'bad-key', 'bad-callback', 'strict-cookie'])(
    'keeps unrelated configuration usable for %s Calendar configuration',
    (scenario) => {
      vi.stubEnv('GOOGLE_CALENDAR_ENABLED', 'true');
      vi.stubEnv('GOOGLE_CALENDAR_CLIENT_ID', scenario === 'missing' ? '' : 'id');
      vi.stubEnv('GOOGLE_CALENDAR_CLIENT_SECRET', 'secret');
      vi.stubEnv(
        'GOOGLE_CALENDAR_REDIRECT_URI',
        scenario === 'bad-callback'
          ? 'https://example.test/elsewhere'
          : 'https://example.test/api/google/calendar/callback',
      );
      vi.stubEnv('INTEGRATION_CREDENTIAL_ACTIVE_KEY_ID', 'v1');
      vi.stubEnv(
        'INTEGRATION_CREDENTIAL_KEYS',
        JSON.stringify({
          v1: scenario === 'bad-key' ? 'short' : randomBytes(32).toString('base64'),
        }),
      );
      vi.stubEnv('NODE_ENV', scenario === 'strict-cookie' ? 'production' : 'test');
      vi.stubEnv('REFRESH_COOKIE_SAMESITE', scenario === 'strict-cookie' ? 'strict' : 'lax');
      vi.stubEnv('REFRESH_COOKIE_SECURE', 'true');
      const config = loadConfig();
      expect(config.auth.jwtSecret).toBeTruthy();
      expect(config.googleCalendar?.configurationError).toBe(
        'google_calendar_configuration_invalid',
      );
      expect(() => calendarCredentialServices()).toThrow('google_calendar_configuration_invalid');
    },
  );
  it('requires no provider keys when scheduling integration is disabled', () => {
    vi.stubEnv('GOOGLE_CALENDAR_ENABLED', 'false');
    vi.stubEnv('INTEGRATION_CREDENTIAL_KEYS', 'malformed');
    expect(loadConfig().googleCalendar).toMatchObject({ enabled: false });
    expect(() => calendarCredentialServices()).toThrow('google_calendar_disabled');
  });
});
