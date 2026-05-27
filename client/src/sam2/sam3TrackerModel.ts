/**
 * SAM3 image embedding — loading and encode path from SAM3-Tracker-WebGPU
 * (onnx-community/sam3-tracker-ONNX via @huggingface/transformers).
 */

/** Hugging Face model id (SAM3-Tracker-WebGPU README / index.html). */
export const SAM3_TRACKER_MODEL_ID = 'onnx-community/sam3-tracker-ONNX';

/** Same dtype map as SAM3-Tracker-WebGPU `loadModel()`. */
export const SAM3_TRACKER_DTYPE = {
  vision_encoder: 'q4',
  prompt_encoder_mask_decoder: 'q4',
} as const;

export type Sam3LoadReport = {
  success: boolean;
  device: string | null;
  /** Set when load succeeded on WASM but WebGPU was not offered by Transformers.js. */
  webGpuUnavailableReason: string | null;
};

/** UI progress from Hugging Face `progress_callback` (0–100). */
export type Sam3LoadProgressUpdate = {
  percent: number;
  statusText?: string;
};

export type Sam3LoadProgressCallback = (update: Sam3LoadProgressUpdate) => void;

/** Transformers.js `ProgressInfo` (subset used for download progress). */
type TransformersProgressInfo = {
  status: string;
  progress?: number;
  file?: string;
};

function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Map Transformers.js file/total progress into a slice of 0–100 for the UI.
 */
function sliceProgressCallback(
  onProgress: Sam3LoadProgressCallback | undefined,
  rangeStart: number,
  rangeSize: number,
  labelPrefix: string,
): ((info: TransformersProgressInfo) => void) | undefined {
  if (!onProgress) return undefined;
  return (info: TransformersProgressInfo) => {
    let fileProgress = 0;
    if (info.status === 'progress_total' || info.status === 'progress') {
      fileProgress = typeof info.progress === 'number' ? info.progress : 0;
    }
    const percent = clampPercent(rangeStart + (fileProgress / 100) * rangeSize);
    const file = info.file ? info.file.split('/').pop() : undefined;
    onProgress({
      percent,
      statusText: file ? `${labelPrefix}: ${file}` : labelPrefix,
    });
  };
}

type Sam3TrackerModelInstance = {
  get_image_embeddings: (processed: unknown) => Promise<Record<string, unknown>>;
};

type Sam3ProcessorInstance = {
  (image: unknown): Promise<unknown>;
};

let transformersModule: typeof import('@huggingface/transformers') | null = null;

async function getTransformers() {
  if (!transformersModule) {
    transformersModule = await import('@huggingface/transformers');
  }
  return transformersModule;
}

/**
 * Same predicate as Transformers.js `env.apis.IS_WEBGPU_AVAILABLE` in the browser
 * (`env.js`: `'gpu' in navigator`). Not exported from the package root, so we mirror it here.
 */
export function isSam3WebGpuAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

/**
 * Why WebGPU is unavailable for SAM3 in this tab (secure context + navigator.gpu).
 */
export function explainSam3WebGpuUnavailable(): string | null {
  if (typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext) {
    return 'WebGPU needs a secure context (HTTPS or http://localhost). Girder over plain HTTP cannot use GPU.';
  }
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return 'navigator.gpu is not available in this browser tab (Electron may need enable-unsafe-webgpu and a full restart).';
  }
  return null;
}

/** Execution providers to try, in order (matches Transformers.js `supportedDevices` in browser). */
export function getSam3DeviceCandidates(): Array<'webgpu' | 'wasm'> {
  const order: Array<'webgpu' | 'wasm'> = [];
  if (isSam3WebGpuAvailable()) {
    order.push('webgpu');
  }
  order.push('wasm');
  return order;
}

