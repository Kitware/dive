import { AddressInfo } from 'net';
import type { FileFilter } from 'electron';

import { ipcRenderer, remote } from 'electron';

import type {
  Attribute, DatasetType, Pipe, Pipelines, TrainingConfigs,
} from 'viame-web-common/apispec';

import {
  DesktopJob, NvidiaSmiReply, RunPipeline, websafeVideoTypes,
} from 'platform/desktop/constants';

function mediaServerInfo(): Promise<AddressInfo> {
  return ipcRenderer.invoke('server-info');
}

function nvidiaSmi(): Promise<NvidiaSmiReply> {
  return ipcRenderer.invoke('nvidia-smi');
}

function openLink(url: string): Promise<void> {
  return ipcRenderer.invoke('open-link-in-browser', url);
}

async function openFromDisk(datasetType: DatasetType) {
  let filters: FileFilter[] = [];
  if (datasetType === 'video') {
    filters = [
      { name: 'Videos', extensions: websafeVideoTypes.map((str) => str.split('/')[1]) },
    ];
  }
  const results = await remote.dialog.showOpenDialog({
    properties: [datasetType === 'video' ? 'openFile' : 'openDirectory'],
    filters,
  });
  return results;
}

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

async function getPipelineList(): Promise<Pipelines> {
  return ipcRenderer.invoke('get-pipeline-list');
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

async function runPipeline(itemId: string, pipeline: Pipe) {
  const args: RunPipeline = {
    pipeline,
    datasetId: itemId,
  };
  const job: DesktopJob = await ipcRenderer.invoke('run-pipeline', args);
  return job;
}

export {
  /* Standard common APIs */
  getAttributes,
  setAttribute,
  deleteAttribute,
  getPipelineList,
  runPipeline,
  getTrainingConfigurations,
  runTraining,
  /* Nonstandard APIs */
  openFromDisk,
  openLink,
  nvidiaSmi,
  mediaServerInfo,
};
