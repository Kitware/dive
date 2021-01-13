import { ref, Ref } from '@vue/composition-api';
import Track, { TrackId } from 'vue-media-annotator/track';
import { useApi, DatasetMetaMutable } from 'viame-web-common/apispec';

export default function useSave(datasetId: Ref<Readonly<string>>) {
  const pendingSaveCount = ref(0);
  const pendingChangeMap = {
    upsert: new Map<TrackId, Track>(),
    delete: new Set<TrackId>(),
    meta: 0,
  };
  const { saveDetections, saveMetadata } = useApi();

  async function save(
    datasetMeta?: DatasetMetaMutable,
  ) {
    const promiseList: Promise<unknown>[] = [];
    if (pendingChangeMap.upsert.size || pendingChangeMap.delete.size) {
      promiseList.push(saveDetections(datasetId.value, {
        upsert: Array.from(pendingChangeMap.upsert).map((pair) => pair[1].serialize()),
        delete: Array.from(pendingChangeMap.delete),
      }).then(() => {
        pendingChangeMap.upsert.clear();
        pendingChangeMap.delete.clear();
      }));
    }
    if (datasetMeta && pendingChangeMap.meta > 0) {
      promiseList.push(saveMetadata(datasetId.value, datasetMeta).then(() => {
        pendingChangeMap.meta = 0;
      }));
    }
    await Promise.all(promiseList);
    pendingSaveCount.value = 0;
  }

  function markChangesPending(
    type: 'upsert' | 'delete' | 'meta' = 'meta',
    track?: Track,
  ) {
    if (type === 'delete' && track !== undefined) {
      pendingChangeMap.delete.add(track.trackId);
      pendingChangeMap.upsert.delete(track.trackId);
    } else if (type === 'upsert' && track !== undefined) {
      pendingChangeMap.delete.delete(track.trackId);
      pendingChangeMap.upsert.set(track.trackId, track);
    } else if (type === 'meta') {
      pendingChangeMap.meta += 1;
    } else {
      throw new Error('Arguments inconsistent with pending change type');
    }
    pendingSaveCount.value += 1;
  }

  return { save, markChangesPending, pendingSaveCount };
}
