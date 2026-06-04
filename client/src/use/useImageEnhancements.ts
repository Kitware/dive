import {
  computed,
  ref, Ref, set as VueSet,
} from 'vue';

export interface PercentileStretch {
  lowPercentile: number;
  highPercentile: number;
}

// Expecting this may be a placeholder for more complicated client side enhancements
// or more image filters
export interface ImageEnhancements {
    brightness: number;
    contrast: number;
    saturation: number;
    sharpen: number;
    percentileStretch?: PercentileStretch;
  }

export interface ImageEnhancementOutputs {
    brightness: { slope: number; intercept: number };
    contrast: { slope: number; intercept: number };
    saturation: { values: number };
    sharpen: { kernelMatrix: string; divisor: number };
  }

export const defaultImageEnhancements: ImageEnhancements = {
  brightness: 1,
  contrast: 1,
  saturation: 1,
  sharpen: 0,
};

export function computeOutputs(enh: ImageEnhancements): ImageEnhancementOutputs {
  const s = enh.sharpen;
  const center = 1 + 4 * s;
  const kernel = [0, -s, 0, -s, center, -s, 0, -s, 0].map((n) => Number(n).toFixed(4)).join(' ');
  return {
    brightness: { slope: enh.brightness, intercept: 0 },
    contrast: { slope: enh.contrast, intercept: 0.5 - 0.5 * enh.contrast },
    saturation: { values: enh.saturation },
    sharpen: { kernelMatrix: kernel, divisor: 1 },
  };
}

export function computeIsDefault(enh: ImageEnhancements): boolean {
  return (
    enh.brightness === 1
    && enh.contrast === 1
    && enh.saturation === 1
    && enh.sharpen === 0
    && enh.percentileStretch == null
  );
}

export default function useImageEnhancements() {
  const imageEnhancements: Ref<ImageEnhancements> = ref({ ...defaultImageEnhancements });
  const imageEnhancementsByCamera: Ref<Record<string, ImageEnhancements>> = ref({});

  const setSVGFilters = ({
    brightness, contrast, saturation, sharpen,
  }:
    { brightness: number; contrast: number; saturation: number; sharpen: number }) => {
    VueSet(imageEnhancements.value, 'brightness', brightness);
    VueSet(imageEnhancements.value, 'contrast', contrast);
    VueSet(imageEnhancements.value, 'saturation', saturation);
    VueSet(imageEnhancements.value, 'sharpen', sharpen);
  };

  const imageEnhancementOutputs = computed(() => computeOutputs(imageEnhancements.value));

  const isDefaultImage = computed(() => computeIsDefault(imageEnhancements.value));

  const setImageEnhancements = (enhancements: ImageEnhancements) => {
    imageEnhancements.value = {
      brightness: enhancements.brightness,
      contrast: enhancements.contrast,
      saturation: enhancements.saturation,
      sharpen: enhancements.sharpen,
      percentileStretch: enhancements.percentileStretch
        ? { ...enhancements.percentileStretch }
        : undefined,
    };
  };

  return {
    imageEnhancements,
    imageEnhancementsByCamera,
    imageEnhancementOutputs,
    isDefaultImage,
    setSVGFilters,
    setImageEnhancements,
  };
}
