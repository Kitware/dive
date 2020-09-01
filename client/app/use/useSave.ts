import Vue from 'vue';
import { ref, computed } from '@vue/composition-api';
import Track, { TrackId } from 'vue-media-annotator/track';

import { saveDetections } from 'app/api/viameDetection.service';
import { setMetadataForFolder } from 'app/api/viame.service';

export default function useSave() {
  const pendingSaveCountMap = ref({ default: 0 } as Record<string, number>);

  const pendingSaveCount = computed(() => Object.values(pendingSaveCountMap.value)
    .reduce((p, c) => p + c, 0));

  async function save(
    datasetId: string,
    trackMap?: Map<TrackId, Track>,
    datasetMeta?: object,
  ) {
    if (trackMap && pendingSaveCountMap.value.default) {
      await saveDetections(datasetId, trackMap);
      Vue.set(pendingSaveCountMap.value, 'default', 0);
    }
    if (datasetMeta && pendingSaveCountMap.value.meta) {
      await setMetadataForFolder(datasetId, datasetMeta);
      Vue.set(pendingSaveCountMap.value, 'meta', 0);
    }
  }

  function markChangesPending(name = 'default') {
    if (name in pendingSaveCountMap.value) {
      pendingSaveCountMap.value[name] += 1;
    } else {
      Vue.set(pendingSaveCountMap.value, name, 1);
    }
  }

  return { save, markChangesPending, pendingSaveCount };
}
