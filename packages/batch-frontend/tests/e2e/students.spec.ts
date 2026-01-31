import { expect, test } from '@playwright/test';
import { setupApiMocks } from './mocks';

const nowIso = () => new Date().toISOString();

const buildJob = (overrides: Record<string, unknown>) => ({
  jobId: 'job-1',
  md: '/uploads/lesson.md',
  recordingId: 'rec-1',
  transcriptId: 'trans-1',
  promptPackageId: 'pp-1',
  draftId: 'draft-1',
  preset: 'b1-default',
  withTts: true,
  voiceId: null,
  upload: 's3',
  voiceAccent: null,
  forceTts: null,
  notionDatabase: 'default-b1',
  ttsStrategy: 'auto',
  notionUrl: null,
  state: 'succeeded',
  createdAt: nowIso(),
  updatedAt: nowIso(),
  startedAt: nowIso(),
  finishedAt: nowIso(),
  error: null,
  manifestPath: null,
  ...overrides,
});

test.describe('Student hub', () => {
  test('navigates to detail view and opens job from timeline', async ({ page }, testInfo) => {
    let jobFetchSeen = false;

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
            body: JSON.stringify({
              user: { id: 'u1', email: 't@e.com', role: 'user', isActive: true },
            }),
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
              supportedActions: [],
            }),
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
        if (p === '/api/user/jobs') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ jobs: [], total: 0, limit: 50, offset: 0 }),
          });
          return true;
        }
        if (p === '/api/user/jobs/summary') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              total: 0,
              byState: { queued: 0, running: 0, awaiting_approval: 0, succeeded: 0, failed: 0 },
              pendingApprovals: 0,
              last7Days: { total: 0, succeeded: 0, failed: 0 },
              tts: { enabled: 0, succeeded: 0 },
            }),
          });
          return true;
        }
        if (p === '/api/students') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              items: [
                {
                  id: 'student-1',
                  student: 'Jordan Park',
                  dbId: 'db-1',
                  pageParentId: 'page-1',
                  colorPreset: 'b1-default',
                  accentPreference: 'neutral',
                  voices: {},
                  manifestPreset: 'b1-default',
                  profileId: 'profile.md',
                },
              ],
              total: 1,
              limit: 200,
              offset: 0,
              order: 'asc',
            }),
          });
          return true;
        }
        if (p === '/api/students/student-1') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              id: 'student-1',
              student: 'Jordan Park',
              dbId: 'db-1',
              pageParentId: 'page-1',
              colorPreset: 'b1-default',
              accentPreference: 'neutral',
              voices: {},
              manifestPreset: 'b1-default',
              profileId: 'profile.md',
            }),
          });
          return true;
        }
        if (p === '/api/students/student-1/timeline') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({
              items: [
                {
                  type: 'job_completed',
                  studentId: 'student-1',
                  recordingId: 'rec-1',
                  transcriptId: 'trans-1',
                  promptPackageId: 'pp-1',
                  draftId: 'draft-1',
                  jobId: 'job-1',
                  status: 'succeeded',
                  createdAt: nowIso(),
                  displayName: 'Lesson 12',
                },
              ],
              total: 1,
              limit: 20,
              offset: 0,
              order: 'desc',
            }),
          });
          return true;
        }
        if (p === '/api/profiles') {
          await route.fulfill({
            status: 200,
            body: JSON.stringify({ profiles: [{ id: 'profile.md', label: 'Default profile' }] }),
          });
          return true;
        }
        if (p === '/api/jobs/job-1') {
          jobFetchSeen = true;
          await route.fulfill({
            status: 200,
            body: JSON.stringify(buildJob({ jobId: 'job-1' })),
          });
          return true;
        }

        return false;
      },
      { includeAuth: true, testInfo },
    );

    await page.goto('/students');

    const studentButton = page.getByRole('button', { name: /Jordan Park/i });
    await expect(studentButton).toBeVisible();
    await studentButton.click();

    await expect(page.getByText(/ID student-1/i)).toBeVisible();
    await expect(
      page.locator('.timeline-list .timeline-type').filter({ hasText: 'Job completed' }),
    ).toBeVisible();

    await page.locator('.timeline-actions').getByRole('button', { name: 'Job', exact: true }).click();

    await expect.poll(() => jobFetchSeen).toBe(true);
  });
});
