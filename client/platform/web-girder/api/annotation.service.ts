import { SaveDetectionsArgs } from 'dive-common/apispec';
import { TrackData } from 'vue-media-annotator/track';
import girderRest from 'platform/web-girder/plugins/girder';

function loadDetections(folderId: string, revision?: number) {
  const params: Record<string, unknown> = { folderId };
  if (revision !== undefined) {
    params.revision = revision;
  }
  return girderRest.get<{ [key: string]: TrackData }>('dive_annotation', { params });
}

function saveDetections(folderId: string, args: SaveDetectionsArgs) {
  return girderRest.patch('dive_annotation', {
    upsert: args.upsert,
    delete: args.delete,
  }, {
    params: { folderId },
  });
}

export {
  loadDetections,
  saveDetections,
};
