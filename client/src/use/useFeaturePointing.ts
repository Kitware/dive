import Vue from 'vue';
import { reactive, toRefs, Ref } from '@vue/composition-api';
import Track from '@/lib/track';

type FeaturePointingTarget = 'head' | 'tail' | null;

interface GeojsonGeometry {
  geometry: {
    coordinates: [number, number];
  };
}

export default function useFeaturePointing({
  selectedTrackId,
  trackMap,
}: {
  selectedTrackId: Ref<string>,
  trackMap: Map<string, Track>,
}) {
  const data = reactive({
    featurePointing: false,
    featurePointingTarget: null as FeaturePointingTarget,
  });

  async function toggleFeaturePointing(headortail: FeaturePointingTarget) {
    data.featurePointingTarget = headortail;

    if (selectedTrackId.value === '') {
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
    const [x, y] = geojson.geometry.coordinates;
    const track = trackMap.get(selectedTrackId.value);
    if (data.featurePointingTarget && selectedTrackId.value) {
      track!.setFeature({
        frame,
        [data.featurePointingTarget]: [x.toFixed(0), y.toFixed(0)],
      });
    }
    /* TODO: DANGER: this is highly non-standard
     * this and the nextTick() are here to cause
     * the initialization function inside the EditAnnotationLayer to trip
     */
    data.featurePointing = false;
    Vue.nextTick(() => {
      const feature = track!.getFeature(frame);
      if (data.featurePointingTarget === 'tail') {
        data.featurePointingTarget = 'head';
      } else {
        data.featurePointingTarget = 'tail';
      }
      if ('head' in feature! && 'tail' in feature!) {
        data.featurePointing = false;
      } else {
        data.featurePointing = true;
      }
    });
  }

  function deleteFeaturePoints(frame: number) {
    const track = trackMap.get(selectedTrackId.value);
    track!.setFeature({
      frame,
      head: undefined,
      tail: undefined,
    });
  }

  return {
    ...toRefs(data),
    toggleFeaturePointing,
    featurePointed,
    deleteFeaturePoints,
  };
}
