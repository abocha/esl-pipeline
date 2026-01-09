import { test, expect } from '@playwright/test';

test.describe('Real API smoke', () => {
  test.beforeAll(async ({ request }) => {
    try {
      const response = await request.get('http://localhost:8080/auth/me');
      const status = response.status();
      if (status !== 200 && status !== 401) {
        throw new Error(`Unexpected backend status: ${status}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(
        `Real API smoke requires the backend at http://localhost:8080. ${message}`,
      );
    }
  });

  test('shows unauthenticated notice', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Sign in to get started/i)).toBeVisible({ timeout: 15000 });
  });
});
