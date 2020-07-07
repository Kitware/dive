import { ref } from '@vue/composition-api';

import Track, { TrackId } from '@/lib/track';
import { saveDetections } from '@/lib/api/viameDetection.service';
import { setMetadataForFolder } from '@/lib/api/viame.service';

export default function useSave() {
  const pendingSaveCount = ref(0);

  async function save(
    datasetId: string,
    trackMap: Map<TrackId, Track>,
    datasetMeta: object,
  ) {
    await saveDetections(datasetId, trackMap);
    await setMetadataForFolder(datasetId, datasetMeta);
    pendingSaveCount.value = 0;
  }

  function markChangesPending() {
    pendingSaveCount.value += 1;
  }


  return { save, markChangesPending, pendingSaveCount };
}
