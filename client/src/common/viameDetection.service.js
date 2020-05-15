import girderRest from '@/girder';

async function getExportUrls(id) {
  const { data } = await girderRest.get(`viame_detection/${id}/export`);
  return {
    mediaType: data.mediaType,
    exportAllUrl: data.exportAllUrl,
    exportMediaUrl: data.exportMediaUrl,
    exportDetectionsUrl: data.exportDetectionsUrl,
  };
}

export {
  // eslint-disable-next-line import/prefer-default-export
  getExportUrls,
};
