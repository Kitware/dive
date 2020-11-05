// eslint-disable-next-line import/no-extraneous-dependencies
import { ipcMain } from 'electron';

import { DesktopJobUpdate, RunPipeline, Settings } from '../constants';

import server from './server';
import linux from './platforms/linux';
import common from './platforms/common';

export default function register() {
  ipcMain.handle('info', () => {
    const addr = server.address();
    return addr;
  });

  /**
   * Platform-agnostic methods
   */

  ipcMain.handle('nvidia-smi', async () => {
    const ret = await common.nvidiaSmi();
    return ret;
  });
  ipcMain.handle('get-pipeline-list', async (_, settings: Settings) => {
    const ret = await common.getPipelineList(settings);
    return ret;
  });
  ipcMain.handle('open-link-in-browser', (_, url: string) => {
    common.openLink(url);
  });

  /**
   * TODO: replace linux defaults with some kind of platform switching logic
   */

  ipcMain.handle('default-settings', async () => {
    const defaults = linux.DefaultSettings;
    return defaults;
  });
  ipcMain.handle('validate-settings', async (_, settings: Settings) => {
    const ret = await linux.validateViamePath(settings);
    return ret;
  });
  ipcMain.handle('run-pipeline', async (event, args: RunPipeline) => {
    const updater = (update: DesktopJobUpdate) => {
      event.sender.send('job-update', update);
    };
    return linux.runPipeline(args, updater);
  });
}
