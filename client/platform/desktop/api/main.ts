import { AddressInfo } from 'net';
import path from 'path';

// eslint-disable-next-line import/no-extraneous-dependencies
import { ipcRenderer, remote, FileFilter } from 'electron';
// eslint-disable-next-line import/no-extraneous-dependencies
import fs from 'fs-extra';
// eslint-disable-next-line import/no-extraneous-dependencies
import mime from 'mime-types';

import {
  Attribute, DatasetMeta,
  DatasetMetaMutable,
  DatasetType, FrameImage,
  Pipelines, TrainingConfigs,
} from 'viame-web-common/apispec';

// TODO: disable node integration in renderer
// https://nklayman.github.io/vue-cli-plugin-electron-builder/guide/security.html
import { loadDetections, saveDetections } from './nativeServices';

const websafeVideoTypes = [
  'video/mp4',
  'video/webm',
];

const websafeImageTypes = [
  'image/apng',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
];

export interface DesktopDataset {
  name: string;
  basePath: string;
  root: string;
  videoPath?: string;
  meta: DatasetMeta;
}

function mediaServerInfo(): Promise<AddressInfo> {
  return ipcRenderer.invoke('info');
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
  return Promise.resolve({});
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function runPipeline(itemId: string, pipeline: string) {
  return Promise.resolve();
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

async function loadMetadata(datasetId: string): Promise<DesktopDataset> {
  let datasetType = undefined as 'video' | 'image-sequence' | undefined;
  let videoUrl = '';
  let videoPath = '';
  const imageData = [] as FrameImage[];
  const serverInfo = await mediaServerInfo();

  function processFile(abspath: string) {
    const basename = path.basename(abspath);
    const abspathuri = `http://localhost:${serverInfo.port}/api/media?path=${abspath}`;
    const mimetype = mime.lookup(abspath);
    if (mimetype && websafeVideoTypes.includes(mimetype)) {
      datasetType = 'video';
      videoPath = abspath;
      videoUrl = abspathuri;
    } else if (mimetype && websafeImageTypes.includes(mimetype)) {
      datasetType = 'image-sequence';
      imageData.push({
        url: abspathuri,
        filename: basename,
      });
    }
  }

  const info = await fs.stat(datasetId);

  if (info.isDirectory()) {
    const contents = await fs.readdir(datasetId);
    for (let i = 0; i < contents.length; i += 1) {
      processFile(path.join(datasetId, contents[i]));
    }
  } else {
    processFile(datasetId);
  }

  if (datasetType === undefined) {
    throw new Error(`Cannot open dataset ${datasetId}: No images or video found`);
  }

  return Promise.resolve({
    name: path.basename(datasetId),
    basePath: path.dirname(datasetId),
    root: datasetId,
    videoPath,
    meta: {
      type: datasetType,
      fps: 10,
      imageData: datasetType === 'image-sequence' ? imageData : [],
      videoUrl: datasetType === 'video' ? videoUrl : undefined,
    },
  });
}

// eslint-disable-next-line
async function saveMetadata(datasetId: string, metadata: DatasetMetaMutable) {
  return Promise.resolve();
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
  loadMetadata,
  saveMetadata,
  /* Nonstandard APIs */
  openFromDisk,
  openLink,
};
