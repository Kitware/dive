import OS from 'os';
import http from 'http';
import fs from 'fs';
import path from 'path';
import {
  app, ipcMain, dialog, BrowserWindow,
} from 'electron';
import { MultiCamImportArgs } from 'dive-common/apispec';
import type { Pipe } from 'dive-common/apispec';
import {
  DesktopJobUpdate, RunPipeline, RunTraining, Settings, ExportDatasetArgs,
  ExportMulticamEverythingArgs,
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
import scanMultiCamBatch from './native/multiCollectImport';
import settings from './state/settings';
import { listen } from './server';
import {
  getInteractiveServiceManager,
} from './native/interactive';
import {
  SegmentationPredictRequest,
  SegmentationStereoSegmentRequest,
} from './native/segmentation';
import {
  StereoCalibration,
  StereoSetFrameRequest,
  StereoTransferLineRequest,
  StereoTransferPointsRequest,
  StereoMeasureLineRequest,
  StereoAggregateLengthsRequest,
} from './native/stereo';

// defaults to linux if win32 doesn't exist
const currentPlatform = OS.platform() === 'win32' ? win32 : linux;
let samWarningShown = false;

const SAM3_PIPELINE_CONFIGS = [
  'interactive_segmenter_sam3.conf',
  'interactive_sam3_segmenter.conf',
];

function isSam3Installed(viamePath: string): boolean {
  const pipelinesDir = path.join(viamePath, 'configs', 'pipelines');
  return SAM3_PIPELINE_CONFIGS.some((configName) => fs.existsSync(
    path.join(pipelinesDir, configName),
  ));
}
if (OS.platform() === 'win32') {
  win32.initialize();
}

function getDiveVersion() {
  const appPath = app.getAppPath();
  const packageCandidates = [
    path.resolve(appPath, 'package.json'),
    path.resolve(appPath, '..', 'package.json'),
    path.resolve(appPath, '..', '..', 'package.json'),
  ];
  const packageVersion = packageCandidates
    .map((packagePath) => {
      try {
        const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf8')) as { version?: string };
        return typeof parsed.version === 'string' && parsed.version.length > 0
          ? parsed.version
          : null;
      } catch {
        return null;
      }
    })
    .find((version) => version !== null);

  return packageVersion || process.env.npm_package_version || app.getVersion();
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
  ipcMain.handle('desktop:show-open-dialog', (event, options: Electron.OpenDialogOptions) => {
    // Parent the dialog to the requesting window so it opens in front of (and
    // modal to) DIVE instead of behind it (notably on Linux).
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
  });
  ipcMain.handle('desktop:show-save-dialog', (event, options: Electron.SaveDialogOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
  });
  ipcMain.handle('desktop:get-app-version', () => getDiveVersion());
  ipcMain.on('desktop:get-app-version-sync', (event) => {
    // Sync IPC reply: Electron sets the return value on the event object.
    // eslint-disable-next-line no-param-reassign -- ipcMain event.returnValue API
    event.returnValue = getDiveVersion();
  });
  ipcMain.handle('desktop:get-app-path', (_, name: Electron.Name) => app.getPath(name));
  ipcMain.handle('desktop:open-path', async (_, targetPath: string) => (
    common.openPathInFileManager(targetPath)
  ));
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

  ipcMain.handle('export-multicam-everything', async (_, args: ExportMulticamEverythingArgs) => {
    const ret = await common.exportMulticamEverything(settings.get(), args);
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

  ipcMain.handle('list-immediate-subfolders', async (event, { path }: { path: string }) => (
    common.listImmediateSubfolders(path)
  ));

  ipcMain.handle('list-parent-folder-cameras', async (
    event,
    { path, mediaType }: { path: string; mediaType: 'image-sequence' | 'video' },
  ) => common.listParentFolderCameras(path, mediaType));

  ipcMain.handle('resolve-multicam-camera-source-path', async (
    event,
    { path, mediaType }: { path: string; mediaType: 'image-sequence' | 'video' },
  ) => common.resolveMulticamCameraSourcePath(path, mediaType));

  ipcMain.handle('find-parent-folder-calibration-file', async (
    event,
    { path }: { path: string },
  ) => common.findParentFolderCalibrationFile(path));

  ipcMain.handle('find-parent-folder-transform-files', async (
    event,
    { path }: { path: string },
  ) => common.findParentFolderTransformFiles(path));

  ipcMain.handle('dataset-has-calibration-file', async (
    event,
    { datasetId }: { datasetId: string },
  ) => common.datasetHasCalibrationFile(settings.get(), datasetId));

  ipcMain.handle('delete-dataset', async (event, { datasetId }: { datasetId: string }) => {
    const ret = await common.deleteDataset(settings.get(), datasetId);
    return ret;
  });

  ipcMain.handle('check-dataset', async (event, { datasetId }: { datasetId: string }) => {
    const ret = await common.checkDataset(settings.get(), datasetId);
    return ret;
  });

  ipcMain.handle('load-detections', async (event, { datasetId }: { datasetId: string }) => {
    const ret = await common.loadDetections(settings.get(), datasetId);
    return ret;
  });

  ipcMain.handle('load-frame-metadata', async (
    event,
    { datasetId }: { datasetId: string },
  ) => common.loadFrameMetadata(settings.get(), datasetId));

  ipcMain.handle('import-multicam-media', async (event, { args }:
    { args: MultiCamImportArgs }) => {
    const ret = await beginMultiCamImport(args);
    return ret;
  });

  ipcMain.handle('scan-multicam-batch', async (event, { path: rootPath }: { path: string }) => {
    const ret = await scanMultiCamBatch(rootPath);
    return ret;
  });

  ipcMain.handle('import-annotation', async (event, {
    id, path, additive, additivePrepend,
  }: { id: string; path: string; additive: boolean; additivePrepend: string }) => {
    const ret = await common.dataFileImport(settings.get(), id, path, additive, additivePrepend);
    if (ret.warnings.length) return ret.warnings;
    return ret;
  });

  ipcMain.handle('import-frame-metadata', async (event, {
    id, path,
  }: { id: string; path: string }) => common.importFrameMetadataFile(settings.get(), id, path));

  ipcMain.handle('get-last-calibration', async () => common.getLastCalibrationPath(settings.get()));

  ipcMain.handle('save-calibration', async (_, { path: sourcePath }: { path: string }) => {
    const savedPath = await common.saveLastCalibration(settings.get(), sourcePath);
    const updatedIds = await common.applyCalibrationToUncalibratedStereoDatasets(
      settings.get(),
      savedPath,
      path.basename(sourcePath),
    );
    return { savedPath, updatedDatasetIds: updatedIds };
  });

  ipcMain.handle('import-calibration', async (_, { id, path }: { id: string; path: string }) => {
    const calibration = await common.setDatasetCalibration(settings.get(), id, path);
    return { calibration };
  });

  ipcMain.handle('export-calibration', async (_, { id, destPath }: { id: string; destPath: string }) => {
    const exportedPath = await common.exportDatasetCalibration(settings.get(), id, destPath);
    return { exportedPath };
  });

  ipcMain.handle('export-camera-registration', async (_, { id, destPath, camera }: { id: string; destPath: string; camera: string }) => {
    const exportedPath = await common.exportCameraRegistration(settings.get(), id, destPath, camera);
    return { exportedPath };
  });

  ipcMain.handle('import-camera-registration', async (_, { id, path: filePath, options }: {
    id: string;
    path: string;
    options?: { camera?: string };
  }) => common.importCameraRegistration(settings.get(), id, filePath, options));

  ipcMain.handle('get-dataset-calibration', async (_, { datasetId }: { datasetId: string }) => common.getDatasetCalibration(settings.get(), datasetId));

  ipcMain.handle('delete-calibration', async (_, { datasetId }: { datasetId: string }) => {
    await common.deleteDatasetCalibration(settings.get(), datasetId);
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
    const currentSettings = settings.get();
    const pipelinesDir = path.join(currentSettings.viamePath, 'configs', 'pipelines');
    const hasSam2 = fs.existsSync(path.join(pipelinesDir, 'interactive_segmenter_sam2.conf'));
    const hasSam3 = isSam3Installed(currentSettings.viamePath);
    const noSamInstalled = !hasSam2 && !hasSam3;

    // Show a one-time warning if neither SAM pack is installed,
    // but still proceed with initialization (VIAME has a default GrabCut fallback)
    const showWarning = noSamInstalled && !samWarningShown;
    if (showWarning) {
      samWarningShown = true;
    }

    const segService = getInteractiveServiceManager();
    await segService.initialize(currentSettings);
    return { success: true, noSamInstalled: showWarning };
  });

  // Start the interactive service process WITHOUT warming the point-
  // segmentation model. Used by the text-query dialog: text query loads its
  // own (often different/heavier) model lazily and must not force a
  // segmentation-model load.
  ipcMain.handle('segmentation-ensure-started', async () => {
    const segService = getInteractiveServiceManager();
    await segService.ensureStarted(settings.get());
    return { success: true };
  });

  ipcMain.handle('segmentation-predict', async (_, args: SegmentationPredictRequest) => {
    const segService = getInteractiveServiceManager();

    // Auto-initialize if not ready
    if (!segService.isSegmentationReady()) {
      await segService.initialize(settings.get());
    }

    const response = await segService.predict(args);
    return response;
  });

  ipcMain.handle('segmentation-stereo-segment', async (_, args: SegmentationStereoSegmentRequest) => {
    const segService = getInteractiveServiceManager();

    // Auto-initialize if not ready
    if (!segService.isSegmentationReady()) {
      await segService.initialize(settings.get());
    }

    const response = await segService.stereoSegment(args);
    return response;
  });

  ipcMain.handle('segmentation-set-image', async (_, imagePath: string) => {
    const segService = getInteractiveServiceManager();

    if (!segService.isSegmentationReady()) {
      await segService.initialize(settings.get());
    }

    await segService.setImage(imagePath);
    return { success: true };
  });

  ipcMain.handle('segmentation-clear-image', async () => {
    const segService = getInteractiveServiceManager();

    if (segService.isReady()) {
      await segService.clearImage();
    }
    return { success: true };
  });

  ipcMain.handle('segmentation-shutdown', async () => {
    const segService = getInteractiveServiceManager();
    return segService.shutdownSegmentation();
  });

  ipcMain.handle('segmentation-is-ready', () => {
    const segService = getInteractiveServiceManager();
    return { ready: segService.isSegmentationReady() };
  });

  ipcMain.handle('segmentation-sam3-installed', () => {
    const currentSettings = settings.get();
    return { installed: isSam3Installed(currentSettings.viamePath) };
  });

  ipcMain.handle('segmentation-text-query', async (_, args: {
    imagePath: string;
    frameTime?: number;
    text: string;
    boxThreshold?: number;
    maxDetections?: number;
    boxes?: [number, number, number, number][];
    points?: [number, number][];
    pointLabels?: number[];
  }) => {
    const segService = getInteractiveServiceManager();

    // Text query only needs the service process running -- not the (possibly
    // different) point-segmentation model warmed. Start it without warming;
    // the text-query model loads lazily inside the text_query request.
    await segService.ensureStarted(settings.get());

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
    const segService = getInteractiveServiceManager();

    // Auto-initialize if not ready
    if (!segService.isSegmentationReady()) {
      await segService.initialize(settings.get());
    }

    const response = await segService.refineDetections(args);
    return response;
  });

  /**
   * Interactive Stereo Service
   */

  ipcMain.handle('stereo-enable', async (event, args?: { calibration?: StereoCalibration; calibrationFile?: string }) => {
    const stereoService = getInteractiveServiceManager();

    // Forward async disparity events to the renderer. The manager is a
    // long-lived singleton, so clear any prior forwarders before re-adding to
    // avoid accumulating listeners across enable cycles.
    stereoService.removeAllListeners('disparity_ready');
    stereoService.removeAllListeners('disparity_error');
    stereoService.on('disparity_ready', (data) => {
      event.sender.send('stereo-disparity-ready', data);
    });
    stereoService.on('disparity_error', (data) => {
      event.sender.send('stereo-disparity-error', data);
    });

    const result = await stereoService.enable(
      settings.get(),
      args?.calibration,
      args?.calibrationFile,
    );
    return result;
  });

  ipcMain.handle('stereo-disable', async () => {
    const stereoService = getInteractiveServiceManager();
    const result = await stereoService.disable();
    return result;
  });

  ipcMain.handle('stereo-set-frame', async (_, args: StereoSetFrameRequest) => {
    const stereoService = getInteractiveServiceManager();
    const result = await stereoService.setFrame(args);
    return result;
  });

  ipcMain.handle('stereo-get-status', async () => {
    const stereoService = getInteractiveServiceManager();
    const result = await stereoService.getStatus();
    return result;
  });

  ipcMain.handle('stereo-transfer-line', async (_, args: StereoTransferLineRequest) => {
    const stereoService = getInteractiveServiceManager();
    const result = await stereoService.transferLine(args);
    return result;
  });

  ipcMain.handle('stereo-transfer-points', async (_, args: StereoTransferPointsRequest) => {
    const stereoService = getInteractiveServiceManager();
    const result = await stereoService.transferPoints(args);
    return result;
  });

  ipcMain.handle('stereo-measure-line', async (_, args: StereoMeasureLineRequest) => {
    const stereoService = getInteractiveServiceManager();
    const result = await stereoService.measureLine(args);
    return result;
  });

  ipcMain.handle('stereo-aggregate-lengths', async (_, args: StereoAggregateLengthsRequest) => {
    const stereoService = getInteractiveServiceManager();
    const result = await stereoService.aggregateLengths(args);
    return result;
  });

  ipcMain.handle('stereo-set-calibration', async (_, args: { calibration: StereoCalibration }) => {
    const stereoService = getInteractiveServiceManager();
    await stereoService.setCalibration(args.calibration);
    return { success: true };
  });

  ipcMain.handle('stereo-shutdown', async () => {
    const stereoService = getInteractiveServiceManager();
    return stereoService.disable();
  });

  ipcMain.handle('stereo-is-enabled', () => {
    const stereoService = getInteractiveServiceManager();
    return { enabled: stereoService.isEnabled() };
  });
}
