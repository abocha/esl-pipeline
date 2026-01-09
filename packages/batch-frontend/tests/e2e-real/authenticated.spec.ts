import fs from 'node:fs/promises';
import path from 'node:path';

import { test, expect } from '@playwright/test';

import { createStudentProfile, deleteStudentProfile } from './helpers/api';
import { createAuthSession, type AuthSession } from './helpers/auth';

let session: AuthSession;

test.beforeAll(async ({ request }) => {
  session = await createAuthSession(request);
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  const unauthHeader = page.getByRole('heading', { name: 'Sign in to get started' });
  const dashboardHeading = page.getByText('Your ESL command center');

  await Promise.race([
    unauthHeader.waitFor({ state: 'visible', timeout: 10000 }),
    dashboardHeading.waitFor({ state: 'visible', timeout: 10000 }),
  ]);

  if (await unauthHeader.isVisible()) {
    await page.getByRole('button', { name: 'Login to your account' }).click();
    await page.getByLabel('Email', { exact: true }).fill(session.credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(session.credentials.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Welcome back!').first()).toBeVisible({ timeout: 15000 });
    await expect(dashboardHeading).toBeVisible({ timeout: 15000 });
  }
});

test.describe('Authenticated flows', () => {
  test('dashboard loads for authenticated user', async ({ page }) => {
    await expect(page.getByText('Your ESL command center')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(session.user.email)).toBeVisible({ timeout: 15000 });
  });

  test('wizard landing renders for authenticated user', async ({ page }) => {
    await page.goto('/wizard');
    await expect(page.getByRole('heading', { name: 'Build a new assignment' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('heading', { name: 'Select student and upload' })).toBeVisible({
      timeout: 15000,
    });
  });

  test('markdown validation accepts transcript fixture payload', async ({ request }) => {
    const transcriptPath = path.resolve(process.cwd(), '..', '..', 'fixtures', 'transcript.txt');
    const transcriptText = await fs.readFile(transcriptPath, 'utf8');
    const snippet = transcriptText.slice(0, 500);

    const backendUrl = process.env.BATCH_BACKEND_URL || 'http://localhost:8080';
    const response = await request.post(`${backendUrl}/validation/markdown`, {
      data: { text: snippet },
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
      },
    });

    expect(response.status()).toBe(200);
    const payload = await response.json();
    expect(typeof payload.ok).toBe('boolean');
    expect(Array.isArray(payload.errors)).toBe(true);
    expect(Array.isArray(payload.warnings)).toBe(true);
  });

  test('students page shows newly created student', async ({ page, request }) => {
    const studentName = `E2E Student ${Date.now()}`;
    const created = await createStudentProfile(request, session.accessToken, {
      student: studentName,
    });

    try {
      await page.goto('/students');
      await expect(page.getByText(studentName)).toBeVisible({ timeout: 15000 });
    } finally {
      await deleteStudentProfile(request, session.accessToken, created.id);
    }
  });
});
