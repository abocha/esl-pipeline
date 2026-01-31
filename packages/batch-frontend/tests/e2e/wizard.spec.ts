import { test, expect } from '@playwright/test';
import { setupApiMocks } from './mocks';

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
    test.beforeEach(async ({ page }, testInfo) => {
        page.on('dialog', async (dialog) => {
            await dialog.accept();
        });
        await setupApiMocks(page, async (p, route) => {
            if (p.startsWith('/api/jobs/events')) {
                await route.abort('blockedbyclient');
                return true;
            }
            if (p.includes('/auth/me')) {
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
                    body: JSON.stringify({
                        total: 0,
                        byState: { queued: 0, running: 0, awaiting_approval: 0, succeeded: 0, failed: 0 },
                        pendingApprovals: 0,
                        last7Days: { total: 0, succeeded: 0, failed: 0 },
                        tts: { enabled: 0, succeeded: 0 }
                    })
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
            if (p.includes('/config/students')) {
                await route.fulfill({ status: 200, body: JSON.stringify({ students: [{ id: 's1', name: 'Alice Smith' }] }) });
                return true;
            }
            if (p.includes('/config/prompts')) {
                await route.fulfill({
                    status: 200,
                    body: JSON.stringify({
                        templates: [{ id: 't1', label: 'Default template' }],
                        profiles: [{ id: 'p1', label: 'General profile' }],
                        defaults: { templateId: 't1', profileId: 'p1' }
                    })
                });
                return true;
            }
            if (p.includes('/recordings/') && p.endsWith('/audio')) {
                await route.fulfill({ status: 200, body: '' });
                return true;
            }
            if (p.includes('/recordings/upload')) {
                await route.fulfill({ status: 200, body: JSON.stringify(buildRecording({})) });
                return true;
            }
            if (p.includes('/transcript')) {
                await route.fulfill({ status: 200, body: JSON.stringify(buildTranscript({})) });
                return true;
            }
            if (p.includes('/prompt-package')) {
                await route.fulfill({ status: 200, body: JSON.stringify(buildPromptPackage({})) });
                return true;
            }
            if (p.includes('/materialize')) {
                await route.fulfill({ status: 200, body: JSON.stringify({ draftId: 'd1', jobId: 'j1', mdPath: '/uploads/d1.md' }) });
                return true;
            }
            if (p.includes('/draft')) {
                await route.fulfill({ status: 200, body: JSON.stringify(buildDraft({})) });
                return true;
            }
            if (p.includes('/approve')) {
                await route.fulfill({ status: 200, body: JSON.stringify(buildJob({ jobId: 'j1', state: 'queued' })) });
                return true;
            }
            if (p.includes('/jobs/j1')) {
                await route.fulfill({ status: 200, body: JSON.stringify(buildJob({ jobId: 'j1', state: 'queued' })) });
                return true;
            }
            if (p.includes('/validation/markdown')) {
                await route.fulfill({ status: 200, body: JSON.stringify({ ok: true, errors: [], warnings: [] }) });
                return true;
            }

            return false;
        }, { includeAuth: true, testInfo });
    });

    test('should navigate through full wizard flow', async ({ page }) => {
        await page.goto('/wizard');

        // Step 1: Select Student
        await expect(page.getByText('Automation')).toBeVisible();
        await expect(page.getByText('Auto-match student')).toBeVisible();
        // Verify toggle is present and unchecked by default
        const autoMatchToggle = page.locator('.automation-toggle input').first();
        await expect(autoMatchToggle).not.toBeChecked();
        await page.locator('.automation-toggle').click(); // Toggle on
        await expect(autoMatchToggle).toBeChecked();

        await expect(page.getByRole('button', { name: /Alice Smith/i })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: /Alice Smith/i }).click();

        await page.waitForSelector('input[type="file"]');
        const buffer = Buffer.from('audio');
        await page.setInputFiles('input[type="file"]', { name: 'test.mp3', mimeType: 'audio/mpeg', buffer });

        await expect(
            page.getByText(/Recording ready\. Continue to review the transcript\./i),
        ).toBeVisible({ timeout: 20000 });
        await page.getByRole('button', { name: 'Continue to transcript' }).click();

        // Step 2: Transcript (no automation toggle here)
        await expect(page.getByRole('heading', { name: 'Review transcript' })).toBeVisible({ timeout: 15000 });
        await page.getByRole('button', { name: 'Skip transcript (adds warning)' }).click();

        // Step 3: Add Notes
        await expect(page.getByRole('heading', { name: 'Add notes' })).toBeVisible({ timeout: 15000 });

        // Verify automation toggle
        await expect(page.getByText('Auto-suggest prompts')).toBeVisible();
        const autoSuggestToggle = page.locator('.automation-toggle input').first();
        await expect(autoSuggestToggle).not.toBeChecked();
        await page.locator('.automation-toggle').click(); // Toggle on
        await expect(autoSuggestToggle).toBeChecked();

        await page.locator('textarea').first().fill('Test notes');
        await page.getByRole('button', { name: 'Generate prompt', exact: true }).click();
        await expect(page.locator('.prompt-output')).toHaveValue('Prompt Text', { timeout: 15000 });
        await page.getByRole('button', { name: 'Continue to draft' }).click();

        // Step 4: Review Draft
        await expect(page.getByRole('heading', { name: 'Review draft' })).toBeVisible({ timeout: 15000 });

        // Verify automation toggle (should be disabled)
        await expect(page.getByRole('heading', { name: 'Auto-draft preview' })).toBeVisible();
        const autoDraftToggle = page.locator('.automation-toggle input').first();
        await expect(autoDraftToggle).toBeDisabled();
        await expect(page.getByText(/Auto-draft preview requires backend LLM generation support/i)).toBeVisible();

        const editor = page.locator('.markdown-editor .cm-content');
        await editor.click();
        await page.keyboard.type(String.raw`# Draft\n\nTest content.`);
        await expect(page.getByRole('button', { name: 'Continue to publish' })).toBeEnabled({ timeout: 20000 });
        await page.getByRole('button', { name: 'Continue to publish' }).click();

        // Step 5: Publish
        await expect(
            page.getByRole('heading', { name: 'Publish', exact: true }),
        ).toBeVisible({ timeout: 15000 });

        // Verify automation toggle (should be disabled)
        await expect(page.getByRole('heading', { name: 'Auto-publish' })).toBeVisible();
        const autoPublishToggle = page.locator('.automation-toggle input').first();
        await expect(autoPublishToggle).toBeDisabled();
        await expect(page.getByText(/Auto-publish requires backend support/i)).toBeVisible();

        await page.getByRole('button', { name: 'Publish job', exact: true }).click();

        await expect(page.getByText('Job approved').first()).toBeVisible({ timeout: 15000 });
    });
});
