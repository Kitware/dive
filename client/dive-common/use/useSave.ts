import { readonly, ref, Ref } from 'vue';

import Track, { TrackId } from 'vue-media-annotator/track';
import { Attribute } from 'vue-media-annotator/use/AttributeTypes';

import { useApi, DatasetMetaMutable } from 'dive-common/apispec';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import Group from 'vue-media-annotator/Group';
import { AttributeTrackFilter } from 'vue-media-annotator/AttributeTrackFilterControls';

interface ChangeMap {
  upsert: Map<TrackId, Track>;
  delete: Set<TrackId>;
  attributeUpsert: Map<string, Attribute>;
  attributeDelete: Set<string>;
  groupUpsert: Map<AnnotationId, Group>;
  groupDelete: Set<AnnotationId>;
  attributeTrackFilterUpsert: Map<string, AttributeTrackFilter>;
  attributeTrackFilterDelete: Set<string>;

  meta: number;
}
function _updatePendingChangeMap<K, V>(
  key: K,
  value: V,
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
      groupUpsert: new Map<AnnotationId, Group>(),
      groupDelete: new Set<AnnotationId>(),
      attributeTrackFilterUpsert: new Map<string, AttributeTrackFilter>(),
      attributeTrackFilterDelete: new Set<string>(),
      meta: 0,
    },
  };
  const {
    saveDetections, saveMetadata, saveAttributes, saveAttributeTrackFilters,
  } = useApi();

  async function save(
    datasetMeta?: DatasetMetaMutable,
    set?: string,
  ) {
    if (readonlyMode.value) {
      throw new Error('attempted to save in read only mode');
    }
    const promiseList: Promise<unknown>[] = [];
    let globalMetadataUpdated = false;
    Object.entries(pendingChangeMaps).forEach(([camera, pendingChangeMap]) => {
      const saveId = camera === 'singleCam' ? datasetId.value : `${datasetId.value}/${camera}`;
      if (
        pendingChangeMap.upsert.size
      || pendingChangeMap.delete.size
      || pendingChangeMap.groupUpsert.size
      || pendingChangeMap.groupDelete.size
      ) {
        promiseList.push(saveDetections(saveId, {
          tracks: {
            upsert: Array.from(pendingChangeMap.upsert).map((pair) => pair[1].serialize()),
            delete: Array.from(pendingChangeMap.delete),
          },
          groups: {
            upsert: Array.from(pendingChangeMap.groupUpsert).map((pair) => pair[1].serialize()),
            delete: Array.from(pendingChangeMap.groupDelete),
          },
          set,
        }).then(() => {
          pendingChangeMap.upsert.clear();
          pendingChangeMap.delete.clear();
        }));
      }
      if (datasetMeta && pendingChangeMap.meta > 0) {
        // Save once for each camera into their own metadata file
        promiseList.push(saveMetadata(saveId, datasetMeta).then(() => {
          // eslint-disable-next-line no-param-reassign
          pendingChangeMap.meta = 0;
        }));
        // Only update global if there are multiple cameras
        if (saveId !== datasetId.value) {
          globalMetadataUpdated = true;
        }
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
      if (pendingChangeMap.attributeTrackFilterUpsert.size
        || pendingChangeMap.attributeTrackFilterDelete.size) {
        promiseList.push(saveAttributeTrackFilters(datasetId.value, {
          upsert: Array.from(pendingChangeMap.attributeTrackFilterUpsert).map((pair) => pair[1]),
          delete: Array.from(pendingChangeMap.attributeTrackFilterDelete),
        }).then(() => {
          pendingChangeMap.attributeTrackFilterUpsert.clear();
          pendingChangeMap.attributeTrackFilterDelete.clear();
        }));
      }
    });
    // Final save into the multi-cam metadata if multiple cameras exists
    if (globalMetadataUpdated && datasetMeta && pendingChangeMaps) {
      promiseList.push(saveMetadata(datasetId.value, datasetMeta));
    }
    await Promise.all(promiseList);
    pendingSaveCount.value = 0;
  }

  function markChangesPending(
    {
      action,
      track,
      attribute,
      attributeTrackFilter,
      group,
      cameraName = 'singleCam',
    }: {
      action: 'upsert' | 'delete' | 'meta';
      track?: Track;
      attribute?: Attribute;
      attributeTrackFilter?: AttributeTrackFilter;
      group?: Group;
      cameraName?: string;
    } = { action: 'meta' },
  ) {
    // For meta changes we need to indicate to all cameras that there is change.
    // Meta changes are global across all cameras
    if (action === 'meta') {
      Object.values(pendingChangeMaps).forEach((pendingChangeMap) => {
        // eslint-disable-next-line no-param-reassign
        pendingChangeMap.meta += 1;
      });
      pendingSaveCount.value += 1;
    } else if (pendingChangeMaps[cameraName]) {
      const pendingChangeMap = pendingChangeMaps[cameraName];

      if (!readonlyMode.value) {
        if (track !== undefined) {
          _updatePendingChangeMap(
            track.trackId,
            track,
            action,
            pendingChangeMap.upsert,
            pendingChangeMap.delete,
          );
        } else if (attribute !== undefined) {
          _updatePendingChangeMap(
            attribute.key,
            attribute,
            action,
            pendingChangeMap.attributeUpsert,
            pendingChangeMap.attributeDelete,
          );
        } else if (attributeTrackFilter !== undefined) {
          _updatePendingChangeMap(
            attributeTrackFilter.name,
            attributeTrackFilter,
            action,
            pendingChangeMap.attributeTrackFilterUpsert,
            pendingChangeMap.attributeTrackFilterDelete,
          );
        } else if (group !== undefined) {
          _updatePendingChangeMap(
            group.id,
            group,
            action,
            pendingChangeMap.groupUpsert,
            pendingChangeMap.groupDelete,
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
      pendingChangeMap.groupUpsert.clear();
      pendingChangeMap.groupDelete.clear();
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
      groupUpsert: new Map<AnnotationId, Group>(),
      groupDelete: new Set<AnnotationId>(),
      attributeTrackFilterUpsert: new Map<string, AttributeTrackFilter>(),
      attributeTrackFilterDelete: new Set<string>(),
      meta: 0,
    };
  }

  function removeCamera(cameraName: string) {
    if (pendingChangeMaps[cameraName]) {
      delete pendingChangeMaps[cameraName];
    }
  }

  return {
    save,
    markChangesPending,
    discardChanges,
    pendingSaveCount: readonly(pendingSaveCount),
    addCamera,
    removeCamera,
  };
}
