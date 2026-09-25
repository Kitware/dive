import type {
  Sam2Model, Sam2Processor, Tensor,
} from '@huggingface/transformers';
import type { SegmentationPredictRequest, SegmentationPredictResponse } from 'dive-common/apispec';
import type { RgbaImage } from '../stereo/image';
import { maskGeometry } from './maskGeometry';
import SamMaskPostprocessor from './SamMaskPostprocessor';

export type SamModel = 'sam2' | 'sam2-small';
/** User preference for where the SAM ONNX session runs. */
export type SamDevicePreference = 'auto' | 'gpu' | 'cpu';
export type SamDevice = 'webgpu' | 'wasm';
export const SAM_MODELS = {
  sam2: 'onnx-community/sam2.1-hiera-tiny-ONNX',
  'sam2-small': 'onnx-community/sam2.1-hiera-small-ONNX',
} as const;
export const SAM_LABELS: Record<SamModel, string> = {
  sam2: 'SAM2.1 Tiny',
  'sam2-small': 'SAM2.1 Small',
};

export function isSamModel(value: unknown): value is SamModel {
  return value === 'sam2' || value === 'sam2-small';
}

export function isSamDevicePreference(value: unknown): value is SamDevicePreference {
  return value === 'auto' || value === 'gpu' || value === 'cpu';
}

/** Host UI phases: download is determinate; prepare/encode/predict are indeterminate. */
export type SamLoadPhase = 'download' | 'prepare' | 'encode' | 'predict';
export interface SamModelProgress {
  phase: SamLoadPhase;
  /** Present only while aggregating Hugging Face file downloads. */
  percent?: number;
  /** Runtime actually used for this status update (preference may differ under auto). */
  device?: 'gpu' | 'cpu';
}
export type SamStatusCallback = (message: string | null, progress?: SamModelProgress) => void;

type EncodedFrame = {
  embeddings: Record<string, Tensor>;
  original: [number, number][];
  reshaped: [number, number][];
  padded: [number, number];
};

type GpuAccess = {
  requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean } | null>;
};

type FileBytes = { loaded: number; total: number };

function navigatorGpu(): GpuAccess | undefined {
  return typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { gpu?: GpuAccess }).gpu;
}

/** True when the browser exposes a hardware WebGPU adapter (not SwiftShader). */
export async function samHardwareGpuAvailable(gpu?: GpuAccess): Promise<boolean> {
  try {
    const adapter = await (gpu ?? navigatorGpu())?.requestAdapter();
    return !!(adapter && !adapter.info?.isFallbackAdapter && !adapter.isFallbackAdapter);
  } catch {
    return false;
  }
}

/** Software WebGPU (e.g. SwiftShader) can spend minutes compiling the encoder.
 * Use WASM there, reserving WebGPU for an actual hardware adapter.
 * Preference can force CPU, force GPU (when hardware exists), or auto-fallback. */
export async function samDevices(
  gpu?: GpuAccess,
  preference: SamDevicePreference = 'auto',
): Promise<SamDevice[]> {
  if (preference === 'cpu') return ['wasm'];
  const hardware = await samHardwareGpuAvailable(gpu);
  if (!hardware) return ['wasm'];
  // Auto still keeps WASM as a load-time fallback; forced GPU does not.
  return preference === 'gpu' ? ['webgpu'] : ['webgpu', 'wasm'];
}

/** Aggregate per-file download bytes into a 0–100 download percent. */
export function samDownloadPercent(files: Iterable<FileBytes>): number {
  let loaded = 0;
  let total = 0;
  // eslint-disable-next-line no-restricted-syntax
  for (const file of files) {
    loaded += file.loaded;
    total += file.total;
  }
  return total > 0 ? Math.min(100, (100 * loaded) / total) : 0;
}

/**
 * Transformers.js forces `wasm.proxy = false` on import. Re-enable it for CPU
 * so encode/decode run in ORT's worker and the UI thread can keep painting
 * (spinner, Esc, Cancel). WebGPU cannot use the proxy worker.
 *
 * Once ORT has initialized WASM on the main thread (any WebGPU session), the
 * proxy worker can never be created: ORT skips re-init and later calls throw
 * "worker not ready". Pass allowProxy=false after that happens.
 */
export function configureSamOrtProxy(
  device: SamDevice,
  onnxEnv: { wasm?: { proxy?: boolean } } | undefined,
  allowProxy = true,
) {
  const wasm = onnxEnv?.wasm;
  if (wasm) wasm.proxy = device === 'wasm' && allowProxy;
}

/** ORT surfaces this when wasm.proxy=true after WASM already init'd without a worker. */
export function isOrtProxyWorkerError(err: unknown): boolean {
  const text = String(err);
  return text.includes('worker not ready') || text.includes('no available backend');
}

/** Let Vue paint status/spinner before a long sync stretch of work. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { setTimeout(resolve, 0); });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/** One lazily loaded model and two encoded camera frames. Work is serialized:
 * switching models cannot release a session while inference is using it. */
