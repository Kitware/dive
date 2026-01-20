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
import { closeChildById } from 'platform/desktop/backend/native/processManager';
import { updateJobFilesOnCancel } from 'platform/desktop/backend/native/utils';

import linux from './native/linux';
import win32 from './native/windows';
import * as common from './native/common';
import beginMultiCamImport from './native/multiCamImport';
import settings from './state/settings';
import { listen } from './server';
import {
  getSegmentationServiceManager,
  shutdownSegmentationService,
  SegmentationPredictRequest,
} from './native/segmentation';
import {
  getStereoServiceManager,
  shutdownStereoService,
  StereoCalibration,
  StereoSetFrameRequest,
  StereoTransferLineRequest,
  StereoTransferPointsRequest,
} from './native/stereo';

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

  ipcMain.handle('cancel-job', async (event, job: DesktopJob) => {
    event.sender.send('cancel-job', {
      ...job, exitCode: -1, endTime: new Date(), cancelledJob: true,
    });
    // Update manifest and log file if working directory is available
    if (job.workingDir) {
      await updateJobFilesOnCancel(job.workingDir);
    }
    closeChildById(job.pid);
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

  ipcMain.handle('get-last-calibration', async () => common.getLastCalibrationPath(settings.get()));

  ipcMain.handle('save-calibration', async (_, { path }: { path: string }) => {
    const savedPath = await common.saveLastCalibration(settings.get(), path);
    const updatedIds = await common.applyCalibrationToUncalibratedStereoDatasets(
      settings.get(),
      savedPath,
    );
    return { savedPath, updatedDatasetIds: updatedIds };
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

  /**
   * Interactive Segmentation Service
   */

  ipcMain.handle('segmentation-initialize', async () => {
    const segService = getSegmentationServiceManager();
    await segService.initialize(settings.get());
    return { success: true };
  });

  ipcMain.handle('segmentation-predict', async (_, args: SegmentationPredictRequest) => {
    const segService = getSegmentationServiceManager();

    // Auto-initialize if not ready
    if (!segService.isReady()) {
      await segService.initialize(settings.get());
    }

    const response = await segService.predict(args);
    return response;
  });

  ipcMain.handle('segmentation-set-image', async (_, imagePath: string) => {
    const segService = getSegmentationServiceManager();

    if (!segService.isReady()) {
      await segService.initialize(settings.get());
    }

    await segService.setImage(imagePath);
    return { success: true };
  });

  ipcMain.handle('segmentation-clear-image', async () => {
    const segService = getSegmentationServiceManager();

    if (segService.isReady()) {
      await segService.clearImage();
    }
    return { success: true };
  });

  ipcMain.handle('segmentation-shutdown', async () => {
    await shutdownSegmentationService();
    return { success: true };
  });

  ipcMain.handle('segmentation-is-ready', () => {
    const segService = getSegmentationServiceManager();
    return { ready: segService.isReady() };
  });

  ipcMain.handle('segmentation-text-query', async (_, args: {
    imagePath: string;
    text: string;
    boxThreshold?: number;
    maxDetections?: number;
    boxes?: [number, number, number, number][];
    points?: [number, number][];
    pointLabels?: number[];
  }) => {
    const segService = getSegmentationServiceManager();

    // Auto-initialize if not ready
    if (!segService.isReady()) {
      await segService.initialize(settings.get());
    }

    const response = await segService.textQuery(args);
    return response;
  });

  ipcMain.handle('segmentation-refine', async (_, args: {
    imagePath: string;
    detections: {
      box: [number, number, number, number];
      polygon?: [number, number][];
      score: number;
      label: string;
    }[];
    points?: [number, number][];
    pointLabels?: number[];
    refineMasks?: boolean;
  }) => {
    const segService = getSegmentationServiceManager();

    // Auto-initialize if not ready
    if (!segService.isReady()) {
      await segService.initialize(settings.get());
    }

    const response = await segService.refineDetections(args);
    return response;
  });

  /**
   * Interactive Stereo Service
   */

  ipcMain.handle('stereo-enable', async (event, args?: { calibration?: StereoCalibration }) => {
    const stereoService = getStereoServiceManager();

    // Set up event forwarding for disparity_ready notifications
    const onDisparityReady = (response: { left_path?: string; success: boolean }) => {
      // Send to the renderer that triggered the enable
      event.sender.send('stereo-disparity-ready', response);
    };
    const onDisparityError = (response: { error?: string }) => {
      event.sender.send('stereo-disparity-error', response);
    };

    // Remove old listeners and add new ones
    stereoService.removeAllListeners('disparity_ready');
    stereoService.removeAllListeners('disparity_error');
    stereoService.on('disparity_ready', onDisparityReady);
    stereoService.on('disparity_error', onDisparityError);

    const result = await stereoService.enable(settings.get(), args?.calibration);
    return result;
  });

  ipcMain.handle('stereo-disable', async () => {
    const stereoService = getStereoServiceManager();
    const result = await stereoService.disable();
    return result;
  });

  ipcMain.handle('stereo-set-frame', async (_, args: StereoSetFrameRequest) => {
    const stereoService = getStereoServiceManager();
    const response = await stereoService.setFrame(args);
    return response;
  });

  ipcMain.handle('stereo-get-status', async () => {
    const stereoService = getStereoServiceManager();
    const response = await stereoService.getStatus();
    return response;
  });

  ipcMain.handle('stereo-transfer-line', async (_, args: StereoTransferLineRequest) => {
    const stereoService = getStereoServiceManager();
    const response = await stereoService.transferLine(args);
    return response;
  });

  ipcMain.handle('stereo-transfer-points', async (_, args: StereoTransferPointsRequest) => {
    const stereoService = getStereoServiceManager();
    const response = await stereoService.transferPoints(args);
    return response;
  });

  ipcMain.handle('stereo-set-calibration', async (_, calibration: StereoCalibration) => {
    const stereoService = getStereoServiceManager();
    await stereoService.setCalibration(calibration);
    return { success: true };
  });

  ipcMain.handle('stereo-shutdown', async () => {
    await shutdownStereoService();
    return { success: true };
  });

  ipcMain.handle('stereo-is-enabled', () => {
    const stereoService = getStereoServiceManager();
    return { enabled: stereoService.isEnabled() };
  });
}
