import girderRest from '@/girder';

function makeViameFolder({
  folderId, name, fps, type,
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

function deleteResources(resources) {
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

function runVideoConversion(itemId) {
  return girderRest.post(
    '/viame/conversion',
    null,
    {
      params: { itemId },
    },
  );
}

function runImageConversion(folder) {
  return girderRest.post(
    '/viame/image_conversion',
    null,
    {
      params: { folder },
    },
  );
}

function runPipeline(itemId, pipeline) {
  return girderRest.post(
    `/viame/pipeline?folderId=${itemId}&pipeline=${pipeline}`,
  );
}

function setMetadataForItem(itemId, metadata) {
  return girderRest.put(
    `/item/${itemId}/metadata?allowNull=true`,
    metadata,
  );
}

export {
  deleteResources,
  makeViameFolder,
  runImageConversion,
  runVideoConversion,
  runPipeline,
  setMetadataForItem,
};