export default class SamOnnx {
  private model: Sam2Model | null = null;

  private processor: Sam2Processor | null = null;

  private postprocessor: SamMaskPostprocessor | null = null;

  private kind: SamModel = 'sam2';

  private devicePreference: SamDevicePreference = 'auto';

  private loadedDevice: SamDevice | null = null;

  /** False after any WebGPU attempt: ORT WASM is then stuck on the main thread. */
  private allowOrtWasmProxy = true;

  private version = 0;

  private queue: Promise<unknown> = Promise.resolve();

  private frames = new Map<string, EncodedFrame>();

  constructor(private onStatus: SamStatusCallback = () => {}) { /* Lazily initialized. */ }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  private clearFrames() {
    this.frames.forEach((frame) => Object.values(frame.embeddings).forEach((tensor) => tensor.dispose()));
    this.frames.clear();
  }

  setModel(kind: SamModel): Promise<void> {
    if (kind === this.kind) return Promise.resolve();
    this.kind = kind;
    return this.dispose();
  }

  setDevice(preference: SamDevicePreference): Promise<void> {
    if (preference === this.devicePreference) return Promise.resolve();
    this.devicePreference = preference;
    return this.dispose();
  }

  dispose(): Promise<void> {
    this.version += 1;
    return this.run(async () => {
      this.clearFrames();
      await this.model?.dispose();
      this.model = null;
      this.processor = null;
      await this.postprocessor?.dispose();
      this.postprocessor = null;
      this.loadedDevice = null;
    });
  }

