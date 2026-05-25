/* eslint-disable import/prefer-default-export -- singleton composable store */
import type { GirderMetadata } from 'platform/web-girder/constants';
import { ref } from 'vue';
import {
  getDataset, getDatasetMedia, getFolder, resolveDatasetFolderId,
} from 'platform/web-girder/api';
import { MultiType } from 'dive-common/constants';

import { useLocation } from './useLocation';

const meta = ref<GirderMetadata | null>(null);

export function useDataset() {
  function getMeta(): GirderMetadata | null {
    return meta.value;
  }

  function setMeta(dataset: GirderMetadata | null): void {
    meta.value = dataset;
  }

  async function loadDataset(datasetId: string): Promise<GirderMetadata> {
    const { folderId, compositeId } = await resolveDatasetFolderId(datasetId);
    const [folder, metaStatic, media] = await Promise.all([
      getFolder(folderId),
      getDataset(datasetId),
      getDatasetMedia(datasetId),
    ]);
    const dsMeta: GirderMetadata = {
      ...metaStatic.data,
      ...media.data,
      id: compositeId ?? metaStatic.data.id,
      videoUrl: media.data.video?.url,
    };
    if (dsMeta.type === MultiType && !compositeId) {
      dsMeta.multiCamMedia = metaStatic.data.multiCamMedia;
      dsMeta.imageData = [];
      dsMeta.videoUrl = undefined;
    }
    // Only update the shared store for the parent dataset. Per-camera composite
    // loads (parentId/cameraName) must not overwrite multicam metadata used by
    // ViewerLoader pipeline filters and other chrome.
    if (!compositeId) {
      setMeta(dsMeta);
    } else if (!meta.value && metaStatic.data.type === MultiType) {
      // Landing on a camera URL first: prime parent meta so pipeline filters see subType.
      setMeta({
        ...metaStatic.data,
        imageData: [],
        videoUrl: undefined,
      });
    }
    const { parentId, parentCollection } = folder.data;
    if (parentId && parentCollection) {
      await useLocation().hydrate({
        _id: parentId,
        _modelType: parentCollection,
      });
    } else {
      throw new Error(`dataset ${datasetId} was not a valid girder folder`);
    }
    return dsMeta;
  }

  return {
    meta,
    getMeta,
    setMeta,
    loadDataset,
  };
}
