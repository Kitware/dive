import { spawn } from 'child_process';
// eslint-disable-next-line import/no-extraneous-dependencies
import { ipcMain, shell } from 'electron';
// eslint-disable-next-line import/no-extraneous-dependencies
import { xml2json } from 'xml-js';
import { Settings } from '../store/settings';

import server from './server';
import linux from './platforms/linux';

// Based on https://github.com/chrisallenlane/node-nvidia-smi
async function nvidiaSmi(): Promise<unknown> {
  return new Promise((resolve) => {
    const smi = spawn('nvidia-smi', ['-q', '-x']);
    let result = '';
    smi.stdout.on('data', (chunk) => {
      result = result.concat(chunk.toString('utf-8'));
    });
    smi.on('close', (code) => {
      let jsonStr = 'null'; // parses to null
      if (code === 0) {
        jsonStr = xml2json(result, { compact: true });
      }
      resolve({
        output: JSON.parse(jsonStr),
        code,
        error: result,
      });
    });
    smi.on('error', (err) => {
      resolve({
        output: null,
        code: -1,
        error: err,
      });
    });
  });
}

async function openLink(url: string) {
  shell.openExternal(url);
}

export default function register() {
  ipcMain.handle('info', () => {
    const addr = server.address();
    return addr;
  });
  ipcMain.handle('nvidia-smi', async () => {
    const ret = await nvidiaSmi();
    return ret;
  });
  ipcMain.handle('open-link-in-browser', (_, url: string) => {
    openLink(url);
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
  ipcMain.handle('get-pipeline-list', async (_, settings: Settings) => {
    const ret = await linux.getPipelineList(settings);
    return ret;
  });
}
