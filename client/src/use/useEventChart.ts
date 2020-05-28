
import { computed, Ref } from '@vue/composition-api';
import { TrackId } from '@/lib/track';
import Track from '@/lib/track';

interface EventChartParams {
  enabledTrackIds: Readonly<Ref<readonly TrackId[]>>;
  selectedTrackId: Ref<TrackId>;
  trackMap: Map<TrackId, Track>;
  typeColorMapper: (type: string) => string;
}

interface EventChartData {
  trackId: TrackId;
  name: string;
  color: string;
  selected: boolean;
  range: [number, number];
}

export default function useEventChart({
  enabledTrackIds, selectedTrackId, trackMap, typeColorMapper,
}: EventChartParams) {
  const eventChartData = computed(() => {
    const values = [] as EventChartData[];
    /* use forEach rather than filter().map() to save an interation */
    enabledTrackIds.value.forEach((trackId) => {
      const track = trackMap.get(trackId);
      if (track === undefined) {
        throw new Error(`Accessed missing track ${trackId}`);
      }
      const confidencePairs = track.confidencePairs.value;
      if (confidencePairs.length) {
        const trackType = confidencePairs[0][0];
        values.push({
          trackId,
          name: `Track ${trackId}`,
          color: typeColorMapper(trackType),
          selected: trackId === selectedTrackId.value,
          range: [track.begin.value, track.end.value],
        });
      }
    });
    return values;
  });

  return { eventChartData };
}
