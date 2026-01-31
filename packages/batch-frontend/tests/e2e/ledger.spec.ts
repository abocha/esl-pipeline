import { test, expect } from '@playwright/test';
import { setupApiMocks } from './mocks';

const buildJob = (overrides: Record<string, unknown>) => ({
  jobId: 'job-1',
  md: '/uploads/lesson.md',
  recordingId: null,
  transcriptId: null,
  promptPackageId: null,
  draftId: null,
  preset: null,
  withTts: null,
  voiceId: null,
  upload: null,
  voiceAccent: null,
  forceTts: null,
  notionDatabase: null,
  ttsStrategy: null,
  notionUrl: null,
  state: 'running',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  error: null,
  manifestPath: null,
  ...overrides,
});

const injectSseMock = async (page: import('@playwright/test').Page, mode: 'open' | 'error') => {
  await page.addInitScript(({ mode }) => {
    class FakeEventSource {
      url: string;
      withCredentials: boolean;
      listeners: Record<string, ((event: Event) => void)[]> = {};
      constructor(url: string, options: { withCredentials?: boolean } = {}) {
        this.url = url;
        this.withCredentials = Boolean(options.withCredentials);
        globalThis.setTimeout(() => {
          const eventType = mode === 'open' ? 'open' : 'error';
          this.dispatch(eventType);
        }, 10);
      }
      addEventListener(type: string, callback: (event: Event) => void) {
        this.listeners[type] = this.listeners[type] ?? [];
        this.listeners[type].push(callback);
      }
      removeEventListener(type: string, callback: (event: Event) => void) {
        this.listeners[type] = (this.listeners[type] ?? []).filter((listener) => listener !== callback);
      }
      dispatch(type: string) {
        const event = new Event(type);
        for (const listener of this.listeners[type] ?? []) {
          listener(event);
        }
      }
      close() {
        // no-op
      }
    }
    // @ts-expect-error - override for e2e
    globalThis.EventSource = FakeEventSource;
  }, { mode });
};

test.describe('Ledger live updates', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    await setupApiMocks(
      page,
      async (p, route) => {
        if (p.startsWith('/api/jobs/events')) {
          await route.abort('blockedbyclient');
          return true;
        }
        if (p === '/api/auth/me') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ user: { id: 'u1', email: 't@e.com', role: 'user', isActive: true } }),
          });
          return true;
        }
        if (p === '/api/auth/refresh') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              user: { id: 'u1', email: 't@e.com', role: 'user', isActive: true },
              accessToken: 'e2e-access-token',
              refreshToken: 'e2e-refresh-token',
              expiresIn: 3600,
            }),
          });
          return true;
        }
        if (p === '/api/config/job-options') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              presets: ['b1-default'],
              voiceAccents: [],
              voices: [],
              notionDatabases: [{ id: 'default-b1', name: 'B1 Lessons' }],
              ttsStrategies: ['auto'],
            }),
          });
          return true;
        }
        if (p === '/api/config/students') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ students: [{ id: 's1', name: 'Alice Smith' }] }),
          });
          return true;
        }
        if (p === '/api/recordings') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ items: [], limit: 50, offset: 0, total: 0, order: 'desc' }),
          });
          return true;
        }
        if (p === '/api/user/jobs/summary') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              total: 1,
              byState: { queued: 0, running: 1, awaiting_approval: 0, succeeded: 0, failed: 0 },
              pendingApprovals: 0,
              last7Days: { total: 1, succeeded: 0, failed: 0 },
              tts: { enabled: 1, succeeded: 0 },
            }),
          });
          return true;
        }
        if (p === '/api/user/jobs') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              jobs: [buildJob({ jobId: 'j1', state: 'running' })],
              total: 1,
              limit: 50,
              offset: 0,
            }),
          });
          return true;
        }
        if (p.startsWith('/api/jobs/')) {
          const jobId = p.split('/').pop() ?? 'j1';
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ ...buildJob({ jobId, state: 'running' }) }),
          });
          return true;
        }
        if (p === '/api/students/summary') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ items: [], total: 0, limit: 5, offset: 0 }),
          });
          return true;
        }
        return false;
      },
      { includeAuth: true, testInfo },
    );
  });

  test('shows live status when SSE connects', async ({ page }) => {
    await injectSseMock(page, 'open');
    await page.goto('/');
    await expect(page.locator('.ledger-status')).toHaveText(/Live/, { timeout: 10000 });
  });

  test('falls back to polling when SSE fails', async ({ page }) => {
    await injectSseMock(page, 'error');
    await page.goto('/');
    await expect(page.locator('.ledger-status')).toHaveText(/Polling fallback/, { timeout: 15000 });
  });
});
