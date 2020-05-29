import { computed } from '@vue/composition-api';
import { boundToGeojson } from '@/utils';

export default function useAnnotationLayer({
  typeColorMap,
  selectedTrackId,
  editingTrackId,
  filteredDetections,
  stateStyling,
}) {
  const annotationStyle = computed(() => {
    // consume the values of reactive properties above the function
    // in order to trigger recompute
    const _selectedTrackId = selectedTrackId.value;
    const _editingTrackId = editingTrackId.value;
    return {
      strokeColor: (a, b, data) => {
        if (_editingTrackId !== null && _editingTrackId !== data.record.detection.track) {
          if (stateStyling.disabled.color) {
            return stateStyling.disabled.color;
          }
        }
        if (data.record.detection.track === _selectedTrackId && stateStyling.selected.color) {
          return stateStyling.selected.color;
        }
        if (data.record.detection.confidencePairs.length) {
          return typeColorMap(data.record.detection.confidencePairs[0][0]);
        }
        return typeColorMap('');
      },
      strokeOpacity: (a, b, data) => {
        if (_editingTrackId !== null) {
          if (_editingTrackId !== data.record.detection.track && stateStyling.disabled.opacity) {
            return stateStyling.disabled.opacity;
          }

          return stateStyling.selected.opacity;
        }

        if (data.record.detection.track === _selectedTrackId) {
          return stateStyling.selected.opacity;
        }
        return stateStyling.standard.opacity;
      },
      strokeWidth: (a, b, data) => {
        if (_editingTrackId !== null) {
          if (_editingTrackId !== data.record.detection.track
            && stateStyling.disabled.strokeWidth) {
            return stateStyling.disabled.strokeWidth;
          }
        }

        if (data.record.detection.track === _selectedTrackId && stateStyling.selected.strokeWidth) {
          return stateStyling.selected.strokeWidth;
        }
        return stateStyling.standard.strokeWidth;
      },
    };
  });

  const annotationData = computed(() => filteredDetections.value.map((detection) => ({
    // TODO: annotationData doesn't actually use this, maybe stick it in a `meta` property.
    detection,
    frame: detection.frame,
    polygon: boundToGeojson(detection.bounds),
  })));

  return { annotationStyle, annotationData };
}
