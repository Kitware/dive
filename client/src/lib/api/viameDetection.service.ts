import girderRest from '@/girder';

interface ExportUrlsResponse {
  mediaType: string;
  exportAllUrl: string;
  exportMediaUrl: string;
  exportDetectionsUrl: string;
}

async function getExportUrls(id: string) {
  const { data } = await girderRest.get(`viame_detection/${id}/export`);
  return data as ExportUrlsResponse;
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

interface ClipMetaResponse {
  videoUrl: string;
}

async function getClipMeta(folderId: string) {
  const { data } = await girderRest.get('viame_detection/clip_meta', {
    params: { folderId },
  });
  return data as ClipMetaResponse;
}

export {
  getClipMeta,
  getExportUrls,
  getDetections,
  saveDetections,
};
