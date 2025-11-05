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
} from 'dive-common/apispec';

import {
  fileVideoTypes, calibrationFileTypes,
  inputAnnotationFileTypes, listFileTypes, inputAnnotationTypes,
} from 'dive-common/constants';
import {
  DesktopMetadata, NvidiaSmiReply,
  RunPipeline, RunTraining, ExportTrainedPipeline, ExportDatasetArgs, ExportConfigurationArgs,
  DesktopMediaImportResponse, ConversionArgs,
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

async function runPipeline(itemId: string, pipeline: Pipe): Promise<void> {
  const args: RunPipeline = {
    pipeline,
    datasetId: itemId,
  };
  gpuJobQueue.enqueue(args);
}

async function exportTrainedPipeline(path: string, pipeline: Pipe): Promise<void> {
  const args: ExportTrainedPipeline = {
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
};
