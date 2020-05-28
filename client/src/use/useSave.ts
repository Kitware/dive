import { ref } from '@vue/composition-api';
import Track from '@/lib/track';
import { saveDetections } from '@/lib/api/viameDetection.service';
import { TrackId } from '@/use/useTrackStore';

export default function useSave() {
  const pendingSaveCount = ref(0);

  async function save(datasetId: string, trackMap: Map<TrackId, Track>) {
    saveDetections(
      datasetId,
      Array
        .from(trackMap.entries())
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(([_, track]) => track.serialize()),
    );
    pendingSaveCount.value = 0;
  }

  function markChangesPending() {
    pendingSaveCount.value += 1;
  }

  return { save, markChangesPending, pendingSaveCount };
}
