import girderRest from '@/girder';

function deleteResources(resources) {
  const formData = new FormData();
  formData.set(
    'resources',
    JSON.stringify({
      folder: resources
        .filter((resource) => resource._modelType === 'folder')
        .map((resource) => resource._id),
      item: this.selected
        .filter((resource) => resource._modelType === 'item')
        .map((resource) => resource._id),
    }),
  );
  return girderRest.post('resource', formData, {
    headers: { 'X-HTTP-Method-Override': 'DELETE' },
  });
}

function getExportUrl(id, type) {
  return `${girderRest.apiRoot}/viame_detection/${id}/export?type=${type}`;
}

function runConversion(itemId) {
  return girderRest.post(`/viame/conversion?itemId=${itemId}`);
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
  runConversion,
  runPipeline,
  getExportUrl,
  setMetadataForItem,
};
