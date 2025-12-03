import OS from 'os';
import http from 'http';
import { ipcMain } from 'electron';
import { MultiCamImportArgs } from 'dive-common/apispec';
import type { Pipe } from 'dive-common/apispec';
import {
  DesktopJobUpdate, RunPipeline, RunTraining, Settings, ExportDatasetArgs,
  DesktopMediaImportResponse,
  ExportTrainedPipeline,
  ConversionArgs,
  DesktopJob,
} from 'platform/desktop/constants';
import { convertMedia } from 'platform/desktop/backend/native/mediaJobs';

import linux from './native/linux';
import win32 from './native/windows';
import * as common from './native/common';
import beginMultiCamImport from './native/multiCamImport';
import settings from './state/settings';
import { listen } from './server';

// defaults to linux if win32 doesn't exist
const currentPlatform = OS.platform() === 'win32' ? win32 : linux;
if (OS.platform() === 'win32') {
  win32.initialize();
}

export default function register() {
  /**
   * Platform-agnostic methods
   */
  ipcMain.handle('server-info', async () => {
    const server = await new Promise<http.Server>((resolve) => listen(resolve));
    return server.address();
  });
  ipcMain.handle('get-pipeline-list', async () => {
    const ret = await common.getPipelineList(settings.get());
    return ret;
  });
  ipcMain.handle('delete-trained-pipeline', async (event, args: Pipe) => {
    const ret = await common.deleteTrainedPipeline(args);
    return ret;
  });
  ipcMain.handle('get-training-configs', async () => {
    const ret = await common.getTrainingConfigs(settings.get());
    return ret;
  });
  ipcMain.handle('open-link-in-browser', (_, url: string) => {
    common.openLink(url);
  });
  ipcMain.on('update-settings', async (_, s: Settings) => {
    settings.set(s);
  });
  ipcMain.handle('export-dataset', async (_, args: ExportDatasetArgs) => {
    const ret = await common.exportDataset(settings.get(), args);
    return ret;
  });

  ipcMain.handle('export-configuration', async (_, args: ExportDatasetArgs) => {
    const ret = await common.exportConfiguration(settings.get(), args);
    return ret;
  });

  ipcMain.handle('autodiscover-data', async () => {
    const ret = await common.autodiscoverData(settings.get());
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

  ipcMain.handle('bulk-import-media', async (event, { path }: { path: string }) => {
    const results = await common.bulkMediaImport(path);
    return results;
  });

  ipcMain.handle('import-media', async (event, { path }: { path: string }) => {
    const ret = await common.beginMediaImport(path);
    return ret;
  });

  ipcMain.handle('delete-dataset', async (event, { datasetId }: { datasetId: string }) => {
    const ret = await common.deleteDataset(settings.get(), datasetId);
    return ret;
  });

  ipcMain.handle('check-dataset', async (event, { datasetId }: { datasetId: string }) => {
    const ret = await common.checkDataset(settings.get(), datasetId);
    return ret;
  });

  ipcMain.handle('import-multicam-media', async (event, { args }:
    { args: MultiCamImportArgs }) => {
    const ret = await beginMultiCamImport(args);
    return ret;
  });

  ipcMain.handle('import-annotation', async (event, {
    id, path, additive, additivePrepend,
  }: { id: string; path: string; additive: boolean; additivePrepend: string }) => {
    const ret = await common.dataFileImport(settings.get(), id, path, additive, additivePrepend);
    if (ret.warnings.length) return ret.warnings;
    return ret;
  });

  ipcMain.handle('finalize-import', async (event, args: DesktopMediaImportResponse) => common.finalizeMediaImport(settings.get(), args));

  ipcMain.handle('convert', async (event, args: ConversionArgs) => {
    const updater = (update: DesktopJobUpdate) => {
      event.sender.send('job-update', update);
    };
    const currentSettings: Settings = settings.get();
    const job: DesktopJob = await convertMedia(
      currentSettings,
      args,
      updater,
      (jobKey, meta) => common.completeConversion(currentSettings, args.meta.id, jobKey, meta),
      (_jobKey, meta, errorMessage) => common.failConversion(
        currentSettings,
        args.meta.id,
        meta,
        errorMessage,
      ),
      true,
    );
    return job;
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
  ipcMain.handle('export-trained-pipeline', async (event, args: ExportTrainedPipeline) => {
    const updater = (update: DesktopJobUpdate) => {
      event.sender.send('job-update', update);
    };
    return currentPlatform.exportTrainedPipeline(settings.get(), args, updater);
  });
  ipcMain.handle('run-training', async (event, args: RunTraining) => {
    const updater = (update: DesktopJobUpdate) => {
      event.sender.send('job-update', update);
    };
    return currentPlatform.train(settings.get(), args, updater);
  });
}
