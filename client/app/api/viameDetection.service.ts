import Track, { TrackData, TrackId } from 'vue-media-annotator/track';

import girderRest from 'app/plugins/girder';

interface ExportUrlsResponse {
  mediaType: string;
  exportAllUrl: string;
  exportMediaUrl: string;
  exportDetectionsUrl: string;
  currentThresholds: Record<string, number>;
}

interface SerializedTrackstore {
  [key: number]: TrackData;
}

async function getExportUrls(
  id: string,
  excludeBelowThreshold: boolean,
): Promise<ExportUrlsResponse> {
  return (await girderRest.get<ExportUrlsResponse>(`viame_detection/${id}/export`, {
    params: { excludeBelowThreshold },
  })).data;
}

async function getDetections(folderId: string, formatting = 'track_json') {
  const { data } = await girderRest.get('viame_detection', {
    params: { folderId, formatting },
  });
  return data as { [key: string]: TrackData };
}

async function saveDetections(folderId: string, args: {
  delete: TrackId[];
  upsert: Map<TrackId, Track>;
}) {
  const serialized = {} as SerializedTrackstore;
  Array.from(args.upsert.entries()).forEach(([id, track]) => {
    serialized[id] = track.serialize();
  });
  return girderRest.put('viame_detection', {
    upsert: serialized,
    delete: args.delete,
  }, {
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
