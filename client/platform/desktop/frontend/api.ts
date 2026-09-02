import axios, { AxiosInstance } from 'axios';
import { watch } from 'vue';

import type {
  AnnotationSchema,
  DatasetConfigMutable, DatasetType, MultiCamImportArgs,
  Pipe, Pipelines, PipelineParams, SaveAttributeArgs,
  SaveAttributeTrackFilterArgs, SaveDetectionsArgs, TrainingConfigs,
  DatasetCalibrationResult, GlobalStyleSettings, FrameMetadataSourcesResponse,
  SegmentationPredictRequest, SegmentationPredictResponse, SegmentationStatusResponse,
  SegmentationStereoSegmentRequest, SegmentationStereoSegmentResponse,
  TextQueryRequest, TextQueryResponse, RefineDetectionsRequest, RefineDetectionsResponse,
  PipelineJobResult,
} from 'dive-common/apispec';

import {
  fileVideoTypes, calibrationFileTypes,
  inputAnnotationFileTypes, listFileTypes,
  largeImageDesktopTypes, transformFileTypes,
  metadataFileTypes,
} from 'dive-common/constants';
import {
  DesktopConfig, NvidiaSmiReply,
  RunPipeline, RunTraining, ExportTrainedPipeline, ExportDatasetArgs, ExportConfigurationArgs,
  ExportMulticamEverythingArgs,
  DesktopMediaImportResponse, ConversionArgs, JobType,
  DesktopJob,
  MultiCamBatchScanResult,
} from 'platform/desktop/constants';

import { gpuJobQueue, cpuJobQueue, jobHistory } from './store/jobs';

interface FileFilter {
  name: string;
  extensions: string[];
}

function getExtension(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() || '';
  const lastDot = filename.lastIndexOf('.');
  return lastDot > -1 ? filename.slice(lastDot + 1).toLowerCase() : '';
}

