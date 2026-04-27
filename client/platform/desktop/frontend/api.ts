import axios, { AxiosInstance } from 'axios';

import type {
  DatasetMetaMutable, DatasetType, MultiCamImportArgs,
  Pipe, Pipelines, SaveAttributeArgs,
  SaveAttributeTrackFilterArgs, SaveDetectionsArgs, TrainingConfigs,
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
 * REST api for larger-body messages
 */

/**
 * Initialize an axios client instance given the server
 * address details fetched from backend over ipc
 */
let _axiosClient: AxiosInstance; // do not use elsewhere
async function getClient(): Promise<AxiosInstance> {
  if (_axiosClient === undefined) {
    const addr = await window.diveDesktop.invoke('server-info');
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
};
