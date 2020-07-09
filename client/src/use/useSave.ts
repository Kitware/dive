import Vue from 'vue';
import { ref, computed } from '@vue/composition-api';

import Track, { TrackId } from '@/lib/track';
import { saveDetections } from '@/lib/api/viameDetection.service';
import { setMetadataForFolder } from '@/lib/api/viame.service';

export default function useSave() {
  const pendingSaveCountMap = ref({ default: 0 } as Record<string, number>);

  const pendingSaveCount = computed(() => Object.values(pendingSaveCountMap.value)
    .reduce((p, c) => p + c, 0));

  async function save(
    datasetId: string,
    trackMap: Map<TrackId, Track>,
    datasetMeta: object,
  ) {
    if (pendingSaveCountMap.value.default) {
      await saveDetections(datasetId, trackMap);
    }
    if (pendingSaveCountMap.value.meta) {
      await setMetadataForFolder(datasetId, datasetMeta);
    }
    pendingSaveCountMap.value = { default: 0 };
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
