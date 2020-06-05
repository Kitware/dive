import { reactive, toRefs, Ref } from '@vue/composition-api';
import Track, { TrackId } from '@/lib/track';

export type FeaturePointingTarget = 'head' | 'tail' | null;

export interface GeojsonGeometry {
  geometry: {
    coordinates: [number, number];
  };
}

export default function useFeaturePointing({
  selectedTrackId,
  trackMap,
}: {
  selectedTrackId: Ref<TrackId | null>;
  trackMap: Map<TrackId, Track>;
}) {
  const data = reactive({
    featurePointing: false,
    featurePointingTarget: null as FeaturePointingTarget,
  });

  async function toggleFeaturePointing(headortail: FeaturePointingTarget) {
    data.featurePointingTarget = headortail;

    if (selectedTrackId.value === null) {
      data.featurePointing = false;
    } else {
      data.featurePointing = !data.featurePointing;
    }
  }

  /**
   * When a feature point is set, update the selected detection.
   * - if both head and tail are set, we're done.
   * - if only one is set, automatically prepare to collect the other.
   * - when both are set, or when right click or escape are hit, disable feature pointing.
   */
  function featurePointed(frame: number, geojson: GeojsonGeometry) {
    if (selectedTrackId.value === null) {
      throw new Error('Cannot set feaure points without selected track');
    }
    const [x, y] = geojson.geometry.coordinates;
    const track = trackMap.get(selectedTrackId.value);
    if (track === undefined) {
      throw new Error(`Accessed missing track ${selectedTrackId.value}`);
    }
    if (data.featurePointingTarget && selectedTrackId.value) {
      track.setFeature({
        frame,
        [data.featurePointingTarget]: [x.toFixed(0), y.toFixed(0)],
      });
    }
    data.featurePointing = false;
    const feature = track.getFeature(frame);
    if (!feature) {
      return;
    }
    if (data.featurePointingTarget === 'tail') {
      data.featurePointingTarget = 'head';
    } else {
      data.featurePointingTarget = 'tail';
    }
    if ('head' in feature && 'tail' in feature) {
      data.featurePointing = false;
    } else {
      data.featurePointing = true;
    }
  }

  function deleteFeaturePoints(frame: number) {
    if (selectedTrackId.value !== null) {
      const track = trackMap.get(selectedTrackId.value);
      if (track === undefined) {
        throw new Error(`Accessed missing track ${selectedTrackId.value}`);
      }
      track.setFeature({
        frame,
        head: undefined,
        tail: undefined,
      });
    }
  }

  return {
    ...toRefs(data),
    toggleFeaturePointing,
    featurePointed,
    deleteFeaturePoints,
  };
}
