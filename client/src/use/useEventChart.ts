
import { computed, Ref } from '@vue/composition-api';
import Track, { TrackId } from '../track';
import { TypeStyling } from './useStyling';

interface EventChartParams {
  enabledTracks: Readonly<Ref<readonly Track[]>>;
  selectedTrackId: Ref<TrackId | null>;
  typeStyling: Ref<TypeStyling>;
}

interface EventChartData {
  trackId: TrackId;
  name: string;
  color: string;
  selected: boolean;
  range: [number, number];
  markers: [number, boolean][];
}

export default function useEventChart({
  enabledTracks, selectedTrackId, typeStyling,
}: EventChartParams) {
  const eventChartData = computed(() => {
    const values = [] as EventChartData[];
    const mapfunc = typeStyling.value.color;
    const selectedTrackIdValue = selectedTrackId.value;
    /* use forEach rather than filter().map() to save an interation */
    enabledTracks.value.forEach((track) => {
      const { confidencePairs } = track;
      if (confidencePairs.length) {
        const type = track.getType();
        const trackType = type ? type[0] : '';
        values.push({
          trackId: track.trackId,
          name: `Track ${track.trackId}`,
          color: mapfunc(trackType),
          selected: track.trackId === selectedTrackIdValue,
          range: [track.begin, track.end],
          markers: track.featureIndex.map((i) => (
            [i, track.features[i].interpolate || false])),
        });
      }
    });
    return {
      muted: selectedTrackIdValue !== null,
      values,
    };
  });

  return { eventChartData };
}
