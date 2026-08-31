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
 * The model is NOT bundled: the exports are ~100 MB, far past what belongs in
 * the repo. Point {@link StereoFoundationMatcher.create} at a served or
 * user-supplied model. Exports are published with the Fast-FoundationStereo
 * release as `<tag>_iters_<n>_res_<H>x<W>.onnx` plus a sidecar `.yaml` giving
 * `image_size`; the graph takes `left_image`/`right_image` as [1,3,H,W] RGB in
 * [0,1] and returns `disparity` as [1,1,H,W] in rectified pixels.
 */

import * as ort from 'onnxruntime-web';

import { GrayImage } from './image';
import { StereoRig } from './calibration';
import type { WarpOptions, WarpResult } from './StereoOnnxMatcher';
import {
  Rectification, computeRectification, rectifyPoint, rectifyMapper, unrectifyPoint,
} from './rectify';

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

export interface FoundationModelSpec {
  /** Network input size, from the export's sidecar yaml `image_size: [H, W]`. */
  height: number;
  width: number;
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

/** Remap a grayscale frame through an inverse map into an RGB [1,3,H,W] tensor. */
function remapToRgbTensor(src: GrayImage, mapX: Float32Array, mapY: Float32Array, width: number, height: number): ort.Tensor {
  const plane = width * height;
  const out = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    const v = sampleBilinear(src.data, src.width, src.height, mapX[i], mapY[i]);
    const g = Number.isNaN(v) ? 0 : v;
    out[i] = g;
    out[plane + i] = g;
    out[2 * plane + i] = g;
  }
  return new ort.Tensor('float32', out, [1, 3, height, width]);
}

export class StereoFoundationMatcher {
  private session: ort.InferenceSession;

  private spec: FoundationModelSpec;

  /** Rectification + inverse maps, rebuilt only when the rig or size changes. */
  private cache: {
    key: string; rect: Rectification;
    src: { mapX: Float32Array; mapY: Float32Array };
    tgt: { mapX: Float32Array; mapY: Float32Array };
  } | null = null;

  private constructor(session: ort.InferenceSession, spec: FoundationModelSpec) {
    this.session = session;
    this.spec = spec;
  }

  /**
   * Create a matcher from a model URL or model bytes. `spec` is the export's
   * input resolution (its sidecar yaml `image_size`), which the graph fixes.
   */
  static async create(
    model: string | ArrayBuffer | Uint8Array,
    spec: FoundationModelSpec,
    opts: { threads?: number } = {},
  ): Promise<StereoFoundationMatcher> {
    ort.env.wasm.numThreads = opts.threads ?? 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(model as string, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    return new StereoFoundationMatcher(session, spec);
  }

  /** Rectification and inverse maps for this rig at the model's resolution. */
  private geometry(rig: StereoRig) {
    const key = `${rig.Kl.join(',')}|${rig.R.join(',')}|${rig.T.join(',')}`;
    if (this.cache && this.cache.key === key) return this.cache;
    const rect = computeRectification(rig, this.spec.width, this.spec.height);
    this.cache = {
      key,
      rect,
      src: rectifyMapper(rig, rect, false),
      tgt: rectifyMapper(rig, rect, true),
    };
    return this.cache;
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
    source: GrayImage,
    target: GrayImage,
    rig: StereoRig,
    opts: WarpOptions,
  ): Promise<WarpResult[]> {
    const { rect, src, tgt } = this.geometry(rig);
    const { width, height } = this.spec;

    const feeds: Record<string, ort.Tensor> = {
      left_image: remapToRgbTensor(source, src.mapX, src.mapY, width, height),
      right_image: remapToRgbTensor(target, tgt.mapX, tgt.mapY, width, height),
    };
    const out = await this.session.run(feeds);
    const disparity = out.disparity.data as Float32Array;

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
          const v = sampleBilinear(disparity, width, height, rx + dx, ry + dy);
          if (Number.isFinite(v) && v > 0) samples.push(v);
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
