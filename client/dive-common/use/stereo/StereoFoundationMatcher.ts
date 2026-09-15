/**
 * Client-side wrapper around a Fast-FoundationStereo ONNX export (NVIDIA), as
 * the second stereo correspondence method alongside {@link StereoOnnxMatcher}.
 *
 * Where the NCC matcher searches the epipolar curve per point, this one runs a
 * dense disparity network over the whole pair once and reads each point's
 * correspondence out of the disparity map. That costs one network pass per
 * frame regardless of how many points are warped, and it does not depend on the
 * source patch being photometrically matchable — which is what makes it hold up
 * on footage where template correlation struggles (obstructed views, repetitive
 * substrate, low contrast).
 *
 * The export is the one VIAME ships in its `FAST-FDN-STEREO` add-on
 * (`fast_foundation_stereo_l.onnx` plus a sidecar `.yaml` giving `image_size`),
 * the same file `plugins/onnx/fast_foundation_stereo.py` runs server-side. The
 * runtime contract is shared with that plugin: `left_image`/`right_image` are
 * [1,3,H,W] ImageNet-normalised RGB at the export's fixed resolution, and
 * `disparity` is [1,1,H,W] in rectified pixels of that resolution.
 *
 * Disparity maps are cached per frame pair so a warp that follows a
 * {@link StereoFoundationMatcher.prepare} for the same frame is immediate.
 */

import * as ort from 'onnxruntime-web';

import { RgbaImage, GrayImage, isGrayImage } from './image';
import { StereoRig } from './calibration';
import type { WarpOptions, WarpResult } from './StereoOnnxMatcher';
import type { StereoMatcher } from './stereoMatcher';
import {
  Rectification, computeRectification, rectifyPoint, rectifyMapper, unrectifyPoint,
} from './rectify';

/**
 * The foundation model runs on onnxruntime-web's *native* WebGPU provider
 * (`onnxruntime-web/webgpu`), not the default bundle's JSEP kernels: the JSEP
 * provider returns an all-zero cost volume for this graph (verified probe by
 * probe against CPU), while the native provider matches CPU through the
 * refinement stage. The bundle is imported lazily so Node tests and pages that
 * never select the method do not load it, and feeds are built with that
 * bundle's own Tensor class because onnxruntime-common checks `instanceof`.
 */
type OrtModule = typeof ort;

/**
 * Half-width of the window whose disparities are pooled for one point.
 *
 * A head or tail tip is a couple of pixels wide at the network's working
 * resolution, so the disparity sampled exactly at the tip is often the
 * background's. Pooling a small neighbourhood by median rejects that without
 * dragging the estimate off the animal.
 */
export const DEFAULT_SAMPLE_RADIUS = 3;

/**
 * Fraction of the pooled window that must carry a finite positive disparity for
 * the match to be accepted. The network emits a dense map with no confidence
 * channel, so validity density is the available proxy.
 */
export const DEFAULT_MIN_VALID_FRACTION = 0.34;

/** Disparity maps kept per matcher: two directions per frame, so ~4 frames. */
export const DEFAULT_DISPARITY_CACHE_SIZE = 8;

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

export interface FoundationModelSpec {
  /** Network input size, from the export's sidecar yaml `image_size: [H, W]`. */
  height: number;
  width: number;
}

/** The slice of an ONNX session the matcher uses; tests substitute a fake. */
export interface DisparitySession {
  run(feeds: Record<string, ort.Tensor>): Promise<Record<string, ort.Tensor>>;
}

/** A model input: NCHW float32 planes plus dims, wrapped into a Tensor by the matcher. */
export interface InputPlanes {
  data: Float32Array;
  dims: [number, number, number, number];
}

export interface FoundationMatcherOptions {
  /**
   * Defaults to WebGPU, the only provider that can run this export in a
   * browser: the CPU (wasm) path needs several GB of activations, past the
   * 4 GB a wasm heap can hold, so it is not offered as a fallback.
   */
  executionProviders?: string[];
  cacheSize?: number;
}

export const WEBGPU_REQUIRED_MESSAGE = 'The higher-accuracy stereo model needs WebGPU, which this browser does not provide. '
  + 'Use a current Chrome or Edge, or switch the point matching setting to the faster method.';

