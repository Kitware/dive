import { ref } from '@vue/composition-api';
import Track, { TrackId } from 'vue-media-annotator/track';

import { saveDetections } from 'viame-web-common/api/viameDetection.service';
import { setMetadataForFolder } from 'viame-web-common/api/viame.service';

export default function useSave(datasetId: string) {
  const pendingSaveCount = ref(0);
  const pendingChangeMap = {
    upsert: new Map<TrackId, Track>(),
    delete: new Set<TrackId>(),
  };

  async function save(
    datasetMeta?: object,
  ) {
    if (pendingChangeMap.upsert.size || pendingChangeMap.delete.size) {
      await saveDetections(datasetId, {
        upsert: pendingChangeMap.upsert,
        delete: Array.from(pendingChangeMap.delete),
      });
      pendingChangeMap.upsert.clear();
      pendingChangeMap.delete.clear();
    }
    if (datasetMeta) {
      await setMetadataForFolder(datasetId, datasetMeta);
    }
    pendingSaveCount.value = 0;
  }

  function markChangesPending(
    type: 'upsert' | 'delete' | 'other' = 'other',
    track?: Track,
  ) {
    if (type === 'delete' && track !== undefined) {
      pendingChangeMap.delete.add(track.trackId);
      pendingChangeMap.upsert.delete(track.trackId);
    } else if (type === 'upsert' && track !== undefined) {
      pendingChangeMap.delete.delete(track.trackId);
      pendingChangeMap.upsert.set(track.trackId, track);
    } else if (type !== 'other') {
      throw new Error('Arguments inconsistent with pending change type');
    }
    pendingSaveCount.value += 1;
  }

  return { save, markChangesPending, pendingSaveCount };
}
