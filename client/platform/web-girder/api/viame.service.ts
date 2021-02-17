import { GirderModel } from '@girder/components/src';

import {
  Attribute, Pipe, Pipelines, TrainingConfigs,
} from 'dive-common/apispec';
import girderRest from '../plugins/girder';

interface ValidationResponse {
  ok: boolean;
  type: 'video' | 'image-sequence';
  media: string[];
  annotations: string[];
  message: string;
}

export interface BrandData {
  vuetify: unknown;
  favicon: string | null;
  logo: string;
  name: string;
  loginMessage: string;
}

async function getBrandData(): Promise<BrandData> {
  const { data } = await girderRest.get<BrandData>('viame/brand_data');
  return data;
}


function makeViameFolder({
  folderId, name, fps, type,
}: {
  folderId: string;
  name: string;
  fps: number;
  type: string;
}) {
  return girderRest.post(
    '/folder',
    `metadata=${JSON.stringify({
      fps,
      type,
    })}`,
    {
      params: { parentId: folderId, name },
    },
  );
}

function deleteResources(resources: Array<GirderModel>) {
  const formData = new FormData();
  formData.set(
    'resources',
    JSON.stringify({
      folder: resources
        .filter((resource) => resource._modelType === 'folder')
        .map((resource) => resource._id),
      item: resources
        .filter((resource) => resource._modelType === 'item')
        .map((resource) => resource._id),
    }),
  );
  return girderRest.post('resource', formData, {
    headers: { 'X-HTTP-Method-Override': 'DELETE' },
  });
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function getAttributes(datasetId = ''): Promise<Attribute[]> {
  const { data } = await girderRest.get('/viame/attribute');
  return data as Attribute[];
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function setAttribute(datasetId = '', { addNew, data }:
   {addNew: boolean | undefined; data: Attribute}): Promise<Attribute[]> {
  if (addNew) {
    return girderRest.post('/viame/attribute', data);
  }
  return girderRest.put(
    `/viame/attribute/${data._id}`,
    data,
  );
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function deleteAttribute(datasetId = '', data: Attribute): Promise<Attribute> {
  return girderRest.delete(
    `/viame/attribute/${data._id}`,
  );
}


async function getPipelineList() {
  const { data } = await girderRest.get<Pipelines>('viame/pipelines');
  return data;
}

function runPipeline(itemId: string, pipeline: Pipe) {
  return girderRest.post('/viame/pipeline', null, {
    params: {
      folderId: itemId,
      pipeline,
    },
  });
}

async function getTrainingConfigurations(): Promise<TrainingConfigs> {
  const { data } = await girderRest.get<TrainingConfigs>('/viame/training_configs');
  return data;
}

function runTraining(folderIds: string[], pipelineName: string, config: string) {
  return girderRest.post('/viame/train', folderIds, { params: { pipelineName, config } });
}

function saveMetadata(folderId: string, metadata: object) {
  return girderRest.put(
    `/folder/${folderId}/metadata?allowNull=true`,
    metadata,
  );
}

function postProcess(folderId: string) {
  return girderRest.post(`viame/postprocess/${folderId}`);
}

async function validateUploadGroup(names: string[]): Promise<ValidationResponse> {
  const { data } = await girderRest.post<ValidationResponse>('viame/validate_files', names);
  return data;
}

async function getValidWebImages(folderId: string) {
  const { data } = await girderRest.get<GirderModel[]>('viame/valid_images', {
    params: { folderId },
  });
  return data;
}


export {
  getBrandData,
  deleteResources,
  getAttributes,
  setAttribute,
  deleteAttribute,
  getPipelineList,
  makeViameFolder,
  postProcess,
  runPipeline,
  getTrainingConfigurations,
  runTraining,
  saveMetadata,
  validateUploadGroup,
  getValidWebImages,
};
