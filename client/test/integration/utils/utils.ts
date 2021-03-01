import {
  Browser, Page,
} from 'playwright';


export default async function login({ browser, page }: { browser: Browser; page: Page }, { username, password } = { username: 'testaccount', password: 'testAccount' }) {
  await page.goto('http://localhost:8080/#/login');
  // Click input[type="text"]
  await page.click('input[type="text"]');
  // Fill input[type="text"]
  await page.fill('input[type="text"]', username);
  // Click input[type="password"]
  await page.click('input[type="password"]');
  // Fill input[type="password"]
  await page.fill('input[type="password"]', password);
  // Click button:has-text("Login")
  await page.click('button:has-text("Login")');
  //Confirm that the page loaded
  await page.waitForSelector('.girder-breadcrumb-component');
  const breadCrumb = await page.textContent('.girder-breadcrumb-component');
  await page.screenshot({ path: './test/integration/screenshots/userMainPage.jpg', fullPage: true });
  expect(breadCrumb).toContain('testaccount');
}