async function tryLoadSam3OnDevice(
  device: 'webgpu' | 'wasm',
  onProgress?: Sam3LoadProgressCallback,
): Promise<{
  model: Sam3TrackerModelInstance;
  processor: Sam3ProcessorInstance;
  device: string;
} | null> {
  const { Sam3TrackerModel, AutoProcessor } = await getTransformers();
  const deviceLabel = device === 'webgpu' ? 'WebGPU' : 'WASM';
  try {
    onProgress?.({ percent: 0, statusText: `Downloading model (${deviceLabel})…` });
    const model = await Sam3TrackerModel.from_pretrained(SAM3_TRACKER_MODEL_ID, {
      dtype: SAM3_TRACKER_DTYPE,
      device,
      progress_callback: sliceProgressCallback(onProgress, 0, 80, `Model (${deviceLabel})`),
    }) as Sam3TrackerModelInstance;
    const processor = await AutoProcessor.from_pretrained(SAM3_TRACKER_MODEL_ID, {
      progress_callback: sliceProgressCallback(onProgress, 80, 20, 'Processor'),
    }) as Sam3ProcessorInstance;
    onProgress?.({ percent: 100, statusText: 'Ready' });
    // eslint-disable-next-line no-console
    console.info(`[SAM3] model loaded (${SAM3_TRACKER_MODEL_ID}, device=${device})`);
    return { model, processor, device };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[SAM3] load failed for device=${device}`, e);
    return null;
  }
}

export async function loadSam3Tracker(
  onProgress?: Sam3LoadProgressCallback,
): Promise<{
  model: Sam3TrackerModelInstance;
  processor: Sam3ProcessorInstance;
  device: string;
  webGpuUnavailableReason: string | null;
}> {
  const candidates = getSam3DeviceCandidates();
  if (!candidates.includes('webgpu')) {
    const reason = explainSam3WebGpuUnavailable();
    // eslint-disable-next-line no-console
    console.info('[SAM3] WebGPU not in Transformers.js supported devices; will use WASM.', reason ?? '(unknown)');
  }

  onProgress?.({ percent: 0, statusText: 'Initializing SAM3…' });

  if (candidates.includes('webgpu')) {
    const webgpu = await tryLoadSam3OnDevice('webgpu', onProgress);
    if (webgpu) {
      return { ...webgpu, webGpuUnavailableReason: null };
    }
    onProgress?.({ percent: 0, statusText: 'WebGPU unavailable; retrying on WASM…' });
  }

  const wasm = await tryLoadSam3OnDevice('wasm', onProgress);
  if (wasm) {
    return {
      ...wasm,
      webGpuUnavailableReason: explainSam3WebGpuUnavailable(),
    };
  }

  throw new Error('SAM3 tracker failed to load (no execution provider succeeded)');
}

export default class Sam3Tracker {
  private model: Sam3TrackerModelInstance | null = null;

  private processor: Sam3ProcessorInstance | null = null;

  imageEmbeddings: Record<string, unknown> | null = null;

  imageProcessed: unknown = null;

  device: string | null = null;

  webGpuUnavailableReason: string | null = null;

  async load(onProgress?: Sam3LoadProgressCallback): Promise<Sam3LoadReport> {
    try {
      const loaded = await loadSam3Tracker(onProgress);
      this.model = loaded.model;
      this.processor = loaded.processor;
      this.device = loaded.device;
      this.webGpuUnavailableReason = loaded.webGpuUnavailableReason;
      return {
        success: true,
        device: loaded.device,
        webGpuUnavailableReason: loaded.webGpuUnavailableReason,
      };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[SAM3] load()', e);
      this.model = null;
      this.processor = null;
      this.device = null;
      this.webGpuUnavailableReason = explainSam3WebGpuUnavailable();
      return {
        success: false,
        device: null,
        webGpuUnavailableReason: this.webGpuUnavailableReason,
      };
    }
  }

  async encodeImageFromCanvas(canvas: HTMLCanvasElement): Promise<void> {
    if (!this.model || !this.processor) {
      throw new Error('SAM3 tracker is not loaded');
    }
    const { RawImage } = await getTransformers();
    const url = canvas.toDataURL('image/png');
    const imageInput = await RawImage.fromURL(url);
    const imageProcessed = await this.processor(imageInput);
    this.imageProcessed = imageProcessed;
    // eslint-disable-next-line no-console
    console.info('[SAM3] extracting image embedding…');
    this.imageEmbeddings = await this.model.get_image_embeddings(imageProcessed);
    // eslint-disable-next-line no-console
    console.info('[SAM3] image embedding ready');
  }
}
