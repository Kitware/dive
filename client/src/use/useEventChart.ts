
import { computed, Ref } from '@vue/composition-api';
import Track, { TrackId } from '@/lib/track';
import { TypeStyling } from './useStyling';


interface EventChartParams {
  enabledTrackIds: Readonly<Ref<readonly TrackId[]>>;
  selectedTrackId: Ref<TrackId | null>;
  trackMap: Map<TrackId, Track>;
  typeStyling: Ref<TypeStyling>;
}

interface EventChartData {
  trackId: TrackId;
  name: string;
  color: string;
  selected: boolean;
  range: [number, number];
}

export default function useEventChart({
  enabledTrackIds, selectedTrackId, trackMap, typeStyling,
}: EventChartParams) {
  const eventChartData = computed(() => {
    const values = [] as EventChartData[];
    const mapfunc = typeStyling.value.color;
    /* use forEach rather than filter().map() to save an interation */
    enabledTrackIds.value.forEach((trackId) => {
      const track = trackMap.get(trackId);
      if (track === undefined) {
        throw new Error(`Accessed missing track ${trackId}`);
      }
      const { confidencePairs } = track;
      if (confidencePairs.length) {
        const trackType = confidencePairs[0][0];
        values.push({
          trackId,
          name: `Track ${trackId}`,
          color: mapfunc(trackType),
          selected: trackId === selectedTrackId.value,
          range: [track.begin, track.end],
        });
      }
    });
    return values;
  });

  return { eventChartData };
}
