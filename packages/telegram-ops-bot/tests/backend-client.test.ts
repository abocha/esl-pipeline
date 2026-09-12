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
              integrityMaxAgeDays: null,
              drillMaxAgeDays: null,
            },
            backup: {
              state: 'healthy',
              reason: 'ok',
              latestDumpKey: null,
              lastModifiedUtc: null,
              ageHours: null,
            },
            artifactIntegrity: {
              state: 'healthy',
              reason: 'ok',
              lastReportUtc: null,
              ageDays: null,
              reportStatus: null,
              remoteDumpKey: null,
              result: null,
              checksumVerified: true,
            },
            restoreDrill: {
              state: 'healthy',
              reason: 'ok',
              lastReportUtc: null,
              ageDays: null,
              reportStatus: null,
              remoteDumpKey: null,
              result: null,
              postgresVersion: null,
              restoreVerified: true,
              cleanupStatus: 'removed',
              publicTableCount: null,
              schemaMigrationCount: null,
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

  it('queries recent ops actions with bounded pagination params', async () => {
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

      if (url.includes('/ops/actions?')) {
        return Response.json(
          {
            actions: [],
            total: 0,
            limit: 20,
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

    await client.listOpsActions(50, -3);

    expect(urls.some((url) => url.includes('/ops/actions?limit=20&offset=0'))).toBe(true);
  });

  it('serializes admin job filters for listJobs()', async () => {
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
            limit: 5,
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

    await client.listJobs({
      states: ['failed', 'running'],
      studentId: 'student-1',
      from: '2026-03-14T00:00:00.000Z',
      to: '2026-03-15T00:00:00.000Z',
      limit: 5,
      offset: 0,
      order: 'asc',
    });

    expect(urls.some((url) => url.includes('/admin/jobs?'))).toBe(true);
    const url = urls.find((entry) => entry.includes('/admin/jobs?')) ?? '';
    expect(url).toContain('state=failed%2Crunning');
    expect(url).toContain('studentId=student-1');
    expect(url).toContain('from=2026-03-14T00%3A00%3A00.000Z');
    expect(url).toContain('to=2026-03-15T00%3A00%3A00.000Z');
    expect(url).toContain('limit=5');
    expect(url).toContain('offset=0');
    expect(url).toContain('order=asc');
  });

  it('queries /admin/jobs/summary and /students search endpoints', async () => {
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

      if (url.includes('/admin/jobs/summary?')) {
        return Response.json(
          {
            total: 1,
            byState: {
              queued: 0,
              running: 0,
              awaiting_approval: 0,
              succeeded: 1,
              failed: 0,
            },
            pendingApprovals: 0,
            last7Days: {
              total: 1,
              succeeded: 1,
              failed: 0,
            },
            tts: {
              enabled: 1,
              succeeded: 1,
            },
          },
          { status: 200 },
        );
      }

      if (url.includes('/students?')) {
        return Response.json(
          {
            items: [{ id: 'student-1', student: 'Mary Jane' }],
            total: 1,
            limit: 10,
            offset: 0,
            order: 'asc',
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

    await client.getAdminJobSummary({
      from: '2026-03-14T00:00:00.000Z',
      to: '2026-03-14T12:00:00.000Z',
    });
    await client.searchStudents('Mary Jane', 10);

    expect(
      urls.some((url) =>
        url.includes(
          '/admin/jobs/summary?from=2026-03-14T00%3A00%3A00.000Z&to=2026-03-14T12%3A00%3A00.000Z',
        ),
      ),
    ).toBe(true);
    expect(
      urls.some((url) => url.includes('/students?q=Mary+Jane&limit=10&offset=0&order=asc')),
    ).toBe(true);
  });

  it('queries /students/summary with paging params', async () => {
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

      if (url.includes('/students/summary?')) {
        return Response.json(
          {
            items: [
              {
                id: 'student-1',
                name: 'Mary Jane',
                lastLessonAt: '2026-03-14T08:47:06.373Z',
                pendingDrafts: 0,
              },
            ],
            total: 1,
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

    await client.listStudentSummaries({
      limit: 10,
      offset: 20,
      order: 'desc',
    });

    expect(
      urls.some((url) => url.includes('/students/summary?limit=10&offset=20&order=desc')),
    ).toBe(true);
  });
});
