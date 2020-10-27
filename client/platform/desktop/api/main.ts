import { TrackData } from 'vue-media-annotator/track';
import fs from 'fs';
// eslint-disable-next-line import/no-extraneous-dependencies
import mime from 'mime-types';
import path from 'path';
import {
  Attribute, DatasetMeta, DatasetMetaMutable, FrameImage,
  Pipelines, SaveDetectionsArgs, TrainingConfigs,
} from 'viame-web-common/apispec';
// eslint-disable-next-line
import { ipcRenderer, remote } from 'electron';
import { AddressInfo } from 'net';

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
  root: string;
  videoPath?: string;
  meta: DatasetMeta;
}

const mediaServerInfo: AddressInfo = ipcRenderer.sendSync('info');

async function openFromDisk() {
  const results = await remote.dialog.showOpenDialog({
    properties: ['openFile', 'openDirectory'],
  });
  return results;
}

async function getAttributes() {
  return Promise.resolve([] as Attribute[]);
}
async function getPipelineList() {
  return Promise.resolve({} as Pipelines);
}
// eslint-disable-next-line
async function runPipeline(itemId: string, pipeline: string) {
  return Promise.resolve();
}
// eslint-disable-next-line
async function loadDetections(datasetId: string) {
  return Promise.resolve({} as { [key: string]: TrackData });
}
// eslint-disable-next-line
async function saveDetections(datasetId: string, args: SaveDetectionsArgs) {
  return Promise.resolve();
}
// eslint-disable-next-line
async function getTrainingConfigurations(): Promise<TrainingConfigs> {
  return Promise.resolve({ configs: [], default: '' });
}
// eslint-disable-next-line
async function runTraining(folderId: string, pipelineName: string, config: string): Promise<unknown> {
  return Promise.resolve();
}


async function loadMetadata(datasetId: string): Promise<DesktopDataset> {
  let datasetType = undefined as 'video' | 'image-sequence' | undefined;
  let videoUrl = '';
  let videoPath = '';
  const imageData = [] as FrameImage[];

  function processFile(abspath: string) {
    const basename = path.basename(abspath);
    const abspathuri = `http://localhost:${mediaServerInfo.port}${abspath}`;
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

  const info = fs.statSync(datasetId);

  if (info.isDirectory()) {
    const contents = fs.readdirSync(datasetId);
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
  getAttributes,
  getPipelineList,
  runPipeline,
  getTrainingConfigurations,
  runTraining,
  loadDetections,
  openFromDisk,
  saveDetections,
  loadMetadata,
  saveMetadata,
};
