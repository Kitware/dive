import girderRest from '@/girder';

interface GirderModel {
  _id: string;
  _modelType: 'folder' | 'item' | 'file';
  name: string;
}

function makeViameFolder({
  folderId, name, fps, type,
}: {
  folderId: string,
  name: string,
  fps: number,
  type: string,
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
  return girderRest.get('viame/pipelines');
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

export {
  deleteResources,
  getPipelineList,
  makeViameFolder,
  runImageConversion,
  runVideoConversion,
  runPipeline,
  setMetadataForItem,
};