function joinPath(dir: string, filename: string) {
  const separator = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${separator}${filename}`;
}

/**
 * window.diveDesktop.invoke is typed as Promise<unknown> because it is a generic
 * ipcRenderer.invoke wrapper. Each channel's actual return shape is defined by its
 * handler in platform/desktop/backend; callers below narrow to that shape.
 */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return window.diveDesktop.invoke(channel, ...args) as Promise<T>;
}

interface ServerInfo {
  address: string;
  port: number;
}

/**
 * Native functions that run entirely in the renderer
 */

async function openFromDisk(datasetType: DatasetType | 'bulk' | 'calibration' | 'annotation' | 'config' | 'text' | 'transform' | 'metadata', directory = false) {
  let filters: FileFilter[] = [];
  const allFiles = { name: 'All Files', extensions: ['*'] };
  if (datasetType === 'video') {
    filters = [
      { name: 'Videos', extensions: fileVideoTypes },
      allFiles,
    ];
  }
  if (datasetType === 'large-image') {
    filters = [
      { name: 'GeoTIFF / TIFF', extensions: largeImageDesktopTypes },
    ];
  }
  if (datasetType === 'calibration') {
    filters = [
      { name: 'calibration', extensions: calibrationFileTypes },
      allFiles,
    ];
  }
  if (datasetType === 'annotation') {
    filters = [
      { name: 'annotation', extensions: inputAnnotationFileTypes },
      allFiles,
    ];
  }
  if (datasetType === 'config') {
    filters = [
      { name: 'configuration', extensions: ['json'] },
      allFiles,
    ];
  }
  if (datasetType === 'transform') {
    filters = [
      { name: 'Transform / calibration', extensions: transformFileTypes },
      allFiles,
    ];
  }
  if (datasetType === 'text') {
    filters = [
      { name: 'text', extensions: listFileTypes },
      allFiles,
    ];
  }
  if (datasetType === 'metadata') {
    filters = [
      { name: 'metadata', extensions: metadataFileTypes },
      allFiles,
    ];
  }
  const openDirectory = ['image-sequence', 'bulk'].includes(datasetType) || directory;
  const results = await window.diveDesktop.showOpenDialog({
    properties: [openDirectory ? 'openDirectory' : 'openFile'],
    filters: openDirectory ? [] : filters,
  });
  if (datasetType === 'annotation') {
    const allowed = new Set(inputAnnotationFileTypes.map((ext) => ext.toLowerCase()));
    if (!results.filePaths.every(
      (item) => allowed.has(getExtension(item)),
    )) {
      throw Error('File Types did not match JSON or CSV');
    }
  }
  if (datasetType === 'config') {
    if (!results.filePaths.every((item) => getExtension(item) === 'json')) {
      throw Error('Configuration File must be JSON');
    }
  }
  if (datasetType === 'large-image') {
    const allowed = new Set(largeImageDesktopTypes.map((ext) => ext.toLowerCase()));
    if (!results.filePaths.every(
      (item) => allowed.has(getExtension(item)),
    )) {
      throw Error('File Types did not match TIFF/GeoTIFF');
    }
  }
  return results;
}

/**
 * IPC api for small-body messages
 */

function nvidiaSmi(): Promise<NvidiaSmiReply> {
  return invoke<NvidiaSmiReply>('nvidia-smi');
}

function openLink(url: string): Promise<void> {
  return invoke<void>('open-link-in-browser', url);
}

async function getPipelineList(): Promise<Pipelines> {
  return invoke<Pipelines>('get-pipeline-list');
}

async function getTrainingConfigurations(): Promise<TrainingConfigs> {
  return invoke<TrainingConfigs>('get-training-configs');
}

async function runPipeline(itemId: string, pipeline: Pipe, pipelineParams?: PipelineParams): Promise<void> {
  const args: RunPipeline = {
    type: JobType.RunPipeline,
    pipeline,
    datasetId: itemId,
    pipelineParams,
    outputDatasetName: pipelineParams?.outputDatasetName,
  };
  gpuJobQueue.enqueue(args);
}

/**
 * Resolve when the pipeline job for this dataset finishes.
 *
 * The job store is the only place that knows a job ended: a pipeline's own
 * artifacts cannot say it, because a deterministic re-run writes byte-identical
 * output and a job that fails writes none at all. Both look exactly like "still
 * running" to anything watching the output.
 *
 * Only jobs starting at or after this call are considered, so an earlier run of
 * the same pipe on the same dataset (still in the history) is never mistaken for
 * this one. Resolution waits out the queue: `runPipeline` enqueues, so the job
 * may not exist for as long as the jobs ahead of it take.
 */
function watchPipelineJob(datasetId: string, pipeline: Pipe): Promise<PipelineJobResult> {
  const startedAt = Date.now();
  return new Promise<PipelineJobResult>((resolve) => {
    let key: string | null = null;
    let stop: (() => void) | undefined;
    let settled = false;
    const settle = (result: PipelineJobResult) => {
      if (settled) {
        return;
      }
      settled = true;
      // Undefined while the immediate run is still inside watch() -- a job that
      // had already finished by then settles on that first pass, before the
      // handle exists. The caller below stops the watcher in that case.
      stop?.();
      resolve(result);
    };
    stop = watch(jobHistory, () => {
      const entries = Object.values(jobHistory.value);
      if (key === null) {
        const match = entries.find((entry) => entry.job.jobType === 'pipeline'
          && 'pipeline' in entry.job.args
          && entry.job.args.pipeline.pipe === pipeline.pipe
          && entry.job.datasetIds.includes(datasetId)
          // A job update carries the start time as an ISO string once it has
          // crossed the IPC boundary, so normalize before comparing.
          && new Date(entry.job.startTime).getTime() >= startedAt);
        if (!match) {
          return;
        }
        key = match.job.key;
      }
      const job = jobHistory.value[key]?.job;
      if (!job || job.endTime === undefined) {
        return;
      }
      if (job.cancelledJob) {
        settle({ ok: false, message: 'The job was cancelled.' });
      } else if (job.exitCode === 0) {
        settle({ ok: true });
      } else {
        settle({
          ok: false,
          message: `The job exited with code ${job.exitCode}; see its log in the Jobs tab.`,
        });
      }
    }, { deep: true, immediate: true });
    if (settled) {
      stop();
    }
  });
}

async function exportTrainedPipeline(path: string, pipeline: Pipe): Promise<void> {
  const args: ExportTrainedPipeline = {
    type: JobType.ExportTrainedPipeline,
    path,
    pipeline,
  };
  cpuJobQueue.enqueue(args);
}

async function runTraining(
  folderIds: string[],
  pipelineName: string,
  config: string,
  annotatedFramesOnly: boolean,
  labelText?: string,
  fineTuneModel?: {
    name: string;
    type: string;
    path?: string;
    folderId?: string;
  },
): Promise<void> {
  const args: RunTraining = {
    type: JobType.RunTraining,
    datasetIds: folderIds,
    pipelineName,
    trainingConfig: config,
    annotatedFramesOnly,
    labelText,
    fineTuneModel,
  };
  gpuJobQueue.enqueue(args);
}

async function deleteTrainedPipeline(pipeline: Pipe): Promise<void> {
  return invoke<void>('delete-trained-pipeline', pipeline);
}

async function listResumableTrainingJobs(): Promise<DesktopJob[]> {
  return invoke<DesktopJob[]>('list-resumable-training');
}

async function resumeTraining(job: DesktopJob): Promise<void> {
  const args: RunTraining = {
    ...(job.args as RunTraining),
    resumeWorkingDir: job.workingDir,
  };
  gpuJobQueue.enqueue(args);
}

async function discardResumableTraining(job: DesktopJob): Promise<void> {
  return invoke<void>('discard-resumable-training', job.workingDir);
}

function importMedia(path: string): Promise<DesktopMediaImportResponse> {
  return invoke<DesktopMediaImportResponse>('import-media', { path });
}

function listImmediateSubfolders(parentPath: string): Promise<string[]> {
  return invoke<string[]>('list-immediate-subfolders', { path: parentPath });
}

function listParentFolderCameras(
  parentPath: string,
  mediaType: 'image-sequence' | 'video',
): Promise<{ name: string; sourcePath: string }[]> {
  return invoke<{ name: string; sourcePath: string }[]>('list-parent-folder-cameras', { path: parentPath, mediaType });
}

function resolveMulticamCameraSourcePath(
  subfolderPath: string,
  mediaType: 'image-sequence' | 'video',
): Promise<string> {
  return invoke<string>('resolve-multicam-camera-source-path', {
    path: subfolderPath,
    mediaType,
  });
}

function findParentFolderCalibrationFile(parentPath: string): Promise<string | null> {
  return invoke<string | null>('find-parent-folder-calibration-file', { path: parentPath });
}

function findParentFolderTransformFiles(parentPath: string): Promise<string[]> {
  return invoke<string[]>('find-parent-folder-transform-files', { path: parentPath });
}

function hasCalibrationFile(datasetId: string): Promise<boolean> {
  return invoke<boolean>('dataset-has-calibration-file', { datasetId });
}

function bulkImportMedia(path: string): Promise<DesktopMediaImportResponse[]> {
  return invoke<DesktopMediaImportResponse[]>('bulk-import-media', { path });
}

function deleteDataset(datasetId: string): Promise<boolean> {
  return invoke<boolean>('delete-dataset', { datasetId });
}

function checkDataset(datasetId: string): Promise<boolean> {
  return invoke<boolean>('check-dataset', { datasetId });
}

function importMultiCam(args: MultiCamImportArgs):
   Promise<DesktopMediaImportResponse> {
  return invoke<DesktopMediaImportResponse>('import-multicam-media', { args });
}

function scanMultiCamBatch(path: string): Promise<MultiCamBatchScanResult> {
  return invoke<MultiCamBatchScanResult>('scan-multicam-batch', { path });
}

function scanStereoBatch(path: string): Promise<MultiCamBatchScanResult> {
  return invoke<MultiCamBatchScanResult>('scan-stereo-batch', { path });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function importAnnotationFile(id: string, path: string, _htmlFile = undefined, additive = false, additivePrepend = ''): Promise<boolean | string[]> {
  return invoke<boolean | string[]>('import-annotation', {
    id, path, additive, additivePrepend,
  });
}

function finalizeImport(args: DesktopMediaImportResponse): Promise<ConversionArgs> {
  // Have this return JsonConfig as well as everything needed to start a job?
  return invoke<ConversionArgs>('finalize-import', args);
}

async function convert(args: ConversionArgs): Promise<void> {
  cpuJobQueue.enqueue(args);
}

async function exportDataset(id: string, exclude: boolean, typeFilter: readonly string[], type?: 'csv' | 'json' | 'coco'): Promise<string> {
  let extension = 'csv';
  if (type === 'json') {
    extension = 'json';
  } else if (type === 'coco') {
    extension = 'coco.json';
  }
  const location = await window.diveDesktop.showSaveDialog({
    title: 'Export Dataset',
    defaultPath: joinPath(
      await window.diveDesktop.getAppPath('home'),
      `result_${id}.${extension}`,
    ),
  });
  if (!location.canceled && location.filePath) {
    const args: ExportDatasetArgs = {
      id, exclude, path: location.filePath, typeFilter: new Set(typeFilter), type,
    };
    return invoke<string>('export-dataset', args);
  }
  return '';
}

async function exportConfiguration(id: string): Promise<string> {
  const location = await window.diveDesktop.showSaveDialog({
    title: 'Export Configuration',
    defaultPath: joinPath(await window.diveDesktop.getAppPath('home'), `${id}.config.json`),
  });
  if (!location.canceled && location.filePath) {
    const args: ExportConfigurationArgs = { id, path: location.filePath };
    return invoke<string>('export-configuration', args);
  }
  return '';
}

async function exportMulticamEverything(
  id: string,
  exclude: boolean,
  typeFilter: readonly string[],
): Promise<string> {
  const parentId = id.split('/')[0];
  const location = await window.diveDesktop.showSaveDialog({
    title: 'Export Multi Camera Dataset',
    defaultPath: joinPath(
      await window.diveDesktop.getAppPath('home'),
      `${parentId}.zip`,
    ),
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (!location.canceled && location.filePath) {
    const args: ExportMulticamEverythingArgs = {
      id: parentId,
      exclude,
      path: location.filePath,
      typeFilter: new Set(typeFilter),
    };
    return invoke<string>('export-multicam-everything', args);
  }
  return '';
}

async function cancelJob(job: DesktopJob): Promise<void> {
  return invoke<void>('cancel-job', job);
}

/**
 * Interactive Segmentation API
 */

async function segmentationInitialize(): Promise<{ success: boolean; noSamInstalled?: boolean }> {
  return invoke<{ success: boolean; noSamInstalled?: boolean }>('segmentation-initialize');
}

// Start the interactive service process without warming the point-segmentation
// model (used by text query, which loads its own model lazily).
async function segmentationEnsureStarted(): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('segmentation-ensure-started');
}

async function segmentationPredict(request: SegmentationPredictRequest): Promise<SegmentationPredictResponse> {
  return invoke<SegmentationPredictResponse>('segmentation-predict', request);
}

async function segmentationStereoSegment(
  request: SegmentationStereoSegmentRequest,
): Promise<SegmentationStereoSegmentResponse> {
  return invoke<SegmentationStereoSegmentResponse>('segmentation-stereo-segment', request);
}

async function segmentationSetImage(imagePath: string): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('segmentation-set-image', imagePath);
}

async function segmentationClearImage(): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('segmentation-clear-image');
}

async function segmentationShutdown(): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('segmentation-shutdown');
}

async function segmentationIsReady(): Promise<SegmentationStatusResponse> {
  return invoke<SegmentationStatusResponse>('segmentation-is-ready');
}

async function segmentationSam3Installed(): Promise<{ installed: boolean }> {
  return invoke<{ installed: boolean }>('segmentation-sam3-installed');
}

/**
 * Text Query API
 * Allows open-vocabulary detection and segmentation using text prompts
 */

async function textQuery(request: TextQueryRequest): Promise<TextQueryResponse> {
  return invoke<TextQueryResponse>('segmentation-text-query', request);
}

async function refineDetections(request: RefineDetectionsRequest): Promise<RefineDetectionsResponse> {
  return invoke<RefineDetectionsResponse>('segmentation-refine', request);
}

/**
 * Run text query pipeline on all frames
 */
async function runTextQueryPipeline(
  datasetId: string,
  queryText: string,
  threshold?: number,
  replaceExisting = false,
): Promise<void> {
  const pipeline: Pipe = {
    name: 'Text Query',
    pipe: 'utility_text_query_default.pipe',
    type: 'utility',
  };

  // Config keys must address the refiner's sam3 sub-block
  // (process track_refiner -> :refiner:type sam3 -> block refiner:sam3), and
  // must go under kwiverParams -- that is the only place runPipeline() threads
  // into "-s key=value" flags on the viame runner command.
  const kwiverParams: Record<string, string> = {
    'track_refiner:refiner:sam3:text_query': queryText,
    'track_refiner:refiner:sam3:replace_existing': replaceExisting ? 'true' : 'false',
  };

  if (threshold !== undefined) {
    kwiverParams['track_refiner:refiner:sam3:detection_threshold'] = threshold.toString();
  }

  const args: RunPipeline = {
    type: JobType.RunPipeline,
    pipeline,
    datasetId,
    pipelineParams: { kwiverParams },
  };
  gpuJobQueue.enqueue(args);
}

/**
 * Interactive Stereo API
 */

interface StereoCalibration {
  fx_left: number;
  fy_left?: number;
  cx_left: number;
  cy_left: number;
  T: [number, number, number];
}

interface StereoSetFrameRequest {
  leftImagePath: string;
  rightImagePath: string;
  /** Time in seconds when paths are video files */
  frameTime?: number;
}

interface StereoSetFrameResponse {
  id: string;
  success: boolean;
  error?: string;
  disparityReady: boolean;
  message?: string;
}

interface StereoStatusResponse {
  id: string;
  success: boolean;
  enabled: boolean;
  disparityReady: boolean;
  computing?: boolean;
  currentLeftPath?: string;
  currentRightPath?: string;
  hasCalibration: boolean;
}

interface StereoTransferLineRequest {
  line: [[number, number], [number, number]];
}

interface StereoMeasurement {
  length: number;
  midpoint_x: number;
  midpoint_y: number;
  midpoint_z: number;
  midpoint_range: number;
  stereo_rms: number;
}

interface StereoTransferLineResponse {
  id: string;
  success: boolean;
  error?: string;
  transferredLine?: [[number, number], [number, number]];
  originalLine?: [[number, number], [number, number]];
  length?: number;
  measurement?: StereoMeasurement;
  depthInfo?: {
    depthPoint1: number | null;
    depthPoint2: number | null;
    disparityPoint1: number;
    disparityPoint2: number;
  };
}

interface StereoMeasureLineRequest {
  leftLine: [[number, number], [number, number]];
  rightLine: [[number, number], [number, number]];
}

interface StereoMeasureLineResponse {
  id: string;
  success: boolean;
  error?: string;
  length?: number;
  measurement?: StereoMeasurement;
}

interface StereoAggregateLengthsRequest {
  lengths: number[];
  method?: string;
}

interface StereoAggregateLengthsResponse {
  id: string;
  success: boolean;
  error?: string;
  avgLength?: number;
}

interface StereoTransferPointsRequest {
  points: [number, number][];
}

interface StereoTransferPointsResponse {
  id: string;
  success: boolean;
  error?: string;
  transferredPoints?: [number, number][];
  originalPoints?: [number, number][];
  disparityValues?: number[];
}

async function stereoEnable(
  calibration?: StereoCalibration,
  calibrationFile?: string,
): Promise<{ success: boolean; error?: string; launchFailed?: boolean }> {
  return invoke<{ success: boolean; error?: string; launchFailed?: boolean }>('stereo-enable', { calibration, calibrationFile });
}

async function stereoDisable(): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('stereo-disable');
}

async function stereoSetFrame(request: StereoSetFrameRequest): Promise<StereoSetFrameResponse> {
  return invoke<StereoSetFrameResponse>('stereo-set-frame', request);
}

async function stereoGetStatus(): Promise<StereoStatusResponse> {
  return invoke<StereoStatusResponse>('stereo-get-status');
}

async function stereoTransferLine(request: StereoTransferLineRequest): Promise<StereoTransferLineResponse> {
  return invoke<StereoTransferLineResponse>('stereo-transfer-line', request);
}

async function stereoTransferPoints(request: StereoTransferPointsRequest): Promise<StereoTransferPointsResponse> {
  return invoke<StereoTransferPointsResponse>('stereo-transfer-points', request);
}

async function stereoMeasureLine(request: StereoMeasureLineRequest): Promise<StereoMeasureLineResponse> {
  return invoke<StereoMeasureLineResponse>('stereo-measure-line', request);
}

async function stereoAggregateLengths(request: StereoAggregateLengthsRequest): Promise<StereoAggregateLengthsResponse> {
  return invoke<StereoAggregateLengthsResponse>('stereo-aggregate-lengths', request);
}

async function stereoSetCalibration(calibration: StereoCalibration): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('stereo-set-calibration', { calibration });
}

async function stereoIsEnabled(): Promise<{ enabled: boolean }> {
  return invoke<{ enabled: boolean }>('stereo-is-enabled');
}

function onStereoDisparityReady(callback: (data: unknown) => void): () => void {
  return window.diveDesktop.on('stereo-disparity-ready', (data: unknown) => callback(data));
}

function onStereoDisparityError(callback: (data: unknown) => void): () => void {
  return window.diveDesktop.on('stereo-disparity-error', (data: unknown) => callback(data));
}

/**
 * REST api for larger-body messages
 */

/**
 * Initialize an axios client instance given the server
 * address details fetched from backend over ipc
 */
let _axiosClient: AxiosInstance; // do not use elsewhere
let _baseURL: string | null = null;

function formatHostForUrl(host: string) {
  if (host.includes(':') && !host.startsWith('[')) {
    return `[${host}]`;
  }
  return host;
}

async function getClient(): Promise<AxiosInstance> {
  if (_axiosClient === undefined) {
    const addr = await invoke<ServerInfo>('server-info');
    _baseURL = `http://${formatHostForUrl(addr.address)}:${addr.port}/api`;
    _axiosClient = axios.create({ baseURL: _baseURL });
  }
  return _axiosClient;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- projection kept for API compatibility
