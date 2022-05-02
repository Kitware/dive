import type { TrackData } from 'vue-media-annotator/track';
import type { GroupData } from 'vue-media-annotator/Group';
import type { SaveDetectionsArgs } from 'dive-common/apispec';

import girderRest from 'platform/web-girder/plugins/girder';
import { AnnotationsCurrentVersion } from 'platform/desktop/constants';

export interface Revision {
  additions: Readonly<number>;
  deletions: Readonly<number>;
  author_id: Readonly<string>;
  author_name: Readonly<string>;
  created: Readonly<string>;
  dataset: Readonly<string>;
  description: Readonly<string>;
  revision: Readonly<number>;
}

async function loadDetections(folderId: string, revision?: number) {
  const params: Record<string, unknown> = { folderId };
  if (revision !== undefined) {
    params.revision = revision;
  }
  return {
    tracks: (await girderRest.get<TrackData[]>('dive_annotation/track', { params })).data,
    groups: (await girderRest.get<GroupData[]>('dive_annotation/group', { params })).data,
    version: AnnotationsCurrentVersion,
  };
}

function loadRevisions(
  folderId: string,
  limit?: number,
  offset?: number,
  sort?: string,
) {
  return girderRest.get<Revision[]>('dive_annotation/revision', {
    params: {
      folderId, sortdir: -1, limit, offset, sort,
    },
  });
}

function saveDetections(folderId: string, args: SaveDetectionsArgs) {
  return girderRest.patch('dive_annotation', args, {
    params: { folderId },
  });
}

export {
  loadDetections,
  loadRevisions,
  saveDetections,
};
