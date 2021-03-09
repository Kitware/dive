/* eslint-disable @typescript-eslint/camelcase */
import {
  chromium, Browser, Page,
} from 'playwright';
import login from '../utils/utils';

export default function runTrackDetailsTest() {
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
      // assert.equal(page.url(), 'http://localhost:8080/#/folder/6046d09ca7e8106ce7a94483');
      // Click text=Launch Annotator
      await page.click('text=Launch Annotator');
      // assert.equal(page.url(), 'http://localhost:8080/#/viewer/6046d0a1a7e8106ce7a94485');

      await page.waitForSelector('.loadingSpinnerContainer', { state: 'attached' });

      // Wait for the elements to stop loading
      await page.waitForSelector('.loadingSpinner', { state: 'detached' });

      await page.click('button:has-text("Track")');

      await page.waitForSelector('span:has-text("Editing").primary');

      // Mouse-down at Position: 610,145
      await page.mouse.move(610, 145, { steps: 20 });
      await page.mouse.down();
      // Mouse-up at Position: 748,247
      await page.mouse.move(748, 247, { steps: 20 });
      await page.mouse.up();
      // Mouse-down at Position: 816,217
      await page.mouse.move(816, 217, { steps: 20 });
      await page.mouse.down();

      // Click .swap-button
      await page.click('.swap-button');
      const test_screenshots_track_details_track_details = await page.$('text=Track Editor seriola pristipomoides_auricilla etelis_carbunculus unknown 5 Confi');
      await test_screenshots_track_details_track_details?.screenshot({
        path: './test/screenshots/track_details/track_details.png',
      });

      await page.click('button:has-text("Attribute")');

      const test_screenshots_track_details_track_attributes_settings = await page.$('text=Attributes NameDatatypeText​Predefined values Delete Cancel Save');
      await test_screenshots_track_details_track_attributes_settings?.screenshot({
        path: './test/screenshots/track_details/track_attributes_settings.png',
      });

      // Click textarea
      await page.click('textarea');
      // Fill textarea
      await page.fill('textarea', 'value1');
      // Press Enter
      await page.press('textarea', 'Enter');
      // Fill textarea
      await page.fill('textarea', 'value1\nvalue2\nvalue3');
      // Press Enter
      await page.press('textarea', 'Enter');

      await page.click('button:has-text("Save")');

      // Click text=NewTrackAttribute: value1 value2 value3 >> input[type="text"]
      await page.click('text=NewTrackAttribute: value1 value2 value3 >> input[type="text"]');
      // Fill text=NewTrackAttribute: value1 value2 value3 >> input[type="text"]
      await page.fill('text=NewTrackAttribute: value1 value2 value3 >> input[type="text"]', 'value1');

      await page.click('text=NewTrackAttribute: value1 value2 value3 >> button');
      // Screenshot - Path: ./test/screenshots/track_details/track_attributes_settings_edit.png
      const test_screenshots_track_details_track_attributes_settings_edit = await page.$('text=Attributes Changes to Attribute Datatypes or Names do not effect currently set a');
      await test_screenshots_track_details_track_attributes_settings_edit?.screenshot({
        path: './test/screenshots/track_details/track_attributes_settings_edit.png',
      });

      await page.click('button:has-text("Cancel")');

      // Click button:has-text("Attribute")
      await page.click('button:has-text("Attribute")');
      await page.click('text=NameDatatypeText​Predefined values >> input[type="text"]');
      await page.fill('text=NameDatatypeText​Predefined values >> input[type="text"]', 'BooleanAttribute');
      // Click div[role="button"]:has-text("DatatypeText")
      await page.click('div[role="button"]:has-text("DatatypeText")');
      // Click div[role="option"] div:has-text("Boolean")
      await page.click('div[role="option"] div:has-text("Boolean")');
      // Click button:has-text("Save")
      await page.click('button:has-text("Save")');

      // Click button:has-text("Attribute")
      await page.click('button:has-text("Attribute")');
      await page.click('text=NameDatatypeText​Predefined values >> input[type="text"]');
      await page.click('text=NameDatatypeText​Predefined values >> input[type="text"]');
      await page.fill('text=NameDatatypeText​Predefined values >> input[type="text"]', 'NumberAttribute');
      // Click div[role="button"]:has-text("DatatypeText")
      await page.click('div[role="button"]:has-text("DatatypeText")');
      // Click text=Number
      await page.click('text=Number');
      // Click button:has-text("Save")
      await page.click('button:has-text("Save")');

      // Select false
      await page.selectOption('select', 'false');
      // Click input[type="number"]
      await page.click('input[type="number"]');
      // Fill input[type="number"]
      await page.fill('input[type="number"]', '2345');

      // Click text=Detection Attributes: Attribute >> button
      await page.click('text=Detection Attributes: Attribute >> button');
      // Click div[role="button"]:has-text("DatatypeText")
      await page.click('div[role="button"]:has-text("DatatypeText")');
      // Click #list-item-557-1 div:has-text("Number")
      await page.click('div[role="option"]  div:has-text("Number")');
      // Click button:has-text("Save")
      await page.click('button:has-text("Save")');
      // Click text=Detection Attributes: Attribute Frame: 0 NewDetectionAttribute: >> input[type="number"]
      await page.click('text=Detection Attributes: Attribute Frame: 0 NewDetectionAttribute: >> input[type="number"]');
      // Fill text=Detection Attributes: Attribute Frame: 0 NewDetectionAttribute: >> input[type="number"]
      await page.fill('text=Detection Attributes: Attribute Frame: 0 NewDetectionAttribute: >> input[type="number"]', '32432');
      // Click text=Track Editor seriola pristipomoides_auricilla etelis_carbunculus unknown 5 Confi
      await page.click('text=Track Editor seriola pristipomoides_auricilla etelis_carbunculus unknown 5 Confi');
      // Click text=NewTrackAttribute: value1 value2 value3 >> button
      await page.click('text=NewTrackAttribute: value1 value2 value3 >> button');
      // Click button:has-text("Delete")
      await page.click('button:has-text("Delete")');
      // Click button:has-text("Confirm")
      await page.click('button:has-text("Confirm")');
      await page.pause();
    }, 120000);
  });
}
