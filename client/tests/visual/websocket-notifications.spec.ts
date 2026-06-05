import { test, expect } from '@playwright/test';

/**
 * Smoke test for Girder 5 WebSocket notification wiring.
 * Requires a running Girder 5 backend with Redis and an authenticated session.
 */
test.describe('WebSocket notifications', () => {
  test.skip(!process.env.VISUAL_TEST_AUTH, 'Requires authenticated Girder session and live API');

  test('notification bus connects after login', async ({ page }) => {
    await page.goto('/jobs');
    await page.waitForLoadState('networkidle');

    const wsConnected = await page.waitForEvent('websocket', {
      predicate: (ws) => ws.url().includes('/notifications/me'),
      timeout: 15000,
    }).then(() => true).catch(() => false);

    expect(wsConnected).toBe(true);
  });
});
