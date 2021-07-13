import { ref, Ref } from '@vue/composition-api';

import Track, { TrackId } from 'vue-media-annotator/track';
import { Attribute } from 'vue-media-annotator/use/useAttributes';

import { useApi, DatasetMetaMutable } from 'dive-common/apispec';

function _updatePendingChangeMap<K, V>(
  key: K, value: V,
  action: 'upsert' | 'delete',
  upsert: Map<K, V>,
  del: Set<K>,
) {
  if (action === 'delete') {
    del.add(key);
    upsert.delete(key);
  } else if (action === 'upsert') {
    del.delete(key);
    upsert.set(key, value);
  }
}

export default function useSave(
  datasetId: Ref<Readonly<string>>,
  readonlyMode: Ref<Readonly<boolean>>,
) {
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
    if (readonlyMode.value) {
      throw new Error('attempted to save in read only mode');
    }
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
      action,
      track,
      attribute,
    }: {
      action: 'upsert' | 'delete' | 'meta';
      track?: Track;
      attribute?: Attribute;
    } = { action: 'meta' },
  ) {
    // if (readonlyMode.value) {
    //   throw new Error('attempted to make state changes in read only mode');
    // }
    if (action === 'meta') {
      pendingChangeMap.meta += 1;
    } else if (track !== undefined) {
      _updatePendingChangeMap(
        track.trackId, track, action, pendingChangeMap.upsert, pendingChangeMap.delete,
      );
    } else if (attribute !== undefined) {
      _updatePendingChangeMap(
        attribute.key,
        attribute,
        action,
        pendingChangeMap.attributeUpsert,
        pendingChangeMap.attributeDelete,
      );
    } else {
      throw new Error(`Arguments inconsistent with pending change type: ${action} cannot be performed without additional arguments`);
    }
    pendingSaveCount.value += 1;
  }

  return { save, markChangesPending, pendingSaveCount };
}
