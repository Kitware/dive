import { GirderModel } from '@girder/components/src';
import {
  Attribute, Pipe, Pipelines, TrainingConfigs,
} from 'viame-web-common/apispec';
import { GirderMetadata, GirderMetadataStatic } from '../constants';
import girderRest from '../plugins/girder';

interface ValidationResponse {
  ok: boolean;
  type: 'video' | 'image-sequence';
  media: string[];
  annotations: string[];
  message: string;
}

/**
 * listDatasets gets static metadata from girder.
 *
 * Important: data loaded in this way will not have had their imageData or videoUrl
 * populated. Outside of viewer, these shoudln't be necessary.
 */
async function listDatasets({
  limit = 50, offset = 0, sort = 'name',
}): Promise<{
  items: GirderMetadata[];
  total: number;
}> {
  // Adjust for -1 (everything) which girder accepts as 0
  const limitAdjusted = limit < 0 ? 0 : limit;
  const { data, headers } = await girderRest.get<GirderModel[]>('viame/dataset', {
    params: { limit: limitAdjusted, offset, sort },
  });
  const datasets: GirderMetadata[] = data.map((d) => ({
    ...d,
    ...(d.meta as GirderMetadataStatic),
    id: d._id,
    imageData: [],
    videoUrl: '',
  }));
  return {
    items: datasets,
    total: parseInt(headers['girder-total-count'], 10),
  };
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
function setAttribute({ addNew, data }:
   {addNew: boolean | undefined; data: Attribute}): Promise<Attribute[]> {
  if (addNew) {
    return girderRest.post('/viame/attribute', data);
  }
  return girderRest.put(
    `/viame/attribute/${data._id}`,
    data,
  );
}

function deleteAttribute(data: Attribute): Promise<Attribute> {
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
  listDatasets,
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
