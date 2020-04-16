
import { computed } from '@vue/composition-api';
import { groupBy, minBy, maxBy } from 'lodash';

export default function useEventChart({ filteredDetections, selectedTrackId, typeColorMap }) {
  const eventChartData = computed(() => {
    if (filteredDetections.value.length === 0) {
      return [];
    }
    return Object.entries(
      groupBy(filteredDetections.value, (detection) => detection.track),
    )
      .filter(([, detections]) => detections[0].confidencePairs.length)
      .map(([name, detections]) => {
        const range = [
          minBy(detections, (detection) => detection.frame).frame,
          maxBy(detections, (detection) => detection.frame).frame,
        ];
        return {
          track: detections[0].track,
          name: `Track ${name}`,
          color: typeColorMap(detections[0].confidencePairs[0][0]),
          selected: detections[0].track === selectedTrackId.value,
          range,
        };
      });
  });

  return { eventChartData };
}
