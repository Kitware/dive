import { SaveDetectionsArgs } from 'dive-common/apispec';
import { TrackData } from 'vue-media-annotator/track';
import girderRest from 'platform/web-girder/plugins/girder';

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

export interface Label {
  _id: string;
  count: number;
  datasets: Record<string, {
    id: string;
    name: string;
    color?: string;
  }>;
}

function loadDetections(folderId: string, revision?: number) {
  const params: Record<string, unknown> = { folderId };
  if (revision !== undefined) {
    params.revision = revision;
  }
  return girderRest.get<{ [key: string]: TrackData }>('dive_annotation', { params });
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
  return girderRest.patch('dive_annotation', {
    upsert: args.upsert,
    delete: args.delete,
  }, {
    params: { folderId },
  });
}

async function getLabels() {
  const response = await girderRest.get<Label[]>('dive_annotation/labels');
  return response;
}

export {
  getLabels,
  loadDetections,
  loadRevisions,
  saveDetections,
};
