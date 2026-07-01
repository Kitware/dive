/**
 * Client-side wrapper around the exported VIAME stereo "match" ONNX model
 * (method 1: epipolar candidate generation + NCC template matching). Runs fully
 * in the browser / Electron renderer via onnxruntime-web — no backend — so a
 * detection annotated on one camera can be warped onto the other.
 *
 * The model and its conventions are produced by
 * `plugins/onnx/export_stereo_mapping.py --model match`; see that plugin's
 * README. This wrapper only feeds inputs and reads the matched points.
 */

import * as ort from 'onnxruntime-web';

import { GrayImage } from './image';
import { StereoRig, baseline } from './calibration';

/** Search-range specification (disparity is unit-independent; depth needs calib units). */
export type SearchRange =
  | { minDisparity: number; maxDisparity: number }
  | { minDepth: number; maxDepth: number };

export interface WarpOptions {
  range: SearchRange;
  /** Minimum NCC score to accept a match (model default region). Default 0.2. */
  threshold?: number;
  /** Reject if secondScore/score exceeds this (0 disables). Default 0.85. */
  uniquenessRatio?: number;
}

export interface WarpResult {
  /** Matched point in the right (target) image. */
  x: number;
  y: number;
  /** Best NCC score (TM_CCOEFF_NORMED). */
  score: number;
  /** Best NCC score outside a template-size neighborhood (uniqueness check). */
  secondScore: number;
  /** Passed the score threshold and uniqueness-ratio test. */
  accepted: boolean;
}

const IDENTITY_3X3 = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const ZERO_3 = Float32Array.from([0, 0, 0]);

function scalar(v: number): ort.Tensor {
  return new ort.Tensor('float32', Float32Array.from([v]), []);
}

function resolveDepthRange(rig: StereoRig, range: SearchRange): [number, number] {
  if ('minDisparity' in range) {
    const fx = rig.Kl[0];
    const b = baseline(rig);
    // min disparity <-> far (max depth); max disparity <-> near (min depth).
    return [(fx * b) / range.maxDisparity, (fx * b) / range.minDisparity];
  }
  return [range.minDepth, range.maxDepth];
}

export class StereoOnnxMatcher {
  private session: ort.InferenceSession;

  private constructor(session: ort.InferenceSession) {
    this.session = session;
  }

  /**
   * Create a matcher from a model URL or in-memory model bytes. By default the
   * wasm backend runs single-threaded, which works without cross-origin
   * isolation (SharedArrayBuffer); pass `threads` to override.
   */
  static async create(
    model: string | ArrayBuffer | Uint8Array,
    opts: { threads?: number } = {},
  ): Promise<StereoOnnxMatcher> {
    ort.env.wasm.numThreads = opts.threads ?? 1;
    ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(model as string, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    return new StereoOnnxMatcher(session);
  }

  /**
   * Warp a set of source-image points onto the target image. `source`/`target`
   * are grayscale frames; `rig` is the stereo calibration with `source` as the
   * left camera. Returns one {@link WarpResult} per input point.
   */
  async warpPoints(
    points: [number, number][],
    source: GrayImage,
    target: GrayImage,
    rig: StereoRig,
    opts: WarpOptions,
  ): Promise<WarpResult[]> {
    const [minDepth, maxDepth] = resolveDepthRange(rig, opts.range);
    const threshold = opts.threshold ?? 0.2;
    const uniqueness = opts.uniquenessRatio ?? 0.85;

    const pts = new Float32Array(points.length * 2);
    points.forEach(([x, y], i) => { pts[i * 2] = x; pts[i * 2 + 1] = y; });

    const feeds: Record<string, ort.Tensor> = {
      left_gray: new ort.Tensor('float32', source.data, [source.height, source.width]),
      right_gray: new ort.Tensor('float32', target.data, [target.height, target.width]),
      points_left: new ort.Tensor('float32', pts, [points.length, 2]),
      K_left: new ort.Tensor('float32', rig.Kl, [3, 3]),
      dist_left: new ort.Tensor('float32', rig.distl, [8]),
      R_left: new ort.Tensor('float32', IDENTITY_3X3, [3, 3]),
      t_left: new ort.Tensor('float32', ZERO_3, [3]),
      K_right: new ort.Tensor('float32', rig.Kr, [3, 3]),
      dist_right: new ort.Tensor('float32', rig.distr, [8]),
      R_right: new ort.Tensor('float32', rig.R, [3, 3]),
      t_right: new ort.Tensor('float32', rig.T, [3]),
      min_depth: scalar(minDepth),
      max_depth: scalar(maxDepth),
    };

    const out = await this.session.run(feeds);
    const rp = out.right_points.data as Float32Array;
    const best = out.best_score.data as Float32Array;
    const second = out.second_score.data as Float32Array;

    return points.map((_, i) => {
      const score = best[i];
      const secondScore = second[i];
      let accepted = score >= threshold;
      if (accepted && uniqueness > 0 && secondScore > 0 && score > 0) {
        accepted = secondScore / score <= uniqueness;
      }
      return {
        x: rp[i * 2], y: rp[i * 2 + 1], score, secondScore, accepted,
      };
    });
  }
}
