import type { FileFilter } from 'electron';

import axios, { AxiosInstance } from 'axios';
import { ipcRenderer, remote } from 'electron';

import type {
  Attribute, DatasetMetaMutable, DatasetType,
  Pipe, Pipelines, SaveDetectionsArgs, TrainingConfigs,
} from 'viame-web-common/apispec';

import {
  DesktopJob, DesktopMetadata, JsonMeta, NvidiaSmiReply,
  RunPipeline, RunTraining, fileVideoTypes,
} from 'platform/desktop/constants';

/**
 * Native functions that run entirely in the renderer
 */

async function openFromDisk(datasetType: DatasetType) {
  let filters: FileFilter[] = [];
  if (datasetType === 'video') {
    filters = [
      { name: 'Videos', extensions: fileVideoTypes },
    ];
  }
  const results = await remote.dialog.showOpenDialog({
    properties: [datasetType === 'video' ? 'openFile' : 'openDirectory'],
    filters,
  });
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
  folderIds: string[], pipelineName: string, config: string,
): Promise<DesktopJob> {
  const args: RunTraining = {
    datasetIds: folderIds,
    pipelineName,
    trainingConfig: config,
  };
  return ipcRenderer.invoke('run-training', args);
}

async function importMedia(path: string): Promise<JsonMeta> {
  const data: JsonMeta = await ipcRenderer.invoke('import-media', path);
  return data;
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

async function getAttributes(datasetId: string) {
  const client = await getClient();
  const { data } = await client.get<Attribute[]>(`dataset/${datasetId}/attribute`);
  return data;
}

async function setAttribute(datasetId: string, { addNew, data }:
  {addNew?: boolean; data: Attribute}) {
  const client = await getClient();
  return client.post(`dataset/${datasetId}/attribute`, { addNew, data });
}

async function deleteAttribute(datasetId: string, data: Attribute) {
  const client = await getClient();
  return client.delete(`dataset/${datasetId}/attribute`, { data });
}

export {
  /* Standard Specification APIs */
  loadMetadata,
  getAttributes,
  setAttribute,
  deleteAttribute,
  getPipelineList,
  runPipeline,
  getTrainingConfigurations,
  runTraining,
  saveMetadata,
  saveDetections,
  /* Nonstandard APIs */
  importMedia,
  openFromDisk,
  openLink,
  nvidiaSmi,
};
