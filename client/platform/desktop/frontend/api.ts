import axios, { AxiosInstance } from 'axios';

import type {
  DatasetMetaMutable, DatasetType, MultiCamImportArgs,
  Pipe, Pipelines, SaveAttributeArgs,
  SaveAttributeTrackFilterArgs, SaveDetectionsArgs, TrainingConfigs,
  SegmentationPredictRequest, SegmentationPredictResponse, SegmentationStatusResponse,
  TextQueryRequest, TextQueryResponse, RefineDetectionsRequest, RefineDetectionsResponse,
} from 'dive-common/apispec';

import {
  fileVideoTypes, calibrationFileTypes,
  inputAnnotationFileTypes, listFileTypes,
} from 'dive-common/constants';
import {
  DesktopMetadata, NvidiaSmiReply,
  RunPipeline, RunTraining, ExportTrainedPipeline, ExportDatasetArgs, ExportConfigurationArgs,
  DesktopMediaImportResponse, ConversionArgs, JobType,
  DesktopJob,
} from 'platform/desktop/constants';

import { gpuJobQueue, cpuJobQueue } from './store/jobs';

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
 * Native functions that run entirely in the renderer
 */

const largeImageFileExtensions = ['tif', 'tiff', 'geotiff'];

async function openFromDisk(datasetType: DatasetType | 'bulk' | 'calibration' | 'annotation' | 'text', directory = false) {
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
      { name: 'GeoTIFF / TIFF', extensions: largeImageFileExtensions },
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
  if (datasetType === 'text') {
    filters = [
      { name: 'text', extensions: listFileTypes },
      allFiles,
    ];
  }
  const props = (['image-sequence', 'bulk'].includes(datasetType) || directory) ? 'openDirectory' : 'openFile';
  const results = await window.diveDesktop.showOpenDialog({
    properties: [props],
    filters,
  });
  if (datasetType === 'annotation') {
    const allowed = new Set(inputAnnotationFileTypes.map((ext) => ext.toLowerCase()));
    if (!results.filePaths.every(
      (item) => allowed.has(getExtension(item)),
    )) {
      throw Error('File Types did not match JSON or CSV');
    }
  }
  if (datasetType === 'large-image') {
    const allowed = new Set(largeImageFileExtensions.map((ext) => ext.toLowerCase()));
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
  return window.diveDesktop.invoke('nvidia-smi');
}

function openLink(url: string): Promise<void> {
  return window.diveDesktop.invoke('open-link-in-browser', url);
}

async function getPipelineList(): Promise<Pipelines> {
  return window.diveDesktop.invoke('get-pipeline-list');
}

async function getTrainingConfigurations(): Promise<TrainingConfigs> {
  return window.diveDesktop.invoke('get-training-configs');
}

async function runPipeline(itemId: string, pipeline: Pipe, additionalConfig?: Record<string, string>): Promise<void> {
  const args: RunPipeline = {
    type: JobType.RunPipeline,
    pipeline,
    datasetId: itemId,
    pipelineParams: additionalConfig,
  };
  gpuJobQueue.enqueue(args);
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
  return window.diveDesktop.invoke('delete-trained-pipeline', pipeline);
}

function importMedia(path: string): Promise<DesktopMediaImportResponse> {
  return window.diveDesktop.invoke('import-media', { path });
}

function bulkImportMedia(path: string): Promise<DesktopMediaImportResponse[]> {
  return window.diveDesktop.invoke('bulk-import-media', { path });
}

function deleteDataset(datasetId: string): Promise<boolean> {
  return window.diveDesktop.invoke('delete-dataset', { datasetId });
}

function checkDataset(datasetId: string): Promise<boolean> {
  return window.diveDesktop.invoke('check-dataset', { datasetId });
}

function importMultiCam(args: MultiCamImportArgs):
   Promise<DesktopMediaImportResponse> {
  return window.diveDesktop.invoke('import-multicam-media', { args });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function importAnnotationFile(id: string, path: string, _htmlFile = undefined, additive = false, additivePrepend = ''): Promise<boolean | string[]> {
  return window.diveDesktop.invoke('import-annotation', {
    id, path, additive, additivePrepend,
  });
}

function finalizeImport(args: DesktopMediaImportResponse): Promise<ConversionArgs> {
  // Have this return JsonMeta as well as everything needed to start a job?
  return window.diveDesktop.invoke('finalize-import', args);
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
    return window.diveDesktop.invoke('export-dataset', args);
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
    return window.diveDesktop.invoke('export-configuration', args);
  }
  return '';
}

async function cancelJob(job: DesktopJob): Promise<void> {
  return window.diveDesktop.invoke('cancel-job', job);
}

/**
 * Interactive Segmentation API
 */

async function segmentationInitialize(): Promise<{ success: boolean }> {
  return ipcRenderer.invoke('segmentation-initialize');
}

async function segmentationPredict(request: SegmentationPredictRequest): Promise<SegmentationPredictResponse> {
  return ipcRenderer.invoke('segmentation-predict', request);
}

async function segmentationSetImage(imagePath: string): Promise<{ success: boolean }> {
  return ipcRenderer.invoke('segmentation-set-image', imagePath);
}

async function segmentationClearImage(): Promise<{ success: boolean }> {
  return ipcRenderer.invoke('segmentation-clear-image');
}

async function segmentationShutdown(): Promise<{ success: boolean }> {
  return ipcRenderer.invoke('segmentation-shutdown');
}

async function segmentationIsReady(): Promise<SegmentationStatusResponse> {
  return ipcRenderer.invoke('segmentation-is-ready');
}

/**
 * Text Query API
 * Allows open-vocabulary detection and segmentation using text prompts
 */

async function textQuery(request: TextQueryRequest): Promise<TextQueryResponse> {
  return ipcRenderer.invoke('segmentation-text-query', request);
}

async function refineDetections(request: RefineDetectionsRequest): Promise<RefineDetectionsResponse> {
  return ipcRenderer.invoke('segmentation-refine', request);
}

/**
 * Run text query pipeline on all frames
 */
async function runTextQueryPipeline(
  datasetId: string,
  queryText: string,
  threshold?: number,
): Promise<void> {
  const pipeline: Pipe = {
    name: 'Text Query',
    pipe: 'utility_text_query.pipe',
    type: 'utility',
  };

  const pipelineParams: Record<string, string> = {
    'track_refiner:refiner:text_query': queryText,
  };

  if (threshold !== undefined) {
    pipelineParams['track_refiner:refiner:detection_threshold'] = threshold.toString();
  }

  const args: RunPipeline = {
    type: JobType.RunPipeline,
    pipeline,
    datasetId,
    pipelineParams,
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

interface StereoTransferLineResponse {
  id: string;
  success: boolean;
  error?: string;
  transferredLine?: [[number, number], [number, number]];
  originalLine?: [[number, number], [number, number]];
  depthInfo?: {
    depthPoint1: number | null;
    depthPoint2: number | null;
    disparityPoint1: number;
    disparityPoint2: number;
  };
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

async function stereoEnable(calibration?: StereoCalibration): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('stereo-enable', { calibration });
}

async function stereoDisable(): Promise<{ success: boolean }> {
  return ipcRenderer.invoke('stereo-disable');
}

async function stereoSetFrame(request: StereoSetFrameRequest): Promise<StereoSetFrameResponse> {
  return ipcRenderer.invoke('stereo-set-frame', request);
}

async function stereoGetStatus(): Promise<StereoStatusResponse> {
  return ipcRenderer.invoke('stereo-get-status');
}

async function stereoTransferLine(request: StereoTransferLineRequest): Promise<StereoTransferLineResponse> {
  return ipcRenderer.invoke('stereo-transfer-line', request);
}

async function stereoTransferPoints(request: StereoTransferPointsRequest): Promise<StereoTransferPointsResponse> {
  return ipcRenderer.invoke('stereo-transfer-points', request);
}

async function stereoSetCalibration(calibration: StereoCalibration): Promise<{ success: boolean }> {
  return ipcRenderer.invoke('stereo-set-calibration', { calibration });
}

async function stereoIsEnabled(): Promise<{ enabled: boolean }> {
  return ipcRenderer.invoke('stereo-is-enabled');
}

function onStereoDisparityReady(callback: (data: unknown) => void): () => void {
  const handler = (_event: unknown, data: unknown) => callback(data);
  ipcRenderer.on('stereo-disparity-ready', handler);
  return () => ipcRenderer.removeListener('stereo-disparity-ready', handler);
}

function onStereoDisparityError(callback: (data: unknown) => void): () => void {
  const handler = (_event: unknown, data: unknown) => callback(data);
  ipcRenderer.on('stereo-disparity-error', handler);
  return () => ipcRenderer.removeListener('stereo-disparity-error', handler);
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

async function getClient(): Promise<AxiosInstance> {
  if (_axiosClient === undefined) {
    const addr = await window.diveDesktop.invoke('server-info');
    _baseURL = `http://${addr.address}:${addr.port}/api`;
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

async function loadMetadata(id: string) {
  const client = await getClient();
  const { data } = await client.get<DesktopMetadata>(`dataset/${id}/meta`);
  return data;
}

async function loadDetections(datasetId: string) {
  const annotations = await window.diveDesktop.invoke('load-detections', { datasetId });
  return {
    version: annotations.version,
    tracks: Object.values(annotations.tracks),
    groups: Object.values(annotations.groups),
    sets: [],
  };
}

async function saveMetadata(id: string, args: DatasetMetaMutable) {
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
  return window.diveDesktop.invoke('get-last-calibration');
}

function saveCalibration(path: string): Promise<{ savedPath: string; updatedDatasetIds: string[] }> {
  return window.diveDesktop.invoke('save-calibration', { path });
}

export {
  /* Standard Specification APIs */
  loadMetadata,
  loadDetections,
  getPipelineList,
  deleteTrainedPipeline,
  runPipeline,
  exportTrainedPipeline,
  getTrainingConfigurations,
  runTraining,
  saveMetadata,
  saveDetections,
  saveAttributes,
  saveAttributeTrackFilters,
  openFromDisk,
  getTiles,
  getTileURL,
  /* Nonstandard APIs */
  exportDataset,
  exportConfiguration,
  finalizeImport,
  convert,
  importMedia,
  bulkImportMedia,
  deleteDataset,
  checkDataset,
  importAnnotationFile,
  importMultiCam,
  openLink,
  nvidiaSmi,
  cancelJob,
  getLastCalibration,
  saveCalibration,
  /* Segmentation APIs */
  segmentationInitialize,
  segmentationPredict,
  segmentationSetImage,
  segmentationClearImage,
  segmentationShutdown,
  segmentationIsReady,
  /* Text Query APIs */
  textQuery,
  refineDetections,
  runTextQueryPipeline,
  /* Stereo APIs */
  stereoEnable,
  stereoDisable,
  stereoSetFrame,
  stereoGetStatus,
  stereoTransferLine,
  stereoTransferPoints,
  stereoSetCalibration,
  stereoIsEnabled,
  onStereoDisparityReady,
  onStereoDisparityError,
};
