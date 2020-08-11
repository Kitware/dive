import girderRest from 'app/plugins/girder';

interface GirderModel {
  _id: string;
  _modelType: 'folder' | 'item' | 'file';
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
      viame: true,
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

function runVideoConversion(itemId: string) {
  return girderRest.post(
    '/viame/conversion',
    null,
    {
      params: { itemId },
    },
  );
}

function runImageConversion(folder: string) {
  return girderRest.post(
    '/viame/image_conversion',
    null,
    {
      params: { folder },
    },
  );
}

function getPipelineList() {
  return girderRest.get<Record<string, Category>>('viame/pipelines');
}

function runPipeline(itemId: string, pipeline: string) {
  return girderRest.post(
    `/viame/pipeline?folderId=${itemId}&pipeline=${pipeline}`,
  );
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

function getValidFileTypes() {
  return girderRest.get<Record<string, string[]>>('viame/valid_filetypes');
}


export {
  Attribute,
  GirderModel,
  deleteResources,
  getAttributes,
  getPipelineList,
  makeViameFolder,
  runImageConversion,
  runVideoConversion,
  runPipeline,
  setMetadataForItem,
  setMetadataForFolder,
  getValidFileTypes,
};