async function getTiles(itemId: string, _projection?: string) {
  const client = await getClient(); // ensures _baseURL is set for getTileURL
  const { data } = await client.get(`dataset/${itemId}/tiles`);
  return data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getTileURL(itemId: string, x: number, y: number, level: number, query: Record<string, any>): string {
  if (!_baseURL) {
    throw new Error('API not initialized: getTileURL called before any REST request');
  }
  const params = new URLSearchParams(query || {}).toString();
  const suffix = params ? `?${params}` : '';
  return `${_baseURL}/dataset/${itemId}/tiles/${level}/${x}/${y}${suffix}`;
}

async function loadConfig(id: string) {
  const client = await getClient();
  const { data } = await client.get<DesktopConfig>(`dataset/${id}/meta`);
  return { ...data, calibration: data.multiCam?.calibration ?? null };
}

async function loadDetections(datasetId: string) {
  const annotations = await invoke<AnnotationSchema>('load-detections', { datasetId });
  return {
    version: annotations.version,
    tracks: Object.values(annotations.tracks),
    groups: Object.values(annotations.groups),
    sets: [],
  };
}

function loadFrameMetadata(datasetId: string): Promise<FrameMetadataSourcesResponse> {
  return invoke<FrameMetadataSourcesResponse>('load-frame-metadata', { datasetId });
}

async function saveConfig(id: string, args: DatasetConfigMutable) {
  const client = await getClient();
  return client.post(`dataset/${id}/meta`, args);
}

async function saveDetections(id: string, args: SaveDetectionsArgs) {
  const client = await getClient();
  return client.post(`dataset/${id}/detections`, args);
}

async function saveAttributes(id: string, args: SaveAttributeArgs) {
  const client = await getClient();
  return client.post(`dataset/${id}/attributes`, args);
}

async function saveAttributeTrackFilters(id: string, args: SaveAttributeTrackFilterArgs) {
  const client = await getClient();
  return client.post(`dataset/${id}/attribute_track_filters`, args);
}

function getLastCalibration(): Promise<string | null> {
  return invoke<string | null>('get-last-calibration');
}

function loadGlobalStyleSettings(): Promise<GlobalStyleSettings> {
  return invoke<GlobalStyleSettings>('load-global-style-settings');
}

function saveGlobalStyleSettings(settings: GlobalStyleSettings): Promise<unknown> {
  return window.diveDesktop.invoke('save-global-style-settings', settings);
}

function saveCalibration(path: string): Promise<{ savedPath: string; updatedDatasetIds: string[] }> {
  return invoke<{ savedPath: string; updatedDatasetIds: string[] }>('save-calibration', { path });
}

function importCalibrationFile(datasetId: string, path: string): Promise<{ calibration: string }> {
  return invoke<{ calibration: string }>('import-calibration', { id: datasetId, path });
}

function exportCalibrationFile(datasetId: string, destPath: string): Promise<{ exportedPath: string }> {
  return invoke<{ exportedPath: string }>('export-calibration', { id: datasetId, destPath });
}

/** Export one camera's *_registration.json file to destPath. */
function exportCameraRegistration(
  datasetId: string,
  destPath: string,
  camera: string,
): Promise<{ exportedPath: string }> {
  return invoke<{ exportedPath: string }>('export-camera-registration', { id: datasetId, destPath, camera });
}

/** Merge a DIVE registration .json into the dataset's camera registration. */
function importCameraRegistration(
  datasetId: string,
  path: string,
  _file?: File,
  options?: { camera?: string },
): Promise<{ cameras: string[]; pairCount: number }> {
  return invoke<{ cameras: string[]; pairCount: number }>('import-camera-registration', { id: datasetId, path, options });
}

function getDatasetCalibration(datasetId: string): Promise<DatasetCalibrationResult | null> {
  return invoke<DatasetCalibrationResult | null>('get-dataset-calibration', { datasetId });
}

async function downloadCalibration(datasetId: string): Promise<void> {
  const calibration = await getDatasetCalibration(datasetId);
  const defaultName = calibration?.path ?? `calibration_${datasetId}.json`;
  const location = await window.diveDesktop.showSaveDialog({
    title: 'Export Camera File',
    defaultPath: joinPath(await window.diveDesktop.getAppPath('home'), defaultName),
  });
  if (!location.canceled && location.filePath) {
    await exportCalibrationFile(datasetId, location.filePath);
  }
}

function deleteCalibration(datasetId: string): Promise<void> {
  return invoke<void>('delete-calibration', { datasetId });
}

export {
  /* Standard Specification APIs */
  loadConfig,
  loadDetections,
  loadFrameMetadata,
  getPipelineList,
  deleteTrainedPipeline,
  runPipeline,
  watchPipelineJob,
  exportTrainedPipeline,
  getTrainingConfigurations,
  runTraining,
  listResumableTrainingJobs,
  resumeTraining,
  discardResumableTraining,
  saveConfig,
  saveDetections,
  saveAttributes,
  saveAttributeTrackFilters,
  openFromDisk,
  getTiles,
  getTileURL,
  /* Nonstandard APIs */
  exportDataset,
  exportConfiguration,
  exportMulticamEverything,
  finalizeImport,
  convert,
  importMedia,
  listImmediateSubfolders,
  listParentFolderCameras,
  resolveMulticamCameraSourcePath,
  findParentFolderCalibrationFile,
  findParentFolderTransformFiles,
  hasCalibrationFile,
  bulkImportMedia,
  deleteDataset,
  checkDataset,
  importAnnotationFile,
  importMultiCam,
  scanMultiCamBatch,
  scanStereoBatch,
  openLink,
  nvidiaSmi,
  cancelJob,
  getLastCalibration,
  saveCalibration,
  loadGlobalStyleSettings,
  saveGlobalStyleSettings,
  importCalibrationFile,
  exportCalibrationFile,
  exportCameraRegistration,
  importCameraRegistration,
  getDatasetCalibration,
  downloadCalibration,
  deleteCalibration,
  /* Segmentation APIs */
  segmentationInitialize,
  segmentationEnsureStarted,
  segmentationPredict,
  segmentationStereoSegment,
  segmentationSetImage,
  segmentationClearImage,
  segmentationShutdown,
  segmentationIsReady,
  segmentationSam3Installed,
  /* Text Query APIs */
  textQuery,
  refineDetections,
  runTextQueryPipeline,
  /* Auto Register APIs */
  /* Stereo APIs */
  stereoEnable,
  stereoDisable,
  stereoSetFrame,
  stereoGetStatus,
  stereoTransferLine,
  stereoTransferPoints,
  stereoMeasureLine,
  stereoAggregateLengths,
  stereoSetCalibration,
  stereoIsEnabled,
  onStereoDisparityReady,
  onStereoDisparityError,
};
