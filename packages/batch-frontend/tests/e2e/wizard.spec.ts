import { test, expect } from '@playwright/test';

const nowIso = () => new Date().toISOString();

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
    createdAt: nowIso(),
    updatedAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
    ...overrides,
});

const buildRecording = (overrides: Record<string, unknown>) => ({
    recordingId: 'r1',
    status: 'ingested',
    transcriptId: null,
    error: null,
    source: 'upload',
    studentId: 's1',
    displayName: 'Test recording',
    durationSec: 120,
    channels: 1,
    bytes: 1024,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
});

const buildTranscript = (overrides: Record<string, unknown>) => ({
    recordingId: 'r1',
    transcriptId: 't1',
    text: 'Transcript Text',
    summaryJson: null,
    model: 'test-model',
    language: 'en',
    mode: 'stack',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
});

const buildPromptPackage = (overrides: Record<string, unknown>) => ({
    id: 'pp1',
    recordingId: 'r1',
    transcriptId: 't1',
    studentId: 's1',
    profilePath: null,
    templateVersion: 't1',
    notes: null,
    storageUri: 'memory://prompt',
    text: 'Prompt Text',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
});

const buildDraft = (overrides: Record<string, unknown>) => ({
    id: 'd1',
    promptPackageId: 'pp1',
    studentId: 's1',
    storageUri: 'memory://draft',
    createdBy: 'u1',
    text: 'Draft Text',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...overrides,
});

test.describe('Assignment Wizard', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/jobs/events*', route => route.abort('blockedbyclient'));

        await page.route(
            url => url.pathname.startsWith('/api/')
                || url.pathname.startsWith('/auth')
                || url.pathname.startsWith('/config')
                || url.pathname.startsWith('/jobs')
                || url.pathname.startsWith('/recordings')
                || url.pathname.startsWith('/students')
                || url.pathname.startsWith('/user')
                || url.pathname.startsWith('/validation'),
            async (route) => {
            const reqUrl = new URL(route.request().url());
            const rawPath = reqUrl.pathname;
            const p = rawPath.startsWith('/api/') ? rawPath : `/api${rawPath}`;

            if (p.startsWith('/api/jobs/events')) {
                return route.abort('blockedbyclient');
            }
            if (p.includes('/auth/me')) return route.fulfill({ status: 200, body: JSON.stringify({ user: { id: 'u1', email: 't@e.com', role: 'user', isActive: true } }) });
            if (p === '/api/auth/refresh') {
                return route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        user: { id: 'u1', email: 't@e.com', role: 'user', isActive: true },
                        accessToken: 'e2e-access-token',
                        refreshToken: 'e2e-refresh-token',
                        expiresIn: 3600
                    })
                });
            }
            if (p === '/api/config/job-options') {
                return route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        presets: ['b1-default'],
                        voiceAccents: [],
                        voices: [],
                        notionDatabases: [{ id: 'default-b1', name: 'B1 Lessons' }],
                        ttsStrategies: ['auto']
                    })
                });
            }
            if (p === '/api/recordings') {
                return route.fulfill({
                    status: 200,
                    body: JSON.stringify({ items: [], limit: 50, offset: 0, total: 0, order: 'desc' })
                });
            }
            if (p === '/api/user/jobs') {
                return route.fulfill({
                    status: 200,
                    body: JSON.stringify({ jobs: [], total: 0, limit: 50, offset: 0 })
                });
            }
            if (p === '/api/user/jobs/summary') {
                return route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        total: 0,
                        byState: { queued: 0, running: 0, awaiting_approval: 0, succeeded: 0, failed: 0 },
                        pendingApprovals: 0,
                        last7Days: { total: 0, succeeded: 0, failed: 0 },
                        tts: { enabled: 0, succeeded: 0 }
                    })
                });
            }
            if (p === '/api/students/summary') {
                return route.fulfill({
                    status: 200,
                    body: JSON.stringify({ items: [], total: 0, limit: 50, offset: 0 })
                });
            }
            if (p.includes('/config/students')) return route.fulfill({ status: 200, body: JSON.stringify({ students: [{ id: 's1', name: 'Alice Smith' }] }) });
            if (p.includes('/config/prompts')) {
                return route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        templates: [{ id: 't1', label: 'Default template' }],
                        profiles: [{ id: 'p1', label: 'General profile' }],
                        defaults: { templateId: 't1', profileId: 'p1' }
                    })
                });
            }
            if (p.includes('/recordings/') && p.endsWith('/audio')) {
                return route.fulfill({ status: 200, body: '' });
            }
            if (p.includes('/recordings/upload')) {
                return route.fulfill({ status: 200, body: JSON.stringify(buildRecording({})) });
            }
            if (p.includes('/transcript')) {
                return route.fulfill({ status: 200, body: JSON.stringify(buildTranscript({})) });
            }
            if (p.includes('/prompt-package')) {
                return route.fulfill({ status: 200, body: JSON.stringify(buildPromptPackage({})) });
            }
            if (p.includes('/materialize')) return route.fulfill({ status: 200, body: JSON.stringify({ draftId: 'd1', jobId: 'j1', mdPath: '/uploads/d1.md' }) });
            if (p.includes('/draft')) return route.fulfill({ status: 200, body: JSON.stringify(buildDraft({})) });
            if (p.includes('/approve')) return route.fulfill({ status: 200, body: JSON.stringify(buildJob({ jobId: 'j1', state: 'queued' })) });
            if (p.includes('/jobs/j1')) return route.fulfill({ status: 200, body: JSON.stringify(buildJob({ jobId: 'j1', state: 'queued' })) });
            if (p.includes('/validation/markdown')) {
                return route.fulfill({ status: 200, body: JSON.stringify({ ok: true, errors: [], warnings: [] }) });
            }

            throw new Error(`Unhandled API route in wizard e2e: ${p}`);
        });
    });

    test('should navigate through full wizard flow', async ({ page }) => {
        await page.goto('/wizard');

        await expect(page.getByRole('button', { name: /Alice Smith/i })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: /Alice Smith/i }).click();

        await page.waitForSelector('input[type="file"]');
        const buffer = Buffer.from('audio');
        await page.setInputFiles('input[type="file"]', { name: 'test.mp3', mimeType: 'audio/mpeg', buffer });

        await expect(page.getByText(/Recording ready/i)).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: 'Continue to transcript' }).click();

        await expect(page.getByRole('heading', { name: 'Review transcript' })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: 'Skip' }).click();

        await expect(page.getByRole('heading', { name: 'Add notes' })).toBeVisible({ timeout: 15000 });
        await page.locator('textarea').first().fill('Test notes');
        await page.getByRole('button', { name: 'Generate prompt' }).click();
        await expect(page.locator('.prompt-output')).toHaveValue('Prompt Text', { timeout: 15000 });
        await page.getByRole('button', { name: 'Continue to draft' }).click();

        await expect(page.getByRole('heading', { name: 'Review draft' })).toBeVisible({ timeout: 15000 });
        const editor = page.locator('.markdown-editor .cm-content');
        await editor.click();
        await page.keyboard.type(String.raw`# Draft\n\nTest content.`);
        await expect(page.getByRole('button', { name: 'Continue to publish' })).toBeEnabled({ timeout: 20000 });
        await page.getByRole('button', { name: 'Continue to publish' }).click();

        await expect(page.getByRole('heading', { name: 'Publish' })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: 'Publish job' }).click();

        await expect(page.getByText('Job approved').first()).toBeVisible({ timeout: 15000 });
    });
});
