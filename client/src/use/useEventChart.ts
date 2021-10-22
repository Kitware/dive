
import { computed, Ref } from '@vue/composition-api';
import { TrackWithContext } from 'vue-media-annotator/use/useTrackFilters';
import { TrackId } from '../track';
import { TypeStyling } from './useStyling';

interface EventChartParams {
  enabledTracks: Readonly<Ref<readonly TrackWithContext[]>>;
  selectedTrackIds: Ref<TrackId[]>;
  typeStyling: Ref<TypeStyling>;
}

interface EventChartData {
  trackId: TrackId;
  name: string;
  type: string;
  color: string;
  selected: boolean;
  range: [number, number];
  markers: [number, boolean][];
}

export default function useEventChart({
  enabledTracks, selectedTrackIds, typeStyling,
}: EventChartParams) {
  const eventChartData = computed(() => {
    const values = [] as EventChartData[];
    const mapfunc = typeStyling.value.color;
    const selectedTrackIdsValue = selectedTrackIds.value;
    /* use forEach rather than filter().map() to save an interation */
    enabledTracks.value.forEach((filtered) => {
      const { track } = filtered;
      const { confidencePairs } = track;
      if (confidencePairs.length) {
        const trackType = track.getType(filtered.context.confidencePairIndex)[0];
        values.push({
          trackId: track.trackId,
          name: `Track ${track.trackId}`,
          type: trackType,
          color: mapfunc(trackType),
          selected: selectedTrackIdsValue.includes(track.trackId),
          range: [track.begin, track.end],
          markers: track.featureIndex.map((i) => (
            [i, track.features[i].interpolate || false])),
        });
      }
    });
    return {
      muted: selectedTrackIdsValue.length > 0,
      values,
    };
  });

  return { eventChartData };
}
