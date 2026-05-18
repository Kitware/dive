import type { TrackData } from 'vue-media-annotator/track';
import type { GroupData } from 'vue-media-annotator/Group';
import type { SaveDetectionsArgs } from 'dive-common/apispec';

import girderRest from 'platform/web-girder/plugins/girder';
import { AnnotationsCurrentVersion } from 'platform/desktop/constants';
import { resolveDatasetFolderId } from './multicamResolve';

export interface Revision {
  additions: Readonly<number>;
  deletions: Readonly<number>;
  author_id: Readonly<string>;
  author_name: Readonly<string>;
  created: Readonly<string>;
  dataset: Readonly<string>;
  description: Readonly<string>;
  revision: Readonly<number>;
  set?: Readonly<string>;
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

async function loadDetections(datasetId: string, revision?: number, set?: string) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
  const params: Record<string, unknown> = { folderId };
  if (revision !== undefined) {
    params.revision = revision;
  }
  if (params !== undefined) {
    params.set = set;
  }
  return {
    tracks: (await girderRest.get<TrackData[]>('dive_annotation/track', { params })).data,
    groups: (await girderRest.get<GroupData[]>('dive_annotation/group', { params })).data,
    sets: (await girderRest.get<string[]>('dive_annotation/sets', { params })).data,
    version: AnnotationsCurrentVersion,
  };
}

async function loadRevisions(
  datasetId: string,
  limit?: number,
  offset?: number,
  sort?: string,
  set?: string,
) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
  return girderRest.get<Revision[]>('dive_annotation/revision', {
    params: {
      folderId, sortdir: -1, limit, offset, sort, set,
    },
  });
}

async function saveDetections(datasetId: string, args: SaveDetectionsArgs) {
  const { folderId } = await resolveDatasetFolderId(datasetId);
  return girderRest.patch('dive_annotation', args, {
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
