import {
  computed,
  ref, Ref, set as VueSet,
} from 'vue';

export interface PercentileStretch {
  lowPercentile: number;
  highPercentile: number;
}

export interface PercentileHistogram {
  bins: number[];
  lowValue: number;
  highValue: number;
  sourceMin: number;
  sourceMax: number;
}

export interface PercentileStretchMetadata {
  type?: string;
  originalImageFiles?: string[];
  originalLargeImageFile?: string;
}

const tiffExtensions = ['.tif', '.tiff'];

export function isTiffImagePath(path: string): boolean {
  const lower = path.toLowerCase();
  return tiffExtensions.some((ext) => lower.endsWith(ext));
}

/** True when originals are TIFF and the /media/display stretch path can recover range. */
export function metadataSupportsPercentileStretch(meta: PercentileStretchMetadata): boolean {
  if (meta.type === 'large-image' && meta.originalLargeImageFile) {
    return isTiffImagePath(meta.originalLargeImageFile);
  }
  const files = meta.originalImageFiles;
  if (files?.length) {
    return files.some(isTiffImagePath);
  }
  return false;
}

export function effectiveImageEnhancements(
  enh: ImageEnhancements,
  percentileStretchSupported: boolean,
): ImageEnhancements {
  if (percentileStretchSupported || enh.percentileStretch == null) {
    return enh;
  }
  const rest = { ...enh };
  delete rest.percentileStretch;
  return rest;
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

/** Derive percentile cutoff values from a binned histogram (no server round-trip). */
export function computePercentileBoundsFromBins(
  bins: number[],
  lowPercentile: number,
  highPercentile: number,
  sourceMin: number,
  sourceMax: number,
): { lowValue: number; highValue: number } {
  const total = bins.reduce((sum, count) => sum + count, 0);
  if (total === 0) return { lowValue: sourceMin, highValue: sourceMax };

  const lowTarget = Math.floor(total * (lowPercentile / 100));
  const highTarget = Math.floor(total * (highPercentile / 100));
  const binCount = bins.length;

  function binToValue(binIndex: number): number {
    if (sourceMax > 255) return Math.min(sourceMax, binIndex * 256);
    if (sourceMin === 0 && sourceMax <= 255) return binIndex;
    const range = sourceMax - sourceMin;
    return sourceMin + (binCount <= 1 ? 0 : (binIndex / (binCount - 1)) * range);
  }

  let cumulative = 0;
  let lowValue = sourceMin;
  let highValue = sourceMax;
  let foundLow = false;

  for (let i = 0; i < binCount; i += 1) {
    cumulative += bins[i];
    if (!foundLow && cumulative > 0 && cumulative >= lowTarget) {
      lowValue = binToValue(i);
      foundLow = true;
    }
    if (cumulative >= highTarget) {
      highValue = binToValue(i);
      break;
    }
  }

  return { lowValue, highValue };
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
  const percentileStretchSupported: Ref<boolean> = ref(false);
  const percentileHistogram: Ref<PercentileHistogram | null> = ref(null);
  const percentileHistogramLoading: Ref<boolean> = ref(false);

  const setSVGFilters = ({
    brightness, contrast, saturation, sharpen, percentileStretch,
  }: {
    brightness: number;
    contrast: number;
    saturation: number;
    sharpen: number;
    percentileStretch?: PercentileStretch | null;
  }) => {
    VueSet(imageEnhancements.value, 'brightness', brightness);
    VueSet(imageEnhancements.value, 'contrast', contrast);
    VueSet(imageEnhancements.value, 'saturation', saturation);
    VueSet(imageEnhancements.value, 'sharpen', sharpen);
    if (percentileStretch !== undefined) {
      VueSet(
        imageEnhancements.value,
        'percentileStretch',
        percentileStretch ? { ...percentileStretch } : undefined,
      );
    }
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

  const setPercentileStretchSupported = (supported: boolean) => {
    percentileStretchSupported.value = supported;
  };

  const setPercentileHistogram = (hist: PercentileHistogram | null) => {
    percentileHistogram.value = hist;
  };

  const setPercentileHistogramLoading = (loading: boolean) => {
    percentileHistogramLoading.value = loading;
  };

  return {
    imageEnhancements,
    imageEnhancementsByCamera,
    imageEnhancementOutputs,
    isDefaultImage,
    percentileStretchSupported,
    percentileHistogram,
    percentileHistogramLoading,
    setSVGFilters,
    setImageEnhancements,
    setPercentileStretchSupported,
    setPercentileHistogram,
    setPercentileHistogramLoading,
  };
}