  private async load() {
    if (this.model) return;
    const { Sam2Model: Sam2, AutoProcessor, env } = await import('@huggingface/transformers');
    const id = SAM_MODELS[this.kind];
    const label = SAM_LABELS[this.kind];
    const devices = await samDevices(navigatorGpu(), this.devicePreference);
    const onnxEnv = env.backends.onnx as { wasm?: { proxy?: boolean } };
    let lastError: unknown;
    // Clear a half-loaded session. this.model is narrowed to null above, so re-read.
    const release = async () => {
      const failed = this.model as Sam2Model | null;
      this.model = null;
      this.processor = null;
      this.loadedDevice = null;
      await failed?.dispose();
    };
    try {
      // Providers must be tried sequentially; release a failed session first.
      // eslint-disable-next-line no-restricted-syntax
      for (const device of devices) {
        // WebGPU initializes WASM on the main thread; proxy can never be enabled after that.
        if (device === 'webgpu') this.allowOrtWasmProxy = false;
        const deviceLabel = device === 'webgpu' ? 'GPU' : 'CPU';
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.loadOnDevice(Sam2, AutoProcessor, id, label, device, deviceLabel, onnxEnv);
          return;
        } catch (err) {
          // eslint-disable-next-line no-await-in-loop
          await release();
          lastError = err;
          // GPU→CPU after a prior WebGPU session: ORT proxy worker was never created.
          if (device === 'wasm' && this.allowOrtWasmProxy && isOrtProxyWorkerError(err)) {
            this.allowOrtWasmProxy = false;
            try {
              // eslint-disable-next-line no-await-in-loop
              await this.loadOnDevice(Sam2, AutoProcessor, id, label, device, deviceLabel, onnxEnv);
              return;
            } catch (retryErr) {
              // eslint-disable-next-line no-await-in-loop
              await release();
              lastError = retryErr;
            }
          }
        }
      }
      throw new Error(`Could not load ${label}: ${String(lastError)}`);
    } finally { this.onStatus(null); }
  }

  private async loadOnDevice(
    // Transformers types from_pretrained as base Model/Processor; cast results below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Sam2: { from_pretrained: (...args: any[]) => Promise<unknown> },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    AutoProcessor: { from_pretrained: (...args: any[]) => Promise<unknown> },
    id: string,
    label: string,
    device: SamDevice,
    deviceLabel: string,
    onnxEnv: { wasm?: { proxy?: boolean } },
  ) {
    configureSamOrtProxy(device, onnxEnv, this.allowOrtWasmProxy);
    const runtime: 'gpu' | 'cpu' = device === 'webgpu' ? 'gpu' : 'cpu';
    // Cache hits report 100% immediately; prepare covers the silent session compile.
    this.onStatus(`Downloading ${label}…`, { phase: 'download', percent: 0, device: runtime });
    await yieldToUi();
    const files = new Map<string, FileBytes>();
    let sawTotal = false;
    let prepared = false;
    const prepare = () => {
      if (prepared) return;
      prepared = true;
      this.onStatus(`Preparing ${label} (${deviceLabel})…`, { phase: 'prepare', device: runtime });
    };
    const reportDownload = (percent: number) => {
      if (prepared) return;
      this.onStatus(`Downloading ${label}…`, {
        phase: 'download',
        percent: Math.min(100, Math.round(percent)),
        device: runtime,
      });
      if (percent >= 100) prepare();
    };
    // WASM compiles with little/no download progress once files are cached.
    const prepareSoon = setTimeout(prepare, device === 'wasm' ? 300 : 5000);
    try {
      this.model = await Sam2.from_pretrained(id, {
        device,
        dtype: 'q4',
        progress_callback: (info: {
          status: string;
          progress?: number;
          file?: string;
          loaded?: number;
          total?: number;
        }) => {
          if (info.status === 'progress_total') {
            sawTotal = true;
            reportDownload(info.progress ?? 0);
          } else if (info.status === 'progress' && !sawTotal && info.file != null
            && info.loaded != null && info.total != null) {
            files.set(info.file, { loaded: info.loaded, total: info.total });
            reportDownload(samDownloadPercent(files.values()));
          }
        },
      }) as Sam2Model;
    } finally {
      clearTimeout(prepareSoon);
    }
    // Session creation finished; processor files are tiny but still worth a prepare label.
    prepare();
    this.processor = await AutoProcessor.from_pretrained(id) as Sam2Processor;
    this.loadedDevice = device;
  }

  ready(): Promise<void> { return this.run(() => this.load()); }

  predict(key: string, image: RgbaImage, request: SegmentationPredictRequest): Promise<SegmentationPredictResponse> {
    const { version } = this;
    // Copy the prompts: the recipe may receive another click while queued.
    const points = request.points.map((p) => [...p]);
    const labels = [...request.pointLabels];
    return this.run(async () => {
      if (version !== this.version) throw new Error('Segmentation model changed.');
      if (!points.length || points.length !== labels.length
        || points.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v)))
        || labels.some((label) => ![0, 1, 2, 3].includes(label))) {
        throw new Error('Invalid segmentation prompts.');
      }
      await this.load();
      const { RawImage, Tensor: TensorClass, env } = await import('@huggingface/transformers');
      if (this.loadedDevice) {
        configureSamOrtProxy(this.loadedDevice, env.backends.onnx as { wasm?: { proxy?: boolean } }, this.allowOrtWasmProxy);
      }
      const processor = this.processor!;
      const model = this.model!;
      let frame = this.frames.get(key);
      try {
        const runtime: 'gpu' | 'cpu' = this.loadedDevice === 'wasm' ? 'cpu' : 'gpu';
        if (!frame) {
          this.onStatus(
            runtime === 'cpu'
              ? 'Encoding image on CPU (this can take a while)…'
              : 'Encoding image…',
            { phase: 'encode', device: runtime },
          );
          await yieldToUi();
          const inputs = await processor(new RawImage(image.data, image.width, image.height, 4));
          try {
            frame = {
              embeddings: await model.get_image_embeddings(inputs),
              original: inputs.original_sizes,
              reshaped: inputs.reshaped_input_sizes,
              padded: [inputs.pixel_values.dims[2], inputs.pixel_values.dims[3]],
            };
          } finally { inputs.pixel_values.dispose(); }
          if (this.frames.size >= 2) {
            const oldest = this.frames.keys().next().value!;
            Object.values(this.frames.get(oldest)!.embeddings).forEach((tensor) => tensor.dispose());
            this.frames.delete(oldest);
          }
          this.frames.set(key, frame);
        }
        this.onStatus(
          runtime === 'cpu'
            ? 'Computing segmentation on CPU (this can take a while)…'
            : 'Computing segmentation…',
          { phase: 'predict', device: runtime },
        );
        await yieldToUi();
        const foreground = points.filter((_, i) => labels[i] < 2);
        const promptInputs: Record<string, Tensor> = {};
        if (foreground.length) {
          promptInputs.input_points = processor.reshape_input_points([[foreground]], frame.original, frame.reshaped);
          promptInputs.input_labels = new TensorClass('int64', BigInt64Array.from(labels.filter((l) => l < 2), BigInt), [1, 1, foreground.length]);
        }
        const topLeft = labels.indexOf(2); const bottomRight = labels.indexOf(3);
        if (topLeft >= 0 && bottomRight >= 0) {
          promptInputs.input_boxes = processor.reshape_input_points([[[...points[topLeft], ...points[bottomRight]]]], frame.original, frame.reshaped, true);
        }
        try {
          const output = await model({ ...frame.embeddings, ...promptInputs });
          try {
            if (!this.postprocessor) this.postprocessor = await SamMaskPostprocessor.create();
            const { mask, score } = await this.postprocessor.run(output.pred_masks, output.iou_scores, frame.original[0], frame.reshaped[0], frame.padded);
            if (version !== this.version) throw new Error('Segmentation model changed.');
            return { ...maskGeometry(mask, image.width, image.height), score };
          } finally {
            output.pred_masks.dispose();
            output.iou_scores.dispose();
            output.object_score_logits?.dispose();
          }
        } finally { Object.values(promptInputs).forEach((tensor) => tensor.dispose()); }
      } finally {
        this.onStatus(null);
      }
    });
  }
}
