import OS from 'os';

import { ipcMain } from 'electron';
import { DesktopJobUpdate, RunPipeline, Settings } from '../constants';

import linux from './platforms/linux';
import win32 from './platforms/windows';
import common from './platforms/common';

let settings: Settings;

function getSetting() {
  if (settings === undefined) {
    throw new Error('Settings has not been initialized!');
  } 
  return settings;
}

export default function register() {
  /**
   * Platform-agnostic methods
   */

  ipcMain.handle('get-pipeline-list', async () => {
    const ret = await common.getPipelineList(getSetting());
    return ret;
  });
  ipcMain.handle('open-link-in-browser', (_, url: string) => {
    common.openLink(url);
  });
  ipcMain.on('update-settings', async (_, s: Settings) => {
    settings = s;
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
  ipcMain.handle('validate-settings', async () => {
    const ret = await currentPlatform.validateViamePath(getSetting());
    return ret;
  });
  ipcMain.handle('import-media', async () => {

  });
  ipcMain.handle('run-pipeline', async (event, args: RunPipeline) => {
    const updater = (update: DesktopJobUpdate) => {
      event.sender.send('job-update', update);
    };
    return currentPlatform.runPipeline(getSetting(), args, updater);
  });
}
