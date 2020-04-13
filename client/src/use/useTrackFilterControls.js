import { groupBy, sortBy } from 'lodash';
import { ref, computed, watch } from '@vue/composition-api';

export default function useFilteredTracks({ detections }) {
  const checkedTracks = ref([]);
  const checkedTypes = ref([]);
  const confidence = ref(0.5);

  const filteredDetections = computed(() => {
    if (!detections.value.length) {
      return null;
    }
    const checkedTracksSet = new Set(checkedTracks.value);
    const checkedTypesSet = new Set(checkedTypes.value);
    return detections.value.filter(
      (detection) => checkedTracksSet.has(detection.track)
        && (detection.confidencePairs.length === 0
          || detection.confidencePairs.find(
            (pair) => pair[1] >= confidence.value && checkedTypesSet.has(pair[0]),
          )),
    );
  });

  const tracks = computed(() => {
    const _detections = detections.value;
    if (!_detections) {
      return [];
    }
    const _tracks = Object.entries(
      groupBy(_detections, (detection) => detection.track),
    ).map(([, detectionsSubarray]) => {
      const { confidencePairs } = detectionsSubarray[0];
      const detectionWithTrackAttribute = detectionsSubarray.find(
        (detection) => detection.trackAttributes,
      );

      return {
        trackId: detectionsSubarray[0].track,
        confidencePairs,
        trackAttributes: detectionWithTrackAttribute
          ? detectionWithTrackAttribute.trackAttributes
          : null,
      };
    });
    return sortBy(_tracks, (track) => track.trackId);
  });

  const types = computed(() => {
    const _tracks = tracks.value;
    if (!_tracks) {
      return [];
    }
    const typeSet = new Set();

    for (let i = 0, n = _tracks.length; i < n; i += 1) {
      const { confidencePairs } = _tracks[i];
      for (let j = 0, m = confidencePairs.length; j < m; j += 1) {
        typeSet.add(confidencePairs[j][0]);
      }
    }

    return Array.from(typeSet);
  });

  watch([tracks, types], ([newTracks, newTypes]) => {
    // TODO: investigate
    // When using watchEffect, this line causes an infinite loop.
    // I like the watch syntax better, but watchEffect should work.
    checkedTracks.value = newTracks.map((t) => t.trackId);
    checkedTypes.value = newTypes;
  });

  return {
    confidence,
    types,
    checkedTracks,
    checkedTypes,
    filteredDetections,
    tracks,
  };
}
