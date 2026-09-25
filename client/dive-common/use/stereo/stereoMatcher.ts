/**
 * The contract both correspondence methods satisfy, so the transfer composable
 * and its callers never branch on which one is selected.
 */

import { GrayImage, RgbaImage } from './image';
import { StereoRig } from './calibration';
import type { WarpOptions, WarpResult } from './StereoOnnxMatcher';

/**
 * `ncc` — epipolar candidates + NCC template matching (VIAME method 1).
 * `dino` — the same, with DINO features pre-selecting the candidates (desktop only).
 * `foundation` — dense Fast-FoundationStereo disparity, read per point.
 */
export type StereoMatchMethod = 'ncc' | 'dino' | 'foundation';

export const DEFAULT_STEREO_MATCH_METHOD: StereoMatchMethod = 'foundation';

/** The method to drop to when `method` cannot run here; null when it is already the simplest. */
export function stereoFallbackMethod(method: StereoMatchMethod): StereoMatchMethod | null {
  return method === 'ncc' ? null : 'ncc';
}

export const STEREO_FALLBACK_NOTE = 'Falling back to the lower quality, faster method.';

/**
 * After the failure `message` describes, the method to switch to and the
 * message to show with that change noted. The method stays and the message
 * comes back unchanged when nothing simpler exists.
 */
export function fallBackStereoMethod(
  method: StereoMatchMethod,
  message: string,
): { method: StereoMatchMethod; message: string } {
  const fallback = stereoFallbackMethod(method);
  if (!fallback) return { method, message };
  return { method: fallback, message: `${message} ${STEREO_FALLBACK_NOTE}` };
}

export interface StereoMatcher {
  warpPoints(
    points: [number, number][],
    source: RgbaImage | GrayImage,
    target: RgbaImage | GrayImage,
    rig: StereoRig,
    opts: WarpOptions,
  ): Promise<WarpResult[]>;
  /** Optional disparity refinement for a straight measurement line. */
  warpLine?: StereoMatcher['warpPoints'];
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
export const STEREO_MATCH_METHODS: { value: StereoMatchMethod; text: string; desktopOnly?: boolean }[] = [
  { value: 'foundation', text: 'Higher Quality, Slower' },
  { value: 'dino', text: 'Medium Quality, Medium Speed', desktopOnly: true },
  { value: 'ncc', text: 'Lower Quality, Faster' },
];

export function stereoMatchMethodsFor(desktop: boolean) {
  return STEREO_MATCH_METHODS.filter((m) => desktop || !m.desktopOnly);
}

export function isStereoMatchMethod(value: unknown, desktop: boolean): value is StereoMatchMethod {
  return stereoMatchMethodsFor(desktop).some((m) => m.value === value);
}
