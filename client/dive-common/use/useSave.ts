import { ref, Ref } from '@vue/composition-api';

import Track, { TrackId } from 'vue-media-annotator/track';
import { Attribute } from 'vue-media-annotator/use/useAttributes';

import { useApi, DatasetMetaMutable } from 'dive-common/apispec';

export default function useSave(datasetId: Ref<Readonly<string>>) {
  const pendingSaveCount = ref(0);
  const pendingChangeMap = {
    upsert: new Map<TrackId, Track>(),
    delete: new Set<TrackId>(),
    attributeUpsert: new Map<string, Attribute>(),
    attributeDelete: new Set<string>(),
    meta: 0,
  };
  const { saveDetections, saveMetadata, saveAttributes } = useApi();

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
    if (pendingChangeMap.attributeUpsert.size || pendingChangeMap.attributeDelete.size) {
      promiseList.push(saveAttributes(datasetId.value, {
        upsert: Array.from(pendingChangeMap.attributeUpsert).map((pair) => pair[1]),
        delete: Array.from(pendingChangeMap.attributeDelete),
      }).then(() => {
        pendingChangeMap.attributeUpsert.clear();
        pendingChangeMap.attributeDelete.clear();
      }));
    }
    await Promise.all(promiseList);
    pendingSaveCount.value = 0;
  }

  function markChangesPending(
    {
      type,
      action,
      data,
    }: {
    type: 'track' | 'attribute' | 'meta';
    action?: 'upsert' | 'delete';
    data?: Track | Attribute;
    } = { type: 'meta' },
  ) {
    if (type === 'meta') {
      pendingChangeMap.meta += 1;
    } else if (type === 'track' && data !== undefined && (data as Track).trackId !== undefined) {
      const track = data as Track;
      if (action === 'delete') {
        pendingChangeMap.delete.add(track.trackId);
        pendingChangeMap.upsert.delete(track.trackId);
      } else if (action === 'upsert') {
        pendingChangeMap.delete.delete(track.trackId);
        pendingChangeMap.upsert.set(track.trackId, track);
      }
    } else if (type === 'attribute' && data !== undefined && (data as Attribute)._id !== undefined) {
      const attribute = data as Attribute;
      if (action === 'delete') {
        pendingChangeMap.attributeDelete.add(attribute._id);
        pendingChangeMap.attributeUpsert.delete(attribute._id);
      } else if (action === 'upsert') {
        pendingChangeMap.attributeDelete.delete(attribute._id);
        pendingChangeMap.attributeUpsert.set(attribute._id, attribute);
      }
    } else {
      throw new Error('Arguments inconsistent with pending change type');
    }
    pendingSaveCount.value += 1;
  }

  return { save, markChangesPending, pendingSaveCount };
}
