import { readonly, ref, Ref } from '@vue/composition-api';

import Track, { TrackId } from 'vue-media-annotator/track';
import { Attribute } from 'vue-media-annotator/use/useAttributes';

import { useApi, DatasetMetaMutable } from 'dive-common/apispec';

interface ChangeMap {
  upsert: Map<TrackId, Track>;
  delete: Set<TrackId>;
  attributeUpsert: Map<string, Attribute>;
  attributeDelete: Set<string>;
  meta: number;
}
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
  const pendingChangeMaps: Record<string, ChangeMap> = {
    singleCam: {
      upsert: new Map<TrackId, Track>(),
      delete: new Set<TrackId>(),
      attributeUpsert: new Map<string, Attribute>(),
      attributeDelete: new Set<string>(),
      meta: 0,
    },
  };
  const { saveDetections, saveMetadata, saveAttributes } = useApi();

  async function save(
    datasetMeta?: DatasetMetaMutable,
  ) {
    if (readonlyMode.value) {
      throw new Error('attempted to save in read only mode');
    }
    const promiseList: Promise<unknown>[] = [];
    Object.entries(pendingChangeMaps).forEach(([camera, pendingChangeMap]) => {
      const saveId = camera === 'singleCam' ? datasetId.value : `${datasetId.value}/${camera}`;
      if (pendingChangeMap.upsert.size || pendingChangeMap.delete.size) {
        promiseList.push(saveDetections(saveId, {
          upsert: Array.from(pendingChangeMap.upsert).map((pair) => pair[1].serialize()),
          delete: Array.from(pendingChangeMap.delete),
        }).then(() => {
          pendingChangeMap.upsert.clear();
          pendingChangeMap.delete.clear();
        }));
      }
      // because meta changes uses markCheckesPending() they should all be singleCam in multicam
      // This will update the root metadata of multiCam and all other meta updates should be empty.
      if (datasetMeta && pendingChangeMap.meta > 0) {
        promiseList.push(saveMetadata(datasetId.value, datasetMeta).then(() => {
          // eslint-disable-next-line no-param-reassign
          pendingChangeMap.meta = 0;
        }));
      }
      if (pendingChangeMap.attributeUpsert.size || pendingChangeMap.attributeDelete.size) {
        promiseList.push(saveAttributes(saveId, {
          upsert: Array.from(pendingChangeMap.attributeUpsert).map((pair) => pair[1]),
          delete: Array.from(pendingChangeMap.attributeDelete),
        }).then(() => {
          pendingChangeMap.attributeUpsert.clear();
          pendingChangeMap.attributeDelete.clear();
        }));
      }
    });
    await Promise.all(promiseList);
    pendingSaveCount.value = 0;
  }

  function markChangesPending(
    {
      action,
      track,
      attribute,
      cameraName = 'singleCam',
    }: {
      action: 'upsert' | 'delete' | 'meta';
      track?: Track;
      attribute?: Attribute;
      cameraName?: string;
    } = { action: 'meta' },
  ) {
    if (pendingChangeMaps[cameraName]) {
      const pendingChangeMap = pendingChangeMaps[cameraName];

      if (!readonlyMode.value) {
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
    }
  }

  function discardChanges() {
    Object.values(pendingChangeMaps).forEach((pendingChangeMap) => {
      pendingChangeMap.upsert.clear();
      pendingChangeMap.delete.clear();
      pendingChangeMap.attributeUpsert.clear();
      pendingChangeMap.attributeDelete.clear();
      // eslint-disable-next-line no-param-reassign
      pendingChangeMap.meta = 0;
    });
    pendingSaveCount.value = 0;
  }

  function addCamera(cameraName: string) {
    pendingChangeMaps[cameraName] = {

      upsert: new Map<TrackId, Track>(),
      delete: new Set<TrackId>(),
      attributeUpsert: new Map<string, Attribute>(),
      attributeDelete: new Set<string>(),
      meta: 0,

    };
  }

  return {
    save,
    markChangesPending,
    addCamera,
    discardChanges,
    pendingSaveCount: readonly(pendingSaveCount),
  };
}