function defaultExecutionProviders(): string[] {
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator && !!navigator.gpu;
  if (!hasWebGpu) throw new Error(WEBGPU_REQUIRED_MESSAGE);
  return ['webgpu'];
}

/** The fixed [1,3,H,W] input size of a loaded session, from its input metadata. */
export function inputSizeOf(session: { inputMetadata?: readonly { name: string; shape?: ReadonlyArray<number | string> }[] }): FoundationModelSpec {
  const left = session.inputMetadata?.find((m) => m.name === 'left_image') ?? session.inputMetadata?.[0];
  const shape = left?.shape ?? [];
  const height = Number(shape[2]);
  const width = Number(shape[3]);
  if (!(height > 0 && width > 0)) {
    throw new Error('The stereo model does not declare a fixed input size; supply foundationModelSpec.');
  }
  return { height, width };
}

function rigKey(rig: StereoRig): string {
  return `${rig.Kl.join(',')}|${rig.Kr.join(',')}|${rig.R.join(',')}|${rig.T.join(',')}`;
}

function cacheKey(frameKey: string | undefined, rig: StereoRig, source: { width: number; height: number }): string | null {
  if (frameKey === undefined) return null;
  return `${frameKey}|${source.width}x${source.height}|${rigKey(rig)}`;
}

