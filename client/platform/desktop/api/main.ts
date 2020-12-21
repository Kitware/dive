import type { FileFilter } from 'electron';

import { ipcRenderer, remote } from 'electron';

import {
  Attribute,
  DatasetMetaMutable,
  DatasetType, Pipelines, TrainingConfigs,
} from 'viame-web-common/apispec';

import common from '../backend/platforms/common';
import {
  DesktopJob, NvidiaSmiReply, RunPipeline,
  websafeVideoTypes, Settings,
} from '../constants';


const { loadDetections, saveDetections } = common;



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

async function getPipelineList(settings: Settings): Promise<Pipelines> {
  return ipcRenderer.invoke('get-pipeline-list', settings);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getTrainingConfigurations(): Promise<TrainingConfigs> {
  return Promise.resolve({ configs: [], default: '' });
}

async function runTraining(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  folderId: string, pipelineName: string, config: string,
): Promise<unknown> {
  return Promise.resolve();
}

// eslint-disable-next-line
async function saveMetadata(datasetId: string, metadata: DatasetMetaMutable) {
  return Promise.resolve();
}

async function runPipeline(itemId: string, pipeline: string, settings: Settings) {
  const args: RunPipeline = {
    pipelineName: pipeline,
    datasetId: itemId,
    settings,
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
  loadDetections,
  saveDetections,
  saveMetadata,
  /* Nonstandard APIs */
  openFromDisk,
  openLink,
  nvidiaSmi,
};
