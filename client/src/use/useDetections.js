import { ref, inject } from '@vue/composition-api';

export default function useDetections({ markChangesPending }) {
  const girderRest = inject('girderRest');

  const detections = ref([]);

  async function loadDetections(datasetFolderId) {
    const { data } = await girderRest.get('viame_detection', {
      params: { folderId: datasetFolderId },
    });
    detections.value = data
      ? data.map((detection) => Object.freeze(detection))
      : [];
  }

  function setDetection(index, newDetection) {
    markChangesPending();
    detections.value.splice(index, 1, Object.freeze(newDetection));
  }

  function deleteDetection(index) {
    markChangesPending();
    detections.value.splice(index, 1);
  }

  return {
    detections,
    loadDetections,
    setDetection,
    deleteDetection,
  };
}
