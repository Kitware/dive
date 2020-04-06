import { computed, inject } from '@vue/composition-api';

export default function useTextLayer({
  filteredDetections,
  selectedTrackId,
  typeColorMap,
}) {
  // TODO: what's the proper way to consume vuetify in a composition function?
  const vuetify = inject('vuetify');

  const textData = computed(() => {
    if (!filteredDetections.value.length) {
      return null;
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
    return {
      color: (data) => {
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
