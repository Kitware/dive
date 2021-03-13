/* eslint-disable no-irregular-whitespace */
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

  describe('Track Details and Attributes', () => {
    it('Generatomg Track Attributes', async () => {
      await login({ page });
      await page.click('text=Public');
      // assert.equal(page.url(), 'http://localhost:8080/#/folder/6046d09ca7e8106ce7a94483');
      // Click text=Launch Annotator
      await page.click('text=Launch Annotator');
      // assert.equal(page.url(), 'http://localhost:8080/#/viewer/6046d0a1a7e8106ce7a94485');

      await page.waitForSelector('.loadingSpinnerContainer', { state: 'attached' });

      // Wait for the elements to stop loading
      await page.waitForSelector('.loadingSpinner', { state: 'detached' });

      // Screenshot - Path: ./test/screenshots/track_details/swapIcon.png
      const _test_screenshots_track_details_swapIcon = await page.$('.swap-button');
      if (_test_screenshots_track_details_swapIcon) {
        await _test_screenshots_track_details_swapIcon.screenshot({
          path: './test/screenshots/track_details/swapIcon.png',
        });
      }
      await page.mouse.move(663, 347, { steps: 5 });
      await page.mouse.click(667, 347);
      await page.mouse.move(273, 140, { steps: 20 });

      await page.waitForTimeout(3000);
      await await page.screenshot({
        clip: {
          x: 0, y: 115, width: 496, height: 473,
        },
        path: './test/screenshots/track_details/goingToDetails.png',
      });
      await page.click('.swap-button');


      //SETUP FOR ATTRIBUTES
      /*
        TODO: After load csv attributes lands this can probably be removed
        although we want the creation of new attributes
      */
      // Click button:has-text("Attribute")
      await page.click('button:has-text("Attribute")');
      // Click text=NameDatatypeText​Predefined values >> input[type="text"]
      await page.click('text=NameDatatypeText​Predefined values >> input[type="text"]');
      // Fill text=NameDatatypeText​Predefined values >> input[type="text"]
      await page.fill('text=NameDatatypeText​Predefined values >> input[type="text"]', 'CompleteTrack');
      // Click div[role="button"]:has-text("DatatypeText")
      await page.click('div[role="button"]:has-text("DatatypeText")');
      // Click text=Boolean
      await page.click('text=Boolean');
      // Click button:has-text("Save")
      await page.click('button:has-text("Save")');
      // Click text=Detection Attributes: Attribute >> button
      await page.click('text=Detection Attributes: Attribute >> button');
      // Click text=NameDatatypeText​Predefined values >> input[type="text"]
      await page.click('text=NameDatatypeText​Predefined values >> input[type="text"]');
      // Fill text=NameDatatypeText​Predefined values >> input[type="text"]
      await page.fill('text=NameDatatypeText​Predefined values >> input[type="text"]', 'swimming');
      // Click div[role="button"]:has-text("DatatypeText")
      await page.click('div[role="button"]:has-text("DatatypeText")');
      // Click div[role="option"] div:has-text("Boolean")
      await page.click('div[role="option"] div:has-text("Boolean")');
      // Click button:has-text("Save")
      await page.click('button:has-text("Save")');
      // Click button:has-text("Attribute")
      await page.click('button:has-text("Attribute")');
      // Click text=NameDatatypeText​Predefined values >> input[type="text"]
      await page.click('text=NameDatatypeText​Predefined values >> input[type="text"]');
      // Fill text=NameDatatypeText​Predefined values >> input[type="text"]
      await page.fill('text=NameDatatypeText​Predefined values >> input[type="text"]', 'fishLength');
      // Click div[role="button"]:has-text("DatatypeText")
      await page.click('div[role="button"]:has-text("DatatypeText")');
      // Click #list-item-523-1 div:has-text("Number")
      await page.click('text=Number');
      // Click button:has-text("Save")
      await page.click('button:has-text("Save")');
      // Click text=Detection Attributes: Attribute >> button
      await page.click('text=Detection Attributes: Attribute >> button');
      // Click text=NameDatatypeText​Predefined values >> input[type="text"]
      await page.click('text=NameDatatypeText​Predefined values >> input[type="text"]');
      // Fill text=NameDatatypeText​Predefined values >> input[type="text"]
      await page.fill('text=NameDatatypeText​Predefined values >> input[type="text"]', 'eating');
      // Click div[role="button"]:has-text("DatatypeText")
      await page.click('div[role="button"]:has-text("DatatypeText")');
      // Click text=Boolean
      await page.click('text=Boolean');
      // Click button:has-text("Save")
      await page.click('button:has-text("Save")');

      // Click text=CompleteTrack: true false >> :nth-match(div, 3)
      await page.click('text=CompleteTrack: true false >> :nth-match(div, 3)');
      // Select true
      await page.selectOption('select', 'true');
      // Click input[type="number"]
      await page.click('input[type="number"]');
      // Fill input[type="number"]
      await page.fill('input[type="number"]', '20');
      // Select true
      await page.selectOption('text=swimming: true false >> select', 'true');
      // Click .px-4 .row div:nth-child(2) button:nth-child(3)
      await page.click('.px-4 .row div:nth-child(2) button:nth-child(3)');
      // Select false
      await page.selectOption('text=swimming: true false >> select', 'false');
      // Click .px-4 .row div:nth-child(2) button
      await page.click('.px-4 .row div:nth-child(2) button');

      // Screenshot - Path: ./test/screenshots/track_details/trackDetailsFull.png
      const _test_screenshots_track_details_trackDetailsFul = await page.$('text=Track Editor seriola pristipomoides_auricilla etelis_carbunculus 1 Confidence Pa');
      if (_test_screenshots_track_details_trackDetailsFul) {
        await _test_screenshots_track_details_trackDetailsFul.screenshot({
          path: './test/screenshots/track_details/trackDetailsFull.png',
        });
      }
      // Screenshot - Path: ./test/screenshots/track_details/eyeIcon.png
      const _test_screenshots_track_details_eyeIcon = await page.$('text=Track Attributes: Attribute >> :nth-match(button, 2)');
      if (_test_screenshots_track_details_eyeIcon) {
        await _test_screenshots_track_details_eyeIcon.screenshot({
          path: './test/screenshots/track_details/eyeIcon.png',
        });
      }
      // Screenshot - Path: ./test/screenshots/track_details/settingsIcon.png
      const _test_screenshots_track_details_settingsIcon = await page.$('text=CompleteTrack: true false >> button');
      if (_test_screenshots_track_details_settingsIcon) {
        await _test_screenshots_track_details_settingsIcon.screenshot({
          path: './test/screenshots/track_details/settingsIcon.png',
        });
      }

      // Screenshot - Path: ./test/screenshots/track_details/AttributeButton.png
      const _test_screenshots_track_details_AttributeButton = await page.$('button:has-text("Attribute")');
      if (_test_screenshots_track_details_AttributeButton) {
        await _test_screenshots_track_details_AttributeButton.screenshot({
          path: './test/screenshots/track_details/AttributeButton.png',
        });
      }
      await page.click('button:has-text("Attribute")');

      const _test_screenshots_track_details_newAttribute = await page.$('text=Attributes NameDatatypeText​Predefined values Delete Cancel Save');
      if (_test_screenshots_track_details_newAttribute) {
        await _test_screenshots_track_details_newAttribute.screenshot({
          path: './test/screenshots/track_details/newAttribute.png',
        });
      }

      // Click button:has-text("Cancel")
      await page.click('button:has-text("Cancel")');
      // Click text=CompleteTrack: true false >> button
      await page.click('text=CompleteTrack: true false >> button');
      // Screenshot - Path: ./test/screenshots/track_details/editAttribute.png
      const _test_screenshots_track_details_editAttribute = await page.$('text=Attributes Changes to Attribute Datatypes or Names do not effect currently set a');
      if (_test_screenshots_track_details_editAttribute) {
        await _test_screenshots_track_details_editAttribute.screenshot({
          path: './test/screenshots/track_details/editAttribute.png',
        });
      }
    }, 220000);
  });
}
