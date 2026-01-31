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
  state: 'queued',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
  error: null,
  manifestPath: null,
  ...overrides,
});

test.describe('Shell layout', () => {
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
              byState: { queued: 1, running: 0, awaiting_approval: 0, succeeded: 0, failed: 0 },
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
              jobs: [buildJob({ jobId: 'j1', state: 'queued', md: '/uploads/l1.md' })],
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
            body: JSON.stringify({ ...buildJob({ jobId, state: 'queued' }) }),
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

  test('renders three-column shell on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.locator('.workshop-shell')).toHaveAttribute('data-viewport', 'desktop');
    await expect(page.locator('.left-rail')).toBeVisible();
    await expect(page.locator('.right-rail')).toBeVisible();
  });

  test('shows docked rail toggle on tablet', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await page.goto('/');
    await expect(page.locator('.workshop-shell')).toHaveAttribute('data-viewport', 'tablet');
    await expect(page.getByRole('button', { name: 'Pin' })).toBeVisible();
  });

  test('opens rail bottom sheet on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const shell = page.locator('.workshop-shell');
    await expect(shell).toHaveAttribute('data-viewport', 'mobile');
    await expect(shell).toHaveAttribute('data-rail-open', 'false');
    await page.getByRole('button', { name: 'Open context and ledger' }).click();
    await expect(shell).toHaveAttribute('data-rail-open', 'true');
  });
});
