import { computed, Ref } from 'vue';
import type { AnnotationWithContext } from '../BaseFilterControls';
import type { TypeStyling } from '../StyleManager';
import BaseAnnotation, { AnnotationId } from '../BaseAnnotation';
import type Track from '../track';
import type { TrackProjection } from '../TrackProjection';
import { Group } from '..';

interface EventChartParams<T extends BaseAnnotation> {
  enabledTracks: Readonly<Ref<AnnotationWithContext<OneOf<T, [Group, Track]>>[]>>;
  selectedTrackIds: Ref<AnnotationId[]>;
  typeStyling: Ref<TypeStyling>;
  getTrackProjection: (id: AnnotationId) => TrackProjection;
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
  enabledTracks, selectedTrackIds, typeStyling, getTrackProjection,
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
      if (selectedTrackIds.value.includes(filtered.annotation.id)) {
        const projection = getTrackProjection(filtered.annotation.id);
        markers = projection.featureIndex.map((i) => (
          [i, projection.features[i]?.interpolate || false]));
      }
      if (confidencePairs.length) {
        const trackType = track.getType(filtered.context.confidencePairIndex);
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
