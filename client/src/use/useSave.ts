import { ref, Ref } from '@vue/composition-api';
import Track, { TrackId } from '@/lib/track';
import { saveDetections } from '@/lib/api/viameDetection.service';
import { setMetadataForFolder } from '@/lib/api/viame.service';

export default function useSave() {
  const pendingSaveCount = ref(0);

  async function saveTypeColors(
    datasetId: string,
    customColors: Ref<Record<string, string>>,
    allTypes: Ref<readonly string[]>,
    typeColorMapper: (type: string) => string,
  ) {
    //We need to remove any unused types in the colors, either deleted or changed
    //Also want to save default colors for reloading
    const typeColors: Record<string, string> = { };
    allTypes.value.forEach((name) => {
      if (!typeColors[name] && customColors.value[name]) {
        typeColors[name] = customColors.value[name];
      } else if (!typeColors[name]) { // Also save ordinal Colors as well
        typeColors[name] = typeColorMapper(name);
      }
    });

    await setMetadataForFolder(datasetId, {
      customTypeColors: typeColors,
    });
  }

  async function save(datasetId: string, trackMap: Map<TrackId, Track>) {
    await saveDetections(
      datasetId,
      trackMap,
    );
    pendingSaveCount.value = 0;
  }

  function markChangesPending() {
    pendingSaveCount.value += 1;
  }


  return {
    save, markChangesPending, pendingSaveCount, saveTypeColors,
  };
}
