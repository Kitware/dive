
import {
  computed,
  ref, Ref, set as VueSet,
} from '@vue/composition-api';

// Expecting this may be a placeholder for more complicated client side enhancements
// or more image filters
export interface ImageEnhancements {
    blackPoint?: number;
    whitePoint?: number;
  }


export default function useImageEnhancements() {
  const imageEnhancements: Ref<ImageEnhancements> = ref({});

  const setSVGFilters = ({ blackPoint, whitePoint }:
    {blackPoint?: number; whitePoint?: number }) => {
    VueSet(imageEnhancements.value, 'blackPoint', blackPoint);
    VueSet(imageEnhancements.value, 'whitePoint', whitePoint);
  };

  const brightness = computed(() => {
    if (imageEnhancements.value.blackPoint !== undefined
        && imageEnhancements.value.whitePoint !== undefined) {
      return (1 / (imageEnhancements.value.whitePoint - imageEnhancements.value.blackPoint));
    }
    return undefined;
  });
  const intercept = computed(() => {
    if (imageEnhancements.value.blackPoint !== undefined
        && imageEnhancements.value.whitePoint !== undefined) {
      return (-imageEnhancements.value.blackPoint
        / (imageEnhancements.value.whitePoint - imageEnhancements.value.blackPoint));
    }
    return undefined;
  });

  return {
    imageEnhancements,
    brightness,
    intercept,
    setSVGFilters,
  };
}
