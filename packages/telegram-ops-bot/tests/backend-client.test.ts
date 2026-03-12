import { describe, expect, it, vi } from 'vitest';

import { HttpBackendClient } from '../src/backend-client.js';

describe('backend client', () => {
  it('uses login, then refresh, and forwards ops shared secret', async () => {
    const urls: string[] = [];
    const authHeaders: string[] = [];
    const secretHeaders: string[] = [];

    const fetchMock: typeof fetch = vi.fn(async (input, init) => {
      const url = String(input);
      urls.push(url);
      authHeaders.push(
        String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ''),
      );
      secretHeaders.push(
        String((init?.headers as Record<string, string> | undefined)?.['x-ops-bot-secret'] ?? ''),
      );

      if (url.endsWith('/auth/login')) {
        return Response.json(
          {
            accessToken: 'token-1',
            expiresIn: 0,
          },
          {
            status: 200,
            headers: {
              'set-cookie': 'esl_refresh=abc; Path=/; HttpOnly',
            },
          },
        );
      }

      if (url.endsWith('/auth/refresh')) {
        return Response.json(
          {
            accessToken: 'token-2',
            expiresIn: 3600,
          },
          {
            status: 200,
            headers: {
              'set-cookie': 'esl_refresh=def; Path=/; HttpOnly',
            },
          },
        );
      }

      if (url.endsWith('/ops/status')) {
        return Response.json(
          {
            checkedAtUtc: '2026-03-11T00:00:00Z',
            overall: { state: 'healthy', reasons: [] },
            thresholds: {
              backupMaxAgeHours: null,
              drillMaxAgeDays: null,
              keyRotationMaxAgeDays: null,
            },
            backup: {
              state: 'healthy',
              reason: 'ok',
              latestDumpKey: null,
              lastModifiedUtc: null,
              ageHours: null,
            },
            restoreDrill: {
              state: 'healthy',
              reason: 'ok',
              lastReportUtc: null,
              ageDays: null,
              reportStatus: null,
              reportMode: null,
              latestRemoteDumpKey: null,
              drillResult: null,
            },
            keyRotation: {
              state: 'healthy',
              reason: 'ok',
              iamUser: null,
              oldestAccessKeyId: null,
              oldestCreatedUtc: null,
              oldestAgeDays: null,
              oldestLastUsedUtc: null,
            },
          },
          {
            status: 200,
          },
        );
      }

      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const client = new HttpBackendClient({
      baseUrl: 'http://batch-backend:8080',
      email: 'bot@example.com',
      password: 'secret',
      timeoutMs: 10_000,
      sharedSecret: 'shared-secret',
      fetchImpl: fetchMock,
    });

    await client.getOpsStatus();
    await client.getOpsStatus();

    expect(urls.filter((url) => url.endsWith('/auth/login'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(urls.filter((url) => url.endsWith('/ops/status'))).toHaveLength(2);
    expect(authHeaders.some((header) => header.includes('Bearer token-1'))).toBe(true);
    expect(authHeaders.some((header) => header.includes('Bearer token-2'))).toBe(true);
    expect(
      secretHeaders.filter((header) => header === 'shared-secret').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('queries finished jobs from the admin jobs endpoint', async () => {
    const urls: string[] = [];

    const fetchMock: typeof fetch = vi.fn(async (input) => {
      const url = String(input);
      urls.push(url);

      if (url.endsWith('/auth/login')) {
        return Response.json(
          {
            accessToken: 'token-1',
            expiresIn: 3600,
          },
          {
            status: 200,
            headers: {
              'set-cookie': 'esl_refresh=abc; Path=/; HttpOnly',
            },
          },
        );
      }

      if (url.includes('/admin/jobs?')) {
        return Response.json(
          {
            jobs: [],
            total: 0,
            limit: 10,
            offset: 0,
          },
          { status: 200 },
        );
      }

      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const client = new HttpBackendClient({
      baseUrl: 'http://batch-backend:8080',
      email: 'bot@example.com',
      password: 'secret',
      timeoutMs: 10_000,
      fetchImpl: fetchMock,
    });

    await client.getFinishedJobs(10);

    expect(urls.some((url) => url.includes('/admin/jobs?'))).toBe(true);
    expect(urls.some((url) => url.includes('/user/jobs?'))).toBe(false);
  });
});
