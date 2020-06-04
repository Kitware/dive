import girderRest from '@/girder';
import Track, { TrackData, TrackId } from '@/lib/track';

interface ExportUrlsResponse {
  mediaType: string;
  exportAllUrl: string;
  exportMediaUrl: string;
  exportDetectionsUrl: string;
}

interface SerializedTrackstore {
  [key: number]: TrackData;
}

async function getExportUrls(id: string) {
  const { data } = await girderRest.get(`viame_detection/${id}/export`);
  return data as ExportUrlsResponse;
}

async function getDetections(folderId: string, formatting = 'track_json') {
  const { data } = await girderRest.get('viame_detection', {
    params: { folderId, formatting },
  });
  return data as { [key: string]: TrackData };
}

async function saveDetections(folderId: string, trackMap: Map<TrackId, Track>) {
  const serialized = {} as SerializedTrackstore;
  Array.from(trackMap.entries()).forEach(([id, track]) => {
    serialized[id] = track.serialize();
  });
  return girderRest.put('viame_detection', serialized, {
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
