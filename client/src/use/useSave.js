import { ref, inject } from '@vue/composition-api';

export default function useSave() {
  const pendingSave = ref(false); // true indicates dirty save state
  const girderRest = inject('girderRest');

  async function save(datasetId, detections) {
    // TODO: refactor to girder client library
    await girderRest.put(`viame_detection?folderId=${datasetId}`, detections);
    pendingSave.value = false;
  }

  function markChangesPending() {
    pendingSave.value = true;
  }

  return { save, markChangesPending, pendingSave };
}
