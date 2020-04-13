import { computed, inject } from '@vue/composition-api';

export default function useMarkerLayer({ filteredDetections, selectedTrackId }) {
  // TODO: what's the proper way to consume vuetify in a composition function?
  const vuetify = inject('vuetify');

  const markerData = computed(() => {
    if (filteredDetections.value.length === 0) {
      return null;
    }
    const data = [];
    filteredDetections.value.forEach((detection) => {
      Object.entries(detection.features).forEach(([key, value]) => {
        data.push({
          detection,
          frame: detection.frame,
          feature: key,
          x: value[0],
          y: value[1],
        });
      });
    });
    return data;
  });

  const markerStyle = computed(() => {
    const _selectedTrackId = selectedTrackId.value;
    return {
      fillColor: (data) => (data.feature === 'head' ? 'orange' : 'blue'),
      radius: 4,
      stroke: (data) => data.detection.track === _selectedTrackId,
      strokeColor: vuetify.preset.theme.themes.dark.accent,
    };
  });

  return { markerData, markerStyle };
}
