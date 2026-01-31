import { test, expect } from '@playwright/test';
import { setupApiMocks } from './mocks';

const buildJob = (overrides: Record<string, unknown>) => ({
  jobId: 'job-1',
  md: '/uploads/lesson.md',
  recordingId: null,
  transcriptId: null,
  promptPackageId: null,
  draftId: null,
  preset: 'b1-default',
  withTts: true,
  voiceId: null,
  upload: 's3',
  voiceAccent: null,
  forceTts: null,
  notionDatabase: 'default-b1',
  ttsStrategy: 'auto',
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

test.describe('Jobs table', () => {
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
              supportedActions: [
                {
                  type: 'rerun_audio',
                  label: 'Rerun audio',
                  description: 'Regenerate audio',
                  implemented: false,
                },
                {
                  type: 'cancel',
                  label: 'Cancel job',
                  description: 'Cancel job',
                  implemented: false,
                },
                {
                  type: 'edit_metadata',
                  label: 'Edit metadata',
                  description: 'Edit metadata',
                  implemented: false,
                },
              ],
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
              total: 2,
              byState: { queued: 0, running: 1, awaiting_approval: 0, succeeded: 0, failed: 1 },
              pendingApprovals: 0,
              last7Days: { total: 2, succeeded: 0, failed: 1 },
              tts: { enabled: 2, succeeded: 0 },
            }),
          });
          return true;
        }
        if (p === '/api/user/jobs') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              jobs: [
                buildJob({
                  jobId: 'job-neutral',
                  state: 'running',
                }),
                buildJob({
                  jobId: 'job-staged',
                  state: 'running',
                  stages: {
                    validate: 'succeeded',
                    extract: 'running',
                    notion: 'pending',
                    tts: 'pending',
                    upload: 'pending',
                    attach: 'pending',
                  },
                }),
                buildJob({
                  jobId: 'job-error',
                  state: 'running',
                  error: 'Notion API error',
                }),
              ],
              total: 3,
              limit: 50,
              offset: 0,
            }),
          });
          return true;
        }
        if (p.startsWith('/api/jobs/')) {
          const jobId = p.split('/').pop() ?? 'job-neutral';
          const withError = jobId === 'job-error';
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              ...buildJob({ jobId }),
              ...(withError ? { error: 'Notion API error' } : {}),
            }),
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

  test('renders pipeline strip with neutral fallback and stages', async ({ page }) => {
    await page.goto('/jobs');

    const neutralRow = page.locator('tr', { hasText: 'job-neutral' });
    await expect(neutralRow.locator('.pipeline-strip')).toHaveClass(/pipeline-neutral/);

    const stagedRow = page.locator('tr', { hasText: 'job-staged' });
    await expect(stagedRow.locator('.pipeline-running')).toBeVisible();
  });

  test('expands error details with recommendation', async ({ page }) => {
    await page.goto('/jobs');
    const errorRow = page.locator('tr', { hasText: 'job-error' });
    await errorRow.getByRole('button', { name: 'View error' }).click();
    await expect(page.getByText('Notion API error')).toBeVisible();
    await expect(page.getByText(/recommended/i)).toBeVisible();
  });

  test('disables unsupported actions', async ({ page }) => {
    await page.goto('/jobs');
    const row = page.locator('tr', { hasText: 'job-neutral' });
    await expect(row.getByRole('button', { name: 'Rerun' })).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Edit' })).toBeDisabled();
  });
});
