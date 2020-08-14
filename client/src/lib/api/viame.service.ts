import girderRest from '@/plugins/girder';

interface GirderModel {
  _id: string;
  _modelType: 'folder' | 'item' | 'file' | 'user';
  name: string;
}

interface Attribute {
  belongs: 'track' | 'detection';
  datatype: 'text' | 'number' | 'boolean';
  name: string;
  _id: string;
}

interface Pipe {
  name: string;
  pipe: string;
  type: string;
}

interface ValidationResponse {
  ok: boolean;
  type: 'video' | 'image-sequence';
  media: string[];
  annotations: string[];
  message: string;
}

export interface Category {
  description: string;
  pipes: [Pipe];
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

function getPipelineList() {
  return girderRest.get<Record<string, Category>>('viame/pipelines');
}

function runPipeline(itemId: string, pipeline: string) {
  return girderRest.post(
    `/viame/pipeline?folderId=${itemId}&pipeline=${pipeline}`,
  );
}

function runTraining(folder: GirderModel, pipelineName: string) {
  return girderRest.post('/viame/train', null, { params: { folderId: folder._id, pipelineName } });
}

function setMetadataForItem(itemId: string, metadata: object) {
  return girderRest.put(
    `/item/${itemId}/metadata?allowNull=true`,
    metadata,
  );
}

function setMetadataForFolder(folderId: string, metadata: object) {
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
  const { data } = await girderRest.get('viame/valid_images', {
    params: { folderId },
  });
  return data;
}


export {
  Attribute,
  GirderModel,
  deleteResources,
  getAttributes,
  getPipelineList,
  makeViameFolder,
  postProcess,
  runPipeline,
  runTraining,
  setMetadataForItem,
  setMetadataForFolder,
  validateUploadGroup,
  getValidWebImages,
};
