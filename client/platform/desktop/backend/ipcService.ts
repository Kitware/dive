import OS from 'os';

import { ipcMain } from 'electron';
import { DesktopJobUpdate, RunPipeline, Settings } from '../constants';

import server from './server';
import linux from './platforms/linux';
import win32 from './platforms/windows';
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

  /**
   * Platform-dependent methods
   */

  // defaults to linux if win32 doesn't exist
  const currentPlatform = OS.platform() === 'win32' ? win32 : linux;
  if (OS.platform() === 'win32') {
    win32.initialize();
  }
  ipcMain.handle('nvidia-smi', async () => {
    const ret = await currentPlatform.nvidiaSmi();
    return ret;
  });

  ipcMain.handle('default-settings', async () => {
    const defaults = currentPlatform.DefaultSettings;
    return defaults;
  });
  ipcMain.handle('validate-settings', async (_, settings: Settings) => {
    const ret = await currentPlatform.validateViamePath(settings);
    return ret;
  });
  ipcMain.handle('run-pipeline', async (event, args: RunPipeline) => {
    const updater = (update: DesktopJobUpdate) => {
      event.sender.send('job-update', update);
    };
    return currentPlatform.runPipeline(args, updater);
  });
}
