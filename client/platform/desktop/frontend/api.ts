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
  DesktopJob, DesktopMetadata, JsonMeta, NvidiaSmiReply,
  RunPipeline, RunTraining, ExportDatasetArgs, ExportConfigurationArgs,
  DesktopMediaImportResponse,
} from 'platform/desktop/constants';


/**
 * Native functions that run entirely in the renderer
 */

async function openFromDisk(datasetType: DatasetType | 'calibration' | 'annotation' | 'text', directory = false) {
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
  const props = (datasetType === 'image-sequence' || directory) ? 'openDirectory' : 'openFile';
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

async function runPipeline(itemId: string, pipeline: Pipe): Promise<DesktopJob> {
  const args: RunPipeline = {
    pipeline,
    datasetId: itemId,
  };
  return ipcRenderer.invoke('run-pipeline', args);
}

async function runTraining(
  folderIds: string[],
  pipelineName: string,
  config: string,
  annotatedFramesOnly: boolean,
  labelText?: string,
): Promise<DesktopJob> {
  const args: RunTraining = {
    datasetIds: folderIds,
    pipelineName,
    trainingConfig: config,
    annotatedFramesOnly,
    labelText,
  };
  return ipcRenderer.invoke('run-training', args);
}

function importMedia(path: string): Promise<DesktopMediaImportResponse> {
  return ipcRenderer.invoke('import-media', { path });
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
function importAnnotationFile(id: string, path: string, _htmlFile = undefined, additive = false, additivePrepend = ''): Promise<boolean> {
  return ipcRenderer.invoke('import-annotation', {
    id, path, additive, additivePrepend,
  });
}

function finalizeImport(args: DesktopMediaImportResponse): Promise<JsonMeta> {
  return ipcRenderer.invoke('finalize-import', args);
}

async function exportDataset(
  id: string, exclude: boolean, typeFilter: readonly string[],
): Promise<string> {
  const location = await dialog.showSaveDialog({
    title: 'Export Dataset',
    defaultPath: npath.join(app.getPath('home'), `result_${id}.csv`),
  });
  if (!location.canceled && location.filePath) {
    const args: ExportDatasetArgs = {
      id, exclude, path: location.filePath, typeFilter: new Set(typeFilter),
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
  runPipeline,
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
  importMedia,
  deleteDataset,
  checkDataset,
  importAnnotationFile,
  importMultiCam,
  openLink,
  nvidiaSmi,
};
