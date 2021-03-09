import {
  chromium, Browser, Page,
} from 'playwright';
import login from '../utils/utils';

export default function runUploadingTests() {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ slowMo: 100, headless: false });
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
  describe('uploading Data to the system', () => {
    it('uploading Data', async () => {
      await login({ page });
      await page.click('text=Public');
      // Click button:has-text("Upload")
      await page.click('button:has-text("Upload")');
      //Upload the data
      const fileArr = [];
      for (let i = 0; i < 14; i += 1) {
        fileArr.push(`./test/data/${i + 1}.jpg`);
      }
      fileArr.push('./test/data/viame.csv');
      await page.setInputFiles('input[type="file"]', fileArr);

      await page.fill('text=Create SubfoldersEnabled when many videos are being uploadedFolder NameFPS >> input[type="text"]', 'testData');

      // Click button:has-text("Start Upload")
      await page.click('button:has-text("Start Upload")');

      await page.waitForSelector('text=testData Launch Annotator');

      await page.click('text=Launch Annotator');

      await page.waitForSelector('.loadingSpinnerContainer', { state: 'attached' });

      // Wait for the elements to stop loading
      await page.waitForSelector('.loadingSpinner', { state: 'detached' });

      await page.click('button:has-text("Track")');

      await page.waitForSelector('span:has-text("Editing").primary');

      await page.mouse.move(300, 300, { steps: 20 });

      await page.mouse.down({ button: 'left' });

      await page.mouse.move(400, 400, { steps: 20 });

      await page.mouse.up({ button: 'left' });
    }, 120000);
  });
}
