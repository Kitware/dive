import { test, expect } from '@playwright/test';

test.describe('Navigation layout', () => {
  test.skip(!process.env.VISUAL_TEST_AUTH, 'Requires authenticated Girder session');

  test('home browser matches baseline', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('home.png', { fullPage: true });
  });

  test('jobs page matches baseline', async ({ page }) => {
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('jobs.png', { fullPage: true });
  });
});
