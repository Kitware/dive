import {
  computed,
  ref, Ref, set as VueSet,
} from 'vue';

// Expecting this may be a placeholder for more complicated client side enhancements
// or more image filters
export interface ImageEnhancements {
    brightness: number;
    contrast: number;
    saturation: number;
    sharpen: number
  }

export interface ImageEnhancementOutputs {
    brightness: { slope: number; intercept: number };
    contrast: { slope: number; intercept: number };
    saturation: { values: number };
    sharpen: { kernelMatrix: string; divisor: number };
  }

export default function useImageEnhancements() {
  const imageEnhancements: Ref<ImageEnhancements> = ref({
    brightness: 1,
    contrast: 1,
    saturation: 1,
    sharpen: 0,
  });

  const setSVGFilters = ({
    brightness, contrast, saturation, sharpen,
  }:
    { brightness: number; contrast: number; saturation: number; sharpen: number }) => {
    VueSet(imageEnhancements.value, 'brightness', brightness);
    VueSet(imageEnhancements.value, 'contrast', contrast);
    VueSet(imageEnhancements.value, 'saturation', saturation);
    VueSet(imageEnhancements.value, 'sharpen', sharpen);
  };

  const brightness = computed(() => ({ slope: imageEnhancements.value.brightness, intercept: 0 }));

  const contrast = computed(() => {
    const value = imageEnhancements.value.contrast;
    return { slope: value, intercept: 0.5 - 0.5 * (value) };
  });

  const saturation = computed(() => ({ values: imageEnhancements.value.saturation }));

  const sharpen = computed(() => {
    const s = imageEnhancements.value.sharpen;
    const center = (1 + 4 * s);
    const kernel = [0, -s, 0, -s, center, -s, 0, -s, 0].map((n) => Number(n).toFixed(4)).join(' ');
    return { kernelMatrix: kernel, divisor: 1 };
  });

  const imageEnhancementOutputs = computed(() => ({
    brightness: brightness.value,
    contrast: contrast.value,
    saturation: saturation.value,
    sharpen: sharpen.value,
  }));

  const isDefaultImage = computed(() => (
    imageEnhancements.value.brightness === 1
    && imageEnhancements.value.contrast === 1
    && imageEnhancements.value.saturation === 1
    && imageEnhancements.value.sharpen === 0
  ));

  const setImageEnhancements = (enhancements: ImageEnhancements) => {
    imageEnhancements.value = {
      brightness: enhancements.brightness,
      contrast: enhancements.contrast,
      saturation: enhancements.saturation,
      sharpen: enhancements.sharpen,
    };
  };

  return {
    imageEnhancements,
    imageEnhancementOutputs,
    isDefaultImage,
    setSVGFilters,
    setImageEnhancements,
  };
}
