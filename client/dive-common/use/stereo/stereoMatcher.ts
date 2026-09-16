/**
 * The contract both correspondence methods satisfy, so the transfer composable
 * and its callers never branch on which one is selected.
 */

import { GrayImage, RgbaImage } from './image';
import { StereoRig } from './calibration';
import type { WarpOptions, WarpResult } from './StereoOnnxMatcher';

/**
 * `ncc` — epipolar candidates + NCC template matching (VIAME method 1).
 * `foundation` — dense Fast-FoundationStereo disparity, read per point.
 */
export type StereoMatchMethod = 'ncc' | 'foundation';

export const DEFAULT_STEREO_MATCH_METHOD: StereoMatchMethod = 'ncc';

export interface StereoMatcher {
  warpPoints(
    points: [number, number][],
    source: RgbaImage | GrayImage,
    target: RgbaImage | GrayImage,
    rig: StereoRig,
    opts: WarpOptions,
  ): Promise<WarpResult[]>;
  /**
   * Compute and cache whatever per-frame state a later `warpPoints` with the
   * same `frameKey` would need, so the warp itself is quick. `stillWanted` is
   * polled before the work starts so a stale request can be dropped.
   */
  prepare?(
    frameKey: string,
    source: RgbaImage,
    target: RgbaImage,
    rig: StereoRig,
    stillWanted?: () => boolean,
  ): Promise<void>;
}

/** Labels for the method selector. */
export const STEREO_MATCH_METHODS: { value: StereoMatchMethod; text: string }[] = [
  { value: 'ncc', text: 'Lower Accuracy, Higher Speed' },
  { value: 'foundation', text: 'Higher Accuracy, Lower Speed' },
];
