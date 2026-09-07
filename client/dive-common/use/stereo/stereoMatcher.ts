/**
 * The contract both correspondence methods satisfy, so the transfer composable
 * and its callers never branch on which one is selected.
 */

import { GrayImage } from './image';
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
    source: GrayImage,
    target: GrayImage,
    rig: StereoRig,
    opts: WarpOptions,
  ): Promise<WarpResult[]>;
}

/** Labels for the method selector. */
export const STEREO_MATCH_METHODS: { value: StereoMatchMethod; text: string }[] = [
  { value: 'ncc', text: 'Template matching (NCC)' },
  { value: 'foundation', text: 'Foundation stereo (disparity)' },
];
