import { computed } from '@vue/composition-api';

export default function useTextLayer({
  filteredDetections,
  selectedTrackId,
  editingTrackId,
  typeColorMap,
  stateStyling,
}) {
  const textData = computed(() => {
    if (filteredDetections.value.length === 0) {
      return [];
    }
    const data = [];
    filteredDetections.value.forEach((detection) => {
      const { bounds } = detection;
      if (!detection.confidencePairs) {
        return;
      }
      // TODO: this is very expensive to compute
      detection.confidencePairs.forEach(([type, confidence], i) => {
        data.push({
          detection,
          frame: detection.frame,
          text: `${type}: ${confidence.toFixed(2)}`,
          x: bounds[1],
          y: bounds[2],
          offsetY: i * 14,
        });
      });
    });
    return data;
  });

  const textStyle = computed(() => {
    const _selectedTrackId = selectedTrackId.value;
    const _editingTrackId = editingTrackId.value;
    return {
      color: (data) => {
        if (_editingTrackId !== null && _editingTrackId !== data.detection.track) {
          if (stateStyling.disabled.color) {
            return stateStyling.disabled.color;
          }
        }
        if (data.detection.track === _selectedTrackId && stateStyling.selected.color) {
          return stateStyling.selected.color;
        }
        return typeColorMap(data.detection.confidencePairs[0][0]);
      },
      textOpacity: (data) => {
        if (_editingTrackId !== null) {
          if (_editingTrackId !== data.detection.track && stateStyling.disabled.opacity) {
            return stateStyling.disabled.opacity;
          }

          return stateStyling.selected.opacity;
        }

        if (data.detection.track === _selectedTrackId) {
          return stateStyling.selected.opacity;
        }
        return stateStyling.standard.opacity;
      },
      offsetY(data) {
        return data.offsetY;
      },
    };
  });

  return { textData, textStyle };
}
