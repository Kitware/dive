import type { FileFilter } from 'electron';

import npath from 'path';
import mime from 'mime-types';
import axios, { AxiosInstance } from 'axios';
import { ipcRenderer } from 'electron';
import { dialog, app } from '@electron/remote';

import type {
  DatasetMetaMutable, DatasetType, MultiCamImportArgs,
  Pipe, Pipelines, SaveAttributeArgs,
  SaveAttributeTrackFilterArgs, SaveDetectionsArgs, TrainingConfigs,
  SegmentationPredictRequest, SegmentationPredictResponse, SegmentationStatusResponse,
  TextQueryRequest, TextQueryResponse, RefineDetectionsRequest, RefineDetectionsResponse,
} from 'dive-common/apispec';

import {
  fileVideoTypes, calibrationFileTypes,
  inputAnnotationFileTypes, listFileTypes, inputAnnotationTypes,
} from 'dive-common/constants';
import {
  DesktopMetadata, NvidiaSmiReply,
  RunPipeline, RunTraining, ExportTrainedPipeline, ExportDatasetArgs, ExportConfigurationArgs,
  DesktopMediaImportResponse, ConversionArgs, JobType,
  DesktopJob,
} from 'platform/desktop/constants';

import { gpuJobQueue, cpuJobQueue } from './store/jobs';

/**
 * Native functions that run entirely in the renderer
 */

async function openFromDisk(datasetType: DatasetType | 'bulk' | 'calibration' | 'annotation' | 'text', directory = false) {
  let filters: FileFilter[] = [];
  const allFiles = { name: 'All Files', extensions: ['*'] };
  if (datasetType === 'video') {
    filters = [
      { name: 'Videos', extensions: fileVideoTypes },
      allFiles,
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
  const results = await dialog.showOpenDialog({
    properties: [props],
    filters,
  });
  if (datasetType === 'annotation') {
    if (!results.filePaths.every(
      (item) => inputAnnotationTypes.includes(mime.lookup(item).toString()),
    )) {
      throw Error('File Types did not match JSON or CSV');
    }
  }
  return results;
}

/**
 * IPC api for small-body messages
 */

function nvidiaSmi(): Promise<NvidiaSmiReply> {
  return ipcRenderer.invoke('nvidia-smi');
}

function openLink(url: string): Promise<void> {
  return ipcRenderer.invoke('open-link-in-browser', url);
}

async function getPipelineList(): Promise<Pipelines> {
  return ipcRenderer.invoke('get-pipeline-list');
}

async function getTrainingConfigurations(): Promise<TrainingConfigs> {
  return ipcRenderer.invoke('get-training-configs');
}

async function runPipeline(itemId: string, pipeline: Pipe, frameRange?: [number, number] | null, additionalConfig?: Record<string, string>): Promise<void> {
  const args: RunPipeline = {
    type: JobType.RunPipeline,
    pipeline,
    datasetId: itemId,
    frameRange: frameRange || undefined,
    ...additionalConfig,
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
  return ipcRenderer.invoke('delete-trained-pipeline', pipeline);
}

function importMedia(path: string): Promise<DesktopMediaImportResponse> {
  return ipcRenderer.invoke('import-media', { path });
}

function bulkImportMedia(path: string): Promise<DesktopMediaImportResponse[]> {
  return ipcRenderer.invoke('bulk-import-media', { path });
}

function deleteDataset(datasetId: string): Promise<boolean> {
  return ipcRenderer.invoke('delete-dataset', { datasetId });
}

function checkDataset(datasetId: string): Promise<boolean> {
  return ipcRenderer.invoke('check-dataset', { datasetId });
}

function importMultiCam(args: MultiCamImportArgs):
   Promise<DesktopMediaImportResponse> {
  return ipcRenderer.invoke('import-multicam-media', { args });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function importAnnotationFile(id: string, path: string, _htmlFile = undefined, additive = false, additivePrepend = ''): Promise<boolean | string[]> {
  return ipcRenderer.invoke('import-annotation', {
    id, path, additive, additivePrepend,
  });
}

function finalizeImport(args: DesktopMediaImportResponse): Promise<ConversionArgs> {
  // Have this return JsonMeta as well as everything needed to start a job?
  return ipcRenderer.invoke('finalize-import', args);
}

async function convert(args: ConversionArgs): Promise<void> {
  cpuJobQueue.enqueue(args);
}

async function exportDataset(id: string, exclude: boolean, typeFilter: readonly string[], type?: 'csv' | 'json'): Promise<string> {
  const location = await dialog.showSaveDialog({
    title: 'Export Dataset',
    defaultPath: npath.join(app.getPath('home'), type === 'json' ? `result_${id}.json` : `result_${id}.csv`),
  });
  if (!location.canceled && location.filePath) {
    const args: ExportDatasetArgs = {
      id, exclude, path: location.filePath, typeFilter: new Set(typeFilter), type,
    };
    return ipcRenderer.invoke('export-dataset', args);
  }
  return '';
}

async function exportConfiguration(id: string): Promise<string> {
  const location = await dialog.showSaveDialog({
    title: 'Export Configuration',
    defaultPath: npath.join(app.getPath('home'), `${id}.config.json`),
  });
  if (!location.canceled && location.filePath) {
    const args: ExportConfigurationArgs = { id, path: location.filePath };
    return ipcRenderer.invoke('export-configuration', args);
  }
  return '';
}

async function cancelJob(job: DesktopJob): Promise<void> {
  return ipcRenderer.invoke('cancel-job', job);
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

async function stereoEnable(
  calibration?: StereoCalibration,
  calibrationFile?: string,
): Promise<{ success: boolean; error?: string }> {
  return ipcRenderer.invoke('stereo-enable', { calibration, calibrationFile });
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
async function getClient(): Promise<AxiosInstance> {
  if (_axiosClient === undefined) {
    const addr = await ipcRenderer.invoke('server-info');
    const baseURL = `http://${addr.address}:${addr.port}/api`;
    _axiosClient = axios.create({ baseURL });
  }
  return _axiosClient;
}

async function loadMetadata(id: string) {
  const client = await getClient();
  const { data } = await client.get<DesktopMetadata>(`dataset/${id}/meta`);
  return data;
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
  return ipcRenderer.invoke('get-last-calibration');
}

function saveCalibration(path: string): Promise<{ savedPath: string; updatedDatasetIds: string[] }> {
  return ipcRenderer.invoke('save-calibration', { path });
}

export {
  /* Standard Specification APIs */
  loadMetadata,
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
  /* Calibration APIs */
  getLastCalibration,
  saveCalibration,
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
