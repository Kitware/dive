import { ref } from '@vue/composition-api';
import Track, { TrackId } from '@/lib/track';
import { saveDetections } from '@/lib/api/viameDetection.service';

export default function useSave() {
  const pendingSaveCount = ref(0);

  async function save(datasetId: string, trackMap: Map<TrackId, Track>) {
    saveDetections(
      datasetId,
      Array.from(trackMap.values()).map((track) => track.serialize()),
    );
    pendingSaveCount.value = 0;
  }

  function markChangesPending() {
    pendingSaveCount.value += 1;
  }

  return { save, markChangesPending, pendingSaveCount };
}
