import { GirderModel } from '@girder/components/src';
import { Attribute, Pipelines, TrainingConfigs } from 'viame-web-common/apispec';
import girderRest from '../plugins/girder';

interface ValidationResponse {
  ok: boolean;
  type: 'video' | 'image-sequence';
  media: string[];
  annotations: string[];
  message: string;
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

async function getAttributes(): Promise<Attribute[]> {
  const { data } = await girderRest.get('/viame/attribute');
  return data as Attribute[];
}

async function getPipelineList() {
  const { data } = await girderRest.get<Pipelines>('viame/pipelines');
  return data;
}

function runPipeline(itemId: string, pipeline: string) {
  return girderRest.post(
    `/viame/pipeline?folderId=${itemId}&pipeline=${pipeline}`,
  );
}

async function getTrainingConfigurations(): Promise<TrainingConfigs> {
  const { data } = await girderRest.get<TrainingConfigs>('/viame/training_configs');
  return data;
}

function runTraining(folderId: string, pipelineName: string, config: string) {
  return girderRest.post('/viame/train', null, { params: { folderId, pipelineName, config } });
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
  deleteResources,
  getAttributes,
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
