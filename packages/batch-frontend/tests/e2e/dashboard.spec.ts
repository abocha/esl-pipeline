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

test.describe('Dashboard', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        await setupApiMocks(page, async (p, route) => {
            if (p.startsWith('/api/jobs/events')) {
                await route.abort('blockedbyclient');
                return true;
            }
            if (p === '/api/auth/me') {
                await route.fulfill({ status: 200, body: JSON.stringify({ user: { id: 'u1', email: 't@e.com', role: 'user', isActive: true } }) });
                return true;
            }
            if (p === '/api/auth/refresh') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        user: { id: 'u1', email: 't@e.com', role: 'user', isActive: true },
                        accessToken: 'e2e-access-token',
                        refreshToken: 'e2e-refresh-token',
                        expiresIn: 3600
                    })
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
                        ttsStrategies: ['auto']
                    })
                });
                return true;
            }
            if (p === '/api/config/students') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({ students: [{ id: 's1', name: 'Alice Smith' }] })
                });
                return true;
            }
            if (p === '/api/recordings') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({ items: [], limit: 50, offset: 0, total: 0, order: 'desc' })
                });
                return true;
            }
            if (p === '/api/user/jobs/summary') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        total: 6,
                        byState: { queued: 0, running: 1, awaiting_approval: 1, succeeded: 4, failed: 0 },
                        pendingApprovals: 1,
                        last7Days: { total: 6, succeeded: 4, failed: 0 },
                        tts: { enabled: 6, succeeded: 4 }
                    })
                });
                return true;
            }
            if (p === '/api/user/jobs') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        jobs: [
                            buildJob({ jobId: 'j1', state: 'succeeded', md: '/uploads/l1.md' }),
                            buildJob({ jobId: 'j2', state: 'running', md: '/uploads/l2.md' }),
                            buildJob({ jobId: 'j3', state: 'awaiting_approval', md: '/uploads/l3.md' })
                        ],
                        total: 3,
                        limit: 50,
                        offset: 0
                    })
                });
                return true;
            }
            if (p.startsWith('/api/jobs/')) {
                const jobId = p.split('/').pop() ?? 'j1';
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        ...buildJob({
                            jobId,
                            state: jobId === 'j2' ? 'running' : jobId === 'j3' ? 'awaiting_approval' : 'succeeded',
                        }),
                    })
                });
                return true;
            }
            if (p === '/api/students/summary') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        items: [
                            { id: 's1', name: 'Alice', lastLessonAt: new Date().toISOString(), pendingDrafts: 1 }
                        ],
                        total: 10,
                        limit: 5,
                        offset: 0
                    })
                });
                return true;
            }

            return false;
        }, { includeAuth: true, testInfo });
    });

    test('should render dashboard layout', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByText('Your ESL command center')).toBeVisible({ timeout: 15000 });
    });

    test('should display activity feed with job count', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.feed-count')).toContainText('3 jobs', { timeout: 20000 });
    });

    test('should navigate to wizard', async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('.feed-count')).toContainText('3 jobs', { timeout: 20000 });
        await page.getByRole('link', { name: 'Wizard', exact: true }).click();
        await expect(page).toHaveURL(/\/wizard/);
    });
});
