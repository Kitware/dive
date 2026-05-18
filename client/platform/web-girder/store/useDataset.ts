/* eslint-disable import/prefer-default-export -- singleton composable store */
import type { GirderMetadata } from 'platform/web-girder/constants';
import { ref } from 'vue';
import { getDataset, getDatasetMedia, getFolder } from 'platform/web-girder/api';
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
    const [folder, metaStatic, media] = await Promise.all([
      getFolder(datasetId),
      getDataset(datasetId),
      getDatasetMedia(datasetId),
    ]);
    const dsMeta: GirderMetadata = {
      ...metaStatic.data,
      ...media.data,
      videoUrl: media.data.video?.url,
    };
    if (dsMeta.type === MultiType) {
      throw new Error('multi is not supported on web yet');
    }
    setMeta(dsMeta);
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
