
import {
  computed,
  ref, Ref, set as VueSet,
} from '@vue/composition-api';

export interface ImageEnhancements {
    blackPoint?: number;
    whitePoint?: number;
  }

  /**
   * Modified markChangesPending for image Enhancments specifically
   */
  interface ImageEnhancementParams {
    markChangesPending: () => void;
  }


export default function useImageEnhancements({ markChangesPending }: ImageEnhancementParams) {
  const imageEnhancements: Ref<ImageEnhancements> = ref({});


  function loadImageEnhancements(metadataEnhancements: ImageEnhancements) {
    imageEnhancements.value = metadataEnhancements;
  }

  const setSVGFilters = ({ blackPoint, whitePoint }:
    {blackPoint?: number; whitePoint?: number }) => {
    VueSet(imageEnhancements.value, 'blackPoint', blackPoint);
    VueSet(imageEnhancements.value, 'whitePoint', whitePoint);
    markChangesPending();
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
    loadImageEnhancements,
  };
}
