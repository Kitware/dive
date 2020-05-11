import { computed, inject } from '@vue/composition-api';

export default function useTextLayer({
  filteredDetections,
  selectedTrackId,
  editingTrackId,
  typeColorMap,
}) {
  // TODO: what's the proper way to consume vuetify in a composition function?
  const vuetify = inject('vuetify');

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
        if (_editingTrackId !== null) {
          if (_editingTrackId !== data.detection.track) {
            return '#777777'; // color for other detections when editing
          }
          return vuetify.preset.theme.themes.dark.accent;
        }
        if (data.detection.track === _selectedTrackId) {
          return vuetify.preset.theme.themes.dark.accent;
        }
        return typeColorMap(data.detection.confidencePairs[0][0]);
      },
      offsetY(data) {
        return data.offsetY;
      },
    };
  });

  return { textData, textStyle };
}
