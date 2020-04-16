import Vue from 'vue';
import { reactive, toRefs } from '@vue/composition-api';

export default function useFeaturePointing({
  selectedTrackId,
  selectedDetectionIndex,
  selectedDetection,
  setDetection,
}) {
  const data = reactive({
    featurePointing: false,
    featurePointingTarget: null, // oneof ['head', 'tail']
  });

  async function toggleFeaturePointing(headortail) {
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
  function featurePointed(geojson) {
    const [x, y] = geojson.geometry.coordinates;
    const newDetection = {
      ...selectedDetection.value,
      features: {
        ...selectedDetection.value.features,
        [data.featurePointingTarget]: [x.toFixed(0), y.toFixed(0)],
      },
    };
    setDetection(selectedDetectionIndex.value, newDetection);
    /* TODO: DANGER: this is highly non-standard
     * this and the nextTick() are here to cause
     * the initialization function inside the EditAnnotationLayer to trip
     */
    data.featurePointing = false;
    Vue.nextTick(() => {
      if (data.featurePointingTarget === 'tail') {
        data.featurePointingTarget = 'head';
      } else {
        data.featurePointingTarget = 'tail';
      }
      if ('head' in newDetection.features && 'tail' in newDetection.features) {
        data.featurePointing = false;
      } else {
        data.featurePointing = true;
      }
    });
  }

  function deleteFeaturePoints() {
    setDetection(selectedDetectionIndex.value, {
      ...selectedDetection.value,
      features: {},
    });
  }

  return {
    ...toRefs(data),
    toggleFeaturePointing,
    featurePointed,
    deleteFeaturePoints,
  };
}
