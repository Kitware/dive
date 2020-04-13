import { ref, computed } from '@vue/composition-api';
import { boundToGeojson } from '@/utils';
/**
 * @param {{
 *   frame: import("@vue/composition-api").Ref<number>,
 *   detections: import("@vue/composition-api").Ref<Array<{{ track: number, frame: number }}>>,
 * }}
 */
export default function useSelectionControls({
  frame,
  detections,
  tracks,
  deleteDetection,
}) {
  // the currently selected Track
  const selectedTrackId = ref(null);
  // Whether or not selectedTrackId is also being edited.
  const editingTrackId = ref(null);

  const selectedTrack = computed(() => {
    if (selectedTrackId.value) {
      return tracks.value.find((t) => t.trackId === selectedTrackId.value);
    }
    return null;
  });

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

  const editingDetection = computed(() => {
    if (editingTrackId.value) {
      return selectedDetection.value;
    }
    return null;
  });

  const editingDetectionGeojson = computed(() => {
    if (editingDetection.value) {
      return boundToGeojson(editingDetection.value.bounds);
    }
    return null;
  });

  function selectTrack(trackid) {
    selectedTrackId.value = trackid;
  }

  function setTrackEditMode(trackid, editing = true) {
    selectTrack(trackid);
    editingTrackId.value = editing;
  }

  function deleteSelectedDetection() {
    if (selectedDetection.value) {
      deleteDetection(selectedDetectionIndex.value);
    }
  }

  return {
    editingTrackId,
    editingDetection,
    editingDetectionGeojson,
    selectedTrack,
    selectedTrackId,
    selectedDetectionIndex,
    selectedDetection,
    selectTrack,
    setTrackEditMode,
    deleteSelectedDetection,
  };
}
