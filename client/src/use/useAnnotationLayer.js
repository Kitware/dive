import { computed, inject } from '@vue/composition-api';
import { boundToGeojson } from '@/utils';

export default function useAnnotationLayer({
  typeColorMap,
  selectedTrackId,
  filteredDetections,
}) {
  // TODO: what's the proper way to consume vuetify in a composition function?
  const vuetify = inject('vuetify');

  const annotationStyle = computed(() => {
    // consume the values of reactive properties above the function
    // in order to trigger recompute
    const _selectedTrackId = selectedTrackId.value;
    return {
      strokeColor: (a, b, data) => {
        if (data.record.detection.track === _selectedTrackId) {
          return vuetify.preset.theme.themes.dark.accent;
        }
        if (data.record.detection.confidencePairs.length) {
          return typeColorMap(data.record.detection.confidencePairs[0][0]);
        }
        return typeColorMap.range()[0];
      },
      strokeOpacity: (a, b, data) => (data.record.detection.track === _selectedTrackId ? 0.5 : 1),
      strokeWidth: (a, b, data) => (data.record.detection.track === _selectedTrackId ? 4 : 1),
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
