import girderRest from '@/girder';

async function getExportUrls(id: string) {
  const { data } = await girderRest.get(`viame_detection/${id}/export`);
  return {
    mediaType: data.mediaType,
    exportAllUrl: data.exportAllUrl,
    exportMediaUrl: data.exportMediaUrl,
    exportDetectionsUrl: data.exportDetectionsUrl,
  };
}

async function getDetections(folderId: string, formatting = 'track_json') {
  const { data } = await girderRest.get('viame_detection', {
    params: { folderId, formatting },
  });
  return data;
}

async function saveDetections(folderId: string, serializable: Object) {
  return girderRest.put('viame_detection', serializable, {
    params: { folderId },
  });
}

export {
  getExportUrls,
  getDetections,
  saveDetections,
};
