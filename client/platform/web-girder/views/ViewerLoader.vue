<script lang="ts">
import { defineComponent, toRef } from '@vue/composition-api';

import Viewer from 'viame-web-common/components/Viewer.vue';
import { provideApi } from 'viame-web-common/apispec';

import {
  getAttributes,
  getPipelineList,
  runPipeline,
  saveMetadata,
} from '../api/viame.service';
import {
  getDetections,
  getExportUrls,
  saveDetections,
} from '../api/viameDetection.service';
import useGirderDataset from '../useGirderDataset';

interface Props {
  datasetId: string;
}

/**
 * ViewerLoader is responsible for loading
 * data from girder.
 */
export default defineComponent({
  components: { Viewer },

  // TODO: remove in vue 3
  props: ['datasetId'],

  setup(props: Props, { root }) {
    const {
      frameRate,
      annotatorType,
      imageData,
      videoUrl,
      loadDataset,
    } = useGirderDataset();

    /* intercept dataset load to set store location */
    async function loadMetadata(id: string) {
      const ds = await loadDataset(id);
      root.$store.commit('Location/setLocation', {
        _id: ds.parentId,
        _modelType: ds.parentCollection,
      });
      return ds.meta;
    }

    provideApi({
      getAttributes,
      getPipelineList,
      runPipeline,
      saveMetadata,
      getExportUrls,
      loadDetections: (id: string) => getDetections(id, 'track_json'),
      saveDetections,
      loadMetadata,
    }, toRef(props, 'datasetId'));

    return {
      frameRate,
      annotatorType,
      imageData,
      videoUrl,
    };
  },
})
</script>

<template>
  <Viewer
    :frame-rate="frameRate"
    :annotator-type="annotatorType"
    :image-data="imageData"
    :video-url="videoUrl"
  />
</template>
