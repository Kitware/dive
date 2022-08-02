
import { computed, Ref } from '@vue/composition-api';
import type { AnnotationWithContext } from '../BaseFilterControls';
import type { TypeStyling } from '../StyleManager';
import BaseAnnotation, { AnnotationId } from '../BaseAnnotation';
import type Group from '../Group';
import type Track from '../track';

interface EventChartParams<T extends BaseAnnotation> {
  enabledTracks: Readonly<Ref<AnnotationWithContext<OneOf<T, [Group, Track]>>[]>>;
  selectedTrackIds: Ref<AnnotationId[]>;
  typeStyling: Ref<TypeStyling>;
}

export interface EventChartData {
  id: AnnotationId;
  name: string;
  type: string;
  color: string;
  selected: boolean;
  range: [number, number];
  markers: [number, boolean][];
}

export default function useEventChart<T extends BaseAnnotation>({
  enabledTracks, selectedTrackIds, typeStyling,
}: EventChartParams<T>) {
  const eventChartData = computed(() => {
    const values = [] as EventChartData[];
    const mapfunc = typeStyling.value.color;
    const selectedTrackIdsValue = selectedTrackIds.value;
    /* use forEach rather than filter().map() to save an interation */
    enabledTracks.value.forEach((filtered) => {
      const { annotation: track } = filtered;
      const { confidencePairs } = track;
      let markers: [number, boolean][] = [];
      if ('featureIndex' in track) {
        markers = track.featureIndex.map((i) => (
          [i, track.features[i].interpolate || false]));
      }
      if (confidencePairs.length) {
        const trackType = track.getType(filtered.context.confidencePairIndex)[0];
        values.push({
          id: track.id,
          name: `Track ${track.id}`,
          type: trackType,
          color: mapfunc(trackType),
          selected: selectedTrackIdsValue.includes(track.id),
          range: [track.begin, track.end],
          markers,
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
