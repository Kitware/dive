import {
  chromium, Browser, Page,
} from 'playwright';

import axios from 'axios';

export default function runRegistrationTests() {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser.close();
  });

  beforeEach(async () => {
    page = await browser.newPage();
  });
  afterEach(async () => {
    await page.close();
  });

  const adminName = 'admin';
  const adminPass = 'letmein';
  describe('Registration of TestAccount and test logging in', () => {
    it('Delete existing testAccount', async () => {
      const admin = await axios.get('http://localhost:8010/girder/api/v1/user/authentication', {
        auth: {
          username: adminName,
          password: adminPass,
        },
        withCredentials: true,
      });
      const girderToken = admin.data.authToken.token;
      const userList = await axios.get('http://localhost:8010/girder/api/v1/user?text=testAccount&limit=50&sort=lastName&sortdir=1', {
        headers: {
          'Girder-Token': girderToken,
        },
      });
      if (userList.data.length !== 0) {
        //We will delete the account
        await axios.delete(`http://localhost:8010/girder/api/v1/user/${userList.data[0]._id}`, {
          headers: {
            'Girder-Token': girderToken,
          },
        });
      }
    });
    it('Register a new user', async () => {
      await page.goto('http://localhost:8080/#/');
      // Go to http://localhost:8080/#/login
      await page.goto('http://localhost:8080/#/login');
      // Click div[role="tab"]:has-text("Register")
      await page.click('div[role="tab"]:has-text("Register")');
      // Click text=UsernameEmailFirst NameLast NamePasswordRetype password Register >> input[type="text"]
      await page.click('text=UsernameEmailFirst NameLast NamePasswordRetype password Register >> input[type="text"]');
      // Fill text=UsernameEmailFirst NameLast NamePasswordRetype password Register >> input[type="text"]
      await page.fill('text=UsernameEmailFirst NameLast NamePasswordRetype password Register >> input[type="text"]', 'testAccount');
      // Click input[type="email"]
      await page.click('input[type="email"]');
      // Fill input[type="email"]
      await page.fill('input[type="email"]', 'test@test.com');
      // Click #input-52
      await page.click('#input-52');
      // Fill #input-52
      await page.fill('#input-52', 'test');
      // Click #input-55
      await page.click('#input-55');
      // Fill #input-55
      await page.fill('#input-55', 'Account');
      // Click text=UsernameEmailFirst NameLast NamePasswordRetype password Register >> input[type="password"]
      await page.click('text=UsernameEmailFirst NameLast NamePasswordRetype password Register >> input[type="password"]');
      // Fill text=UsernameEmailFirst NameLast NamePasswordRetype password Register >> input[type="password"]
      await page.fill('text=UsernameEmailFirst NameLast NamePasswordRetype password Register >> input[type="password"]', 'testAccount');
      // Click #input-61
      await page.click('#input-61');
      // Fill #input-61
      await page.fill('#input-61', 'testAccount');
      // Click button:has-text("Register")
      await page.click('button:has-text("Register")');
      // Make sure we login and now have the default user
      await page.waitForSelector('.girder-breadcrumb-component');
      const breadCrumb = await page.textContent('.girder-breadcrumb-component');
      expect(breadCrumb).toContain('testaccount');
    });
  });
}
