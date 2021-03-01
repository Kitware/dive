import { ElectronApplication, _electron } from 'playwright';

let app: ElectronApplication;
describe('Sanity checks', () => {
  beforeEach(async () => {
    // Before each test start Electron application.
    app = await _electron.launch({ args: ['platform/desktop/background.ts'] });
  });

  afterEach(async () => {
    // After each test close Electron application.
    await app.close();
  });

  it('window title', async () => {
    const page = await app.firstWindow();
    expect(await page.title()).toEqual('Hello World!');
  }, 12000);
});
