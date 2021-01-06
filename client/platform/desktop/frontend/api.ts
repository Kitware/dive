import type { FileFilter } from 'electron';

import axios, { AxiosInstance } from 'axios';
import { ipcRenderer, remote } from 'electron';

import type {
  Attribute, DatasetMetaMutable, DatasetType,
  Pipe, Pipelines, SaveDetectionsArgs, TrainingConfigs,
} from 'viame-web-common/apispec';

import {
  DesktopJob, DesktopMetadata, fileVideoTypes, JsonMeta, NvidiaSmiReply, RunPipeline,
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

async function runPipeline(itemId: string, pipeline: Pipe) {
  const args: RunPipeline = {
    pipeline,
    datasetId: itemId,
  };
  const job: DesktopJob = await ipcRenderer.invoke('run-pipeline', args);
  return job;
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

/**
 * Unimplemented sections of the API
 */

async function getAttributes() {
  return Promise.resolve([] as Attribute[]);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function setAttribute({ addNew, data }: {addNew: boolean | undefined; data: Attribute}) {
  return Promise.resolve();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function deleteAttribute(data: Attribute) {
  return Promise.resolve([] as Attribute[]);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getTrainingConfigurations(): Promise<TrainingConfigs> {
  return Promise.resolve({ configs: [], default: '' });
}

async function runTraining(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  folderIds: string[], pipelineName: string, config: string,
): Promise<unknown> {
  return Promise.resolve();
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
