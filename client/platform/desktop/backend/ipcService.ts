import OS from 'os';

import { ipcMain } from 'electron';

import { DesktopJobUpdate, RunPipeline, Settings } from 'platform/desktop/constants';

import server from './server';
import linux from './platforms/linux';
import win32 from './platforms/windows';
import common from './platforms/common';
import settings from './state/settings';

// defaults to linux if win32 doesn't exist
const currentPlatform = OS.platform() === 'win32' ? win32 : linux;
if (OS.platform() === 'win32') {
  win32.initialize();
}

export default function register() {
  /**
   * Platform-agnostic methods
   */
  ipcMain.handle('server-info', async () => server.address());
  ipcMain.handle('get-pipeline-list', async () => {
    const ret = await common.getPipelineList(settings.get());
    return ret;
  });
  ipcMain.handle('open-link-in-browser', (_, url: string) => {
    common.openLink(url);
  });
  ipcMain.on('update-settings', async (_, s: Settings) => {
    settings.set(s);
  });
  ipcMain.handle('import-media', async (_, path: string) => {
    const ret = await common.importMedia(settings.get(), path);
    return ret;
  });

  /**
   * Platform-dependent methods
   */

  ipcMain.handle('nvidia-smi', async () => {
    const ret = await currentPlatform.nvidiaSmi();
    return ret;
  });
  ipcMain.handle('default-settings', async () => {
    const defaults = currentPlatform.DefaultSettings;
    return defaults;
  });
  ipcMain.handle('validate-settings', async (_, s: Settings) => {
    const ret = await currentPlatform.validateViamePath(s);
    return ret;
  });
  ipcMain.handle('run-pipeline', async (event, args: RunPipeline) => {
    const updater = (update: DesktopJobUpdate) => {
      event.sender.send('job-update', update);
    };
    return currentPlatform.runPipeline(settings.get(), args, updater);
  });
}
