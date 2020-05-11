import { computed, inject } from '@vue/composition-api';
import { boundToGeojson } from '@/utils';

export default function useAnnotationLayer({
  typeColorMap,
  selectedTrackId,
  editingTrackId,
  filteredDetections,
}) {
  // TODO: what's the proper way to consume vuetify in a composition function?
  const vuetify = inject('vuetify');

  const annotationStyle = computed(() => {
    // consume the values of reactive properties above the function
    // in order to trigger recompute
    const _selectedTrackId = selectedTrackId.value;
    const _editingTrackId = editingTrackId.value;
    return {
      strokeColor: (a, b, data) => {
        if (_editingTrackId !== null) {
          if (_editingTrackId !== data.record.detection.track) {
            return '#777777'; // color for other objects when editing a detection
          }

          return vuetify.preset.theme.themes.dark.accent;
        }
        if (data.record.detection.track === _selectedTrackId) {
          return vuetify.preset.theme.themes.dark.accent;
        }
        if (data.record.detection.confidencePairs.length) {
          return typeColorMap(data.record.detection.confidencePairs[0][0]);
        }
        return typeColorMap.range()[0];
      },
      strokeOpacity: (a, b, data) => {
        if (_editingTrackId !== null) {
          if (_editingTrackId !== data.record.detection.track) {
            return '0.7';
          }

          return 1.0;
        }

        return (data.record.detection.track === _selectedTrackId ? 1 : 0.5);
      },
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