/** Bilinear sample of a single-channel image, NaN outside. */
function sampleBilinear(data: Float32Array, width: number, height: number, x: number, y: number): number {
  if (!(x >= 0 && y >= 0 && x <= width - 1 && y <= height - 1)) return NaN;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * width + x0];
  const b = data[y0 * width + x1];
  const c = data[y1 * width + x0];
  const d = data[y1 * width + x1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/**
 * Remap a frame through an inverse map into an ImageNet-normalised RGB
 * [1,3,H,W] tensor. Pixels that map outside the source are filled black, as
 * OpenCV's remap would.
 */
export function remapToInputTensor(
  src: RgbaImage | GrayImage,
  mapX: Float32Array,
  mapY: Float32Array,
  width: number,
  height: number,
): InputPlanes {
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  const { data, width: sw, height: sh } = src;
  const gray = isGrayImage(src);
  const stride = gray ? 1 : 4;
  const rgb = [0, 0, 0];
  for (let i = 0; i < plane; i += 1) {
    const x = mapX[i];
    const y = mapY[i];
    rgb[0] = 0;
    rgb[1] = 0;
    rgb[2] = 0;
    if (x >= 0 && y >= 0 && x <= sw - 1 && y <= sh - 1) {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(x0 + 1, sw - 1);
      const y1 = Math.min(y0 + 1, sh - 1);
      const fx = x - x0;
      const fy = y - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i00 = (y0 * sw + x0) * stride;
      const i10 = (y0 * sw + x1) * stride;
      const i01 = (y1 * sw + x0) * stride;
      const i11 = (y1 * sw + x1) * stride;
      for (let c = 0; c < 3; c += 1) {
        const o = gray ? 0 : c;
        rgb[c] = data[i00 + o] * w00 + data[i10 + o] * w10 + data[i01 + o] * w01 + data[i11 + o] * w11;
      }
    }
    for (let c = 0; c < 3; c += 1) {
      out[c * plane + i] = (rgb[c] / 255 - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
    }
  }
  return { data: out, dims: [1, 3, height, width] };
}

interface Geometry {
  key: string;
  rect: Rectification;
  src: { mapX: Float32Array; mapY: Float32Array };
  tgt: { mapX: Float32Array; mapY: Float32Array };
}

interface PendingDisparity {
  promise: Promise<Float32Array | null>;
  /** Cleared when a warp needs the result, so the staleness check cannot skip it. */
  prefetch: boolean;
}

export class StereoFoundationMatcher implements StereoMatcher {
  private session: DisparitySession;

  /** The runtime whose Tensor class the session accepts. */
  private ort: OrtModule;

  private spec: FoundationModelSpec;

  private cacheSize: number;

  /** Rectification + inverse maps, rebuilt only when the rig or size changes. */
  private geometryCache: Geometry | null = null;

  /** Insertion-ordered so the first entry is the least recently used. */
  private disparities = new Map<string, Float32Array>();

  private pending = new Map<string, PendingDisparity>();

  /** The wasm/WebGPU session runs one inference at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * An inference failure is a property of this model + runtime (unsupported
   * operator, out of GPU memory), not of one frame, so it is remembered and
   * rethrown instead of re-running a doomed pass on every frame change.
   */
  private failure: Error | null = null;

  constructor(
    session: DisparitySession,
    spec: FoundationModelSpec,
    cacheSize = DEFAULT_DISPARITY_CACHE_SIZE,
    runtime: OrtModule = ort,
  ) {
    this.session = session;
    this.spec = spec;
    this.cacheSize = cacheSize;
    this.ort = runtime;
  }

  /**
   * Create a matcher from a model URL or model bytes. The graph fixes its
   * input resolution; it is read from the session's input metadata unless
   * `spec` (the sidecar yaml `image_size`) is given.
   */
  static async create(
    model: string | ArrayBuffer | Uint8Array,
    spec?: FoundationModelSpec,
    opts: FoundationMatcherOptions = {},
  ): Promise<StereoFoundationMatcher> {
    const executionProviders = opts.executionProviders ?? defaultExecutionProviders();
    // eslint-disable-next-line import/no-unresolved
    const runtime = (await import('onnxruntime-web/webgpu')) as unknown as OrtModule;
    runtime.env.wasm.proxy = false;
    const session = await runtime.InferenceSession.create(model as string, {
      executionProviders,
      // 'basic' (level 1) is exact against CPU; one of the extended-level
      // fusions the WebGPU provider applies corrupts the GRU gates (~2 px).
      graphOptimizationLevel: 'basic',
    });
    return new StereoFoundationMatcher(session, spec ?? inputSizeOf(session), opts.cacheSize, runtime);
  }

  get inputSize(): FoundationModelSpec {
    return { ...this.spec };
  }

  /** Rectification and inverse maps for this rig at the model's resolution. */
  private geometry(rig: StereoRig, source: { width: number; height: number }): Geometry {
    const key = `${source.width}x${source.height}|${rigKey(rig)}`;
    if (this.geometryCache && this.geometryCache.key === key) return this.geometryCache;
    const rect = computeRectification(rig, source.width, source.height, this.spec.width, this.spec.height);
    this.geometryCache = {
      key,
      rect,
      src: rectifyMapper(rig, rect, false),
      tgt: rectifyMapper(rig, rect, true),
    };
    return this.geometryCache;
  }

  private async infer(source: RgbaImage | GrayImage, target: RgbaImage | GrayImage, rig: StereoRig): Promise<Float32Array> {
    if (this.failure) throw this.failure;
    const { src, tgt } = this.geometry(rig, source);
    const { width, height } = this.spec;
    const left = remapToInputTensor(source, src.mapX, src.mapY, width, height);
    const right = remapToInputTensor(target, tgt.mapX, tgt.mapY, width, height);
    let out: Record<string, ort.Tensor>;
    try {
      out = await this.session.run({
        left_image: new this.ort.Tensor('float32', left.data, left.dims),
        right_image: new this.ort.Tensor('float32', right.data, right.dims),
      });
    } catch (err) {
      this.failure = err instanceof Error ? err : new Error(String(err));
      throw this.failure;
    }
    const disparity = out.disparity.data as Float32Array;
    for (let i = 0; i < disparity.length; i += 1) {
      if (!(disparity[i] > 0)) disparity[i] = 0;
    }
    return disparity;
  }

  private remember(key: string, disparity: Float32Array) {
    this.disparities.delete(key);
    this.disparities.set(key, disparity);
    while (this.disparities.size > this.cacheSize) {
      const oldest = this.disparities.keys().next().value as string;
      this.disparities.delete(oldest);
    }
  }

  /**
   * The disparity map for a pair, from the cache when present. Requests are
   * serialised; a `prefetch` request whose `stillWanted` has turned false by
   * the time it reaches the front of the queue resolves `null` without running.
   */
  private disparityFor(
    key: string | null,
    source: RgbaImage | GrayImage,
    target: RgbaImage | GrayImage,
    rig: StereoRig,
    prefetch: boolean,
    stillWanted: () => boolean = () => true,
  ): Promise<Float32Array | null> {
    if (key !== null) {
      const hit = this.disparities.get(key);
      if (hit) {
        this.remember(key, hit);
        return Promise.resolve(hit);
      }
      const inflight = this.pending.get(key);
      if (inflight) {
        if (!prefetch) inflight.prefetch = false;
        return inflight.promise;
      }
    }
    const entry: PendingDisparity = { prefetch, promise: Promise.resolve(null) };
    entry.promise = this.queue.then(async () => {
      if (entry.prefetch && !stillWanted()) return null;
      const hit = key !== null ? this.disparities.get(key) : undefined;
      if (hit) return hit;
      const disparity = await this.infer(source, target, rig);
      if (key !== null) this.remember(key, disparity);
      return disparity;
    });
    this.queue = entry.promise.catch(() => undefined);
    if (key !== null) {
      this.pending.set(key, entry);
      entry.promise.finally(() => this.pending.delete(key)).catch(() => undefined);
    }
    return entry.promise;
  }

  /** The error that stopped this matcher, if an inference has failed. */
  get lastFailure(): Error | null {
    return this.failure;
  }

  /** Whether a disparity map is already cached for this frame pair. */
  isPrepared(frameKey: string, rig: StereoRig, source: { width: number; height: number }): boolean {
    const key = cacheKey(frameKey, rig, source);
    return key !== null && this.disparities.has(key);
  }

  /**
   * Compute and cache the disparity map for a frame pair ahead of any warp
   * against it. Resolves once the map is cached or the request was dropped as
   * stale.
   */
  async prepare(
    frameKey: string,
    source: RgbaImage | GrayImage,
    target: RgbaImage | GrayImage,
    rig: StereoRig,
    stillWanted: () => boolean = () => true,
  ): Promise<void> {
    await this.disparityFor(cacheKey(frameKey, rig, source), source, target, rig, true, stillWanted);
  }

  /**
   * Warp source-image points onto the target image, matching
   * {@link StereoOnnxMatcher.warpPoints} so the two are interchangeable.
   *
   * `opts.range` bounds the accepted disparity exactly as it bounds the NCC
   * search: a correspondence outside it is rejected rather than trusted.
   */
  async warpPoints(
    points: [number, number][],
    source: RgbaImage | GrayImage,
    target: RgbaImage | GrayImage,
    rig: StereoRig,
    opts: WarpOptions,
  ): Promise<WarpResult[]> {
    const { rect } = this.geometry(rig, source);
    const { width, height } = this.spec;
    const disparity = await this.disparityFor(cacheKey(opts.frameKey, rig, source), source, target, rig, false);
    if (!disparity) throw new Error('The stereo disparity map could not be computed.');

    const radius = DEFAULT_SAMPLE_RADIUS;
    const minValid = DEFAULT_MIN_VALID_FRACTION;
    const [minDisp, maxDisp] = 'minDisparity' in opts.range
      ? [opts.range.minDisparity, opts.range.maxDisparity]
      : [0, Number.POSITIVE_INFINITY];
    // The search range is expressed in source-image pixels; the network works
    // at its own resolution, so carry the bound across in the same ratio.
    const dispScale = width / source.width;

    return points.map(([px, py]) => {
      const [rx, ry] = rectifyPoint(px, py, rig, rect, false);
      const fail: WarpResult = {
        x: NaN, y: NaN, score: 0, secondScore: 0, accepted: false,
      };
      if (!Number.isFinite(rx) || !Number.isFinite(ry)) return fail;

      const samples: number[] = [];
      let considered = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          considered += 1;
          const sx = rx + dx;
          const v = sampleBilinear(disparity, width, height, sx, ry + dy);
          // A match that would land left of the target image is invisible.
          if (Number.isFinite(v) && v > 0 && sx - v >= 0) samples.push(v);
        }
      }
      if (!samples.length) return fail;

      samples.sort((a, b) => a - b);
      const d = samples[Math.floor(samples.length / 2)];
      const validFraction = samples.length / considered;

      const dSource = d / dispScale;
      const inRange = dSource >= minDisp && dSource <= maxDisp;
      const [ox, oy] = unrectifyPoint(rx - d, ry, rig, rect, true);
      if (!Number.isFinite(ox) || !Number.isFinite(oy)) return fail;

      return {
        x: ox,
        y: oy,
        score: validFraction,
        secondScore: 0,
        accepted: validFraction >= minValid && inRange,
      };
    });
  }
}
