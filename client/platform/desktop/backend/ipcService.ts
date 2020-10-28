// eslint-disable-next-line import/no-extraneous-dependencies
import { ipcMain } from 'electron';

import { Settings } from '../store/settings';
import server from './server';
import common from './platforms/common';

export default function register() {
  ipcMain.handle('info', () => {
    const addr = server.address();
    return addr;
  });

  /**
   * Platform-agnostic methods
   */

  ipcMain.handle('get-pipeline-list', async (_, settings: Settings) => {
    const ret = await common.getPipelineList(settings);
    return ret;
  });
  ipcMain.handle('open-link-in-browser', (_, url: string) => {
    common.openLink(url);
  });
}
