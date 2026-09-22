import type {
  Sam2Model, Sam2Processor, Tensor,
} from '@huggingface/transformers';
import type { SegmentationPredictRequest, SegmentationPredictResponse } from 'dive-common/apispec';
import type { RgbaImage } from '../stereo/image';
import { maskGeometry } from './maskGeometry';

export type SamModel = 'sam2' | 'sam3';
export const SAM_MODELS = {
  sam2: 'onnx-community/sam2.1-hiera-tiny-ONNX',
  sam3: 'onnx-community/sam3-tracker-ONNX',
} as const;

type EncodedFrame = {
  embeddings: Record<string, Tensor>;
  original: [number, number][];
  reshaped: [number, number][];
};

type GpuAccess = {
  requestAdapter(): Promise<{ info?: { isFallbackAdapter?: boolean }; isFallbackAdapter?: boolean } | null>;
};

/** Software WebGPU (e.g. SwiftShader) can spend minutes compiling the encoder.
 * Use WASM there, reserving WebGPU for an actual hardware adapter. */
export async function samDevices(gpu?: GpuAccess): Promise<('webgpu' | 'wasm')[]> {
  try {
    const adapter = await gpu?.requestAdapter();
    if (adapter && !adapter.info?.isFallbackAdapter && !adapter.isFallbackAdapter) return ['webgpu', 'wasm'];
  } catch { /* CPU remains available if requesting a GPU is denied. */ }
  return ['wasm'];
}

/** One lazily loaded model and two encoded camera frames. Work is serialized:
 * switching models cannot release a session while inference is using it. */
export default class SamOnnx {
  private model: Sam2Model | null = null;

  private processor: Sam2Processor | null = null;

  private kind: SamModel = 'sam2';

  private version = 0;

  private queue: Promise<unknown> = Promise.resolve();

  private frames = new Map<string, EncodedFrame>();

  constructor(private onStatus: (message: string | null) => void = () => {}) { /* Lazily initialized. */ }

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

  dispose(): Promise<void> {
    this.version += 1;
    return this.run(async () => {
      this.clearFrames();
      await this.model?.dispose();
      this.model = null;
      this.processor = null;
    });
  }

  private async load() {
    if (this.model) return;
    const { Sam2Model: Sam2, Sam3TrackerModel: Sam3, AutoProcessor } = await import('@huggingface/transformers');
    const id = SAM_MODELS[this.kind];
    const Model = this.kind === 'sam2' ? Sam2 : Sam3;
    const devices = await samDevices(typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { gpu?: GpuAccess }).gpu);
    let lastError: unknown;
    try {
      // Providers must be tried sequentially; release a failed session first.
      // eslint-disable-next-line no-restricted-syntax
      for (const device of devices) {
        try {
          this.onStatus(`Loading ${this.kind.toUpperCase()} (${device === 'webgpu' ? 'GPU' : 'CPU'})…`);
          // eslint-disable-next-line no-await-in-loop
          this.model = await Model.from_pretrained(id, {
            device,
            dtype: 'q4',
            progress_callback: (progress) => {
              if (progress.status === 'progress') {
                this.onStatus(`Downloading ${this.kind.toUpperCase()}: ${Math.round(progress.progress)}%`);
              }
            },
          }) as Sam2Model;
          // eslint-disable-next-line no-await-in-loop
          this.processor = await AutoProcessor.from_pretrained(id) as Sam2Processor;
          return;
        } catch (err) {
          // eslint-disable-next-line no-await-in-loop
          await this.model?.dispose();
          this.model = null;
          this.processor = null;
          lastError = err;
        }
      }
      throw new Error(`Could not load ${this.kind.toUpperCase()}: ${String(lastError)}`);
    } finally { this.onStatus(null); }
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
      const { RawImage, Tensor: TensorClass } = await import('@huggingface/transformers');
      const processor = this.processor!;
      const model = this.model!;
      let frame = this.frames.get(key);
      if (!frame) {
        this.onStatus('Encoding image…');
        try {
          const inputs = await processor(new RawImage(image.data, image.width, image.height, 4));
          try {
            frame = {
              embeddings: await model.get_image_embeddings(inputs),
              original: inputs.original_sizes,
              reshaped: inputs.reshaped_input_sizes,
            };
          } finally { inputs.pixel_values.dispose(); }
          if (this.frames.size >= 2) {
            const oldest = this.frames.keys().next().value!;
            Object.values(this.frames.get(oldest)!.embeddings).forEach((tensor) => tensor.dispose());
            this.frames.delete(oldest);
          }
          this.frames.set(key, frame);
        } finally { this.onStatus(null); }
      }
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
          // SAM returns alternative masks, not separate object components.
          // Pick the highest-scoring candidate; preserve all of its components.
          const scores = Array.from(output.iou_scores.data, Number);
          const best = scores.reduce((a, score, i) => (score > scores[a] ? i : a), 0);
          const masks: Tensor[] = await processor.post_process_masks(output.pred_masks, frame.original, frame.reshaped);
          try {
            if (version !== this.version) throw new Error('Segmentation model changed.');
            const size = image.width * image.height;
            const mask = Uint8Array.from(masks[0].data.slice(best * size, (best + 1) * size), Number);
            return { ...maskGeometry(mask, image.width, image.height), score: scores[best] };
          } finally { masks.forEach((mask) => mask.dispose()); }
        } finally {
          output.pred_masks.dispose();
          output.iou_scores.dispose();
          output.object_score_logits?.dispose();
        }
      } finally { Object.values(promptInputs).forEach((tensor) => tensor.dispose()); }
    });
  }
}
