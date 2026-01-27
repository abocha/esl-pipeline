import { test, expect } from '@playwright/test';
import { setupApiMocks } from './mocks';

const emptySummary = {
    total: 0,
    byState: { queued: 0, running: 0, awaiting_approval: 0, succeeded: 0, failed: 0 },
    pendingApprovals: 0,
    last7Days: { total: 0, succeeded: 0, failed: 0 },
    tts: { enabled: 0, succeeded: 0 },
};

test.describe('Authentication', () => {
    test.beforeEach(async ({ page }, testInfo) => {
        await page.route('**/auth/refresh', route => route.fulfill({ status: 401 }));

        await setupApiMocks(page, async (p, route) => {
            if (p.startsWith('/api/jobs/events')) {
                await route.abort('blockedbyclient');
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
            if (p === '/api/recordings') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({ items: [], limit: 50, offset: 0, total: 0, order: 'desc' })
                });
                return true;
            }
            if (p === '/api/user/jobs') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({ jobs: [], total: 0, limit: 50, offset: 0 })
                });
                return true;
            }
            if (p === '/api/user/jobs/summary') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify(emptySummary)
                });
                return true;
            }
            if (p === '/api/students/summary') {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 })
                });
                return true;
            }

            return false;
        }, { includeAuth: false, testInfo });
    });

    test('should show unauthenticated notice when not logged in', async ({ page }) => {
        await page.route('**/api/auth/me', route => route.fulfill({ status: 401 }));
        await page.goto('/');
        await expect(page.getByText(/Sign in to get started/i)).toBeVisible({ timeout: 15000 });
    });

    test('should login successfully', async ({ page }) => {
        await page.route('**/api/auth/me', route => route.fulfill({ status: 401 }));
        await page.route('**/api/auth/login', route => route.fulfill({
            status: 200,
            body: JSON.stringify({ user: { id: 'u1', email: 't@e.com' }, accessToken: 'tok' })
        }));

        await page.goto('/');
        await expect(page.getByText(/Sign in to get started/i)).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: 'Login to your account' }).click();

        await page.getByLabel('Email', { exact: true }).fill('tutor@example.com');
        await page.getByLabel('Password', { exact: true }).fill('password123');

        await page.unroute('**/api/auth/me');
        await page.route('**/api/auth/me', route => route.fulfill({
            status: 200,
            body: JSON.stringify({ user: { id: 'u1', email: 't@e.com', role: 'user', isActive: true } })
        }));

        await page.getByRole('button', { name: 'Sign in', exact: true }).click();

        await expect(page.getByText('Welcome back!').first()).toBeVisible({ timeout: 15000 });
        await expect(page.getByText('t@e.com').first()).toBeVisible({ timeout: 15000 });
    });
});
