import { ref, inject } from '@vue/composition-api';

export default function useSave() {
  const pendingSaveCount = ref(0);
  const girderRest = inject('girderRest');

  async function save(datasetId, detections) {
    // TODO: refactor to girder client library
    await girderRest.put(`viame_detection?folderId=${datasetId}`, detections.value);
    pendingSaveCount.value = 0;
  }

  function markChangesPending() {
    pendingSaveCount.value += 1;
  }

  return { save, markChangesPending, pendingSaveCount };
}
