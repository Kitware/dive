import { ref, computed } from '@vue/composition-api';

/**
 * @param {{
 *   frame: import("@vue/composition-api").Ref<number>,
 *   detections: import("@vue/composition-api").Ref<Array<{{ track: number, frame: number }}>>,
 * }}
 */
export default function useSelectionControls({
  frame,
  detections,
  deleteDetection,
}) {
  // the currently selected Track
  const selectedTrackId = ref(null);
  // Whether or not selectedTrackId is also being edited.
  const editingTrack = ref(false);

  const selectedDetectionIndex = computed(() => {
    if (selectedTrackId.value === null || frame.value === null) {
      return -1;
    }
    return detections.value.findIndex(
      (detection) => detection.track === selectedTrackId.value
        && detection.frame === frame.value,
    );
  });

  const selectedDetection = computed(() => {
    if (selectedDetectionIndex.value >= 0) {
      return detections.value[selectedDetectionIndex.value];
    }
    return null;
  });

  function selectTrack(trackid) {
    selectedTrackId.value = trackid;
  }

  function setTrackEditMode(trackid, editing = true) {
    selectTrack(trackid);
    editingTrack.value = editing;
  }

  function deleteSelectedDetection() {
    if (selectedDetection.value) {
      deleteDetection(selectedDetectionIndex.value);
    }
  }

  return {
    selectedTrackId,
    selectedDetectionIndex,
    selectedDetection,
    selectTrack,
    setTrackEditMode,
    deleteSelectedDetection,
  };
}
