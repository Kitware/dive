import { test, expect } from '@playwright/test';

test.describe('Login page layout', () => {
  test('login screen matches baseline', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('login.png', { fullPage: true });
  });
});
