/**
 * Frame selection for the auto-register pipeline: `count` frames spread
 * evenly across the dataset. VIAME matches every frame it is sent, and the
 * matcher's own per-frame gates (min matches, min inliers, inlier ratio)
 * decide which frames contribute to each pair's pooled fit.
 *
 * Inter-camera timestamp skew is the one filter applied here: on a survey
 * aircraft at ~100 kt, 100 ms of desync is ~5 m of ground motion baked
 * straight into the "ground truth" points, and RANSAC cannot reject it
 * because it is consistent within the frame. Frames whose skew exceeds the
 * threshold are excluded before spreading; frames whose skew is unknowable
 * (a camera without a timestamp) stay eligible.
 */

export interface ProposalOptions {
  /** Per-camera usable frame counts; the proposal spans [0, min(counts)). */
  counts: number[];
  /**
   * Optional per-camera per-frame capture timestamps (epoch seconds;
   * undefined entries = unknown). The skew filter applies only when every
   * camera has a timestamp for the frame under consideration.
   */
  timestamps?: (number | undefined)[][];
  /** Number of frames to propose. */
  count: number;
  /** Frames with a larger inter-camera skew (seconds) are excluded. */
  maxSkewSeconds?: number;
}

/** Largest pairwise timestamp difference across cameras, or null if unknowable. */
function frameSkew(
  timestamps: (number | undefined)[][],
  frame: number,
): number | null {
  const stamps: number[] = [];
  for (let cam = 0; cam < timestamps.length; cam += 1) {
    const t = timestamps[cam]?.[frame];
    if (t === undefined) {
      return null;
    }
    stamps.push(t);
  }
  return Math.max(...stamps) - Math.min(...stamps);
}

/**
 * Propose frame indices, sorted ascending. Returns at most `count` frames;
 * short datasets simply yield fewer.
 */
export default function proposeRegistrationFrames(options: ProposalOptions): number[] {
  const usable = Math.min(...options.counts);
  if (!Number.isFinite(usable) || usable <= 0 || options.count <= 0) {
    return [];
  }
  const { timestamps } = options;
  const maxSkew = options.maxSkewSeconds ?? 0.5;
  const eligible: number[] = [];
  for (let frame = 0; frame < usable; frame += 1) {
    const skew = timestamps?.length ? frameSkew(timestamps, frame) : null;
    if (skew === null || skew <= maxSkew) {
      eligible.push(frame);
    }
  }
  const count = Math.min(options.count, eligible.length);
  // Centre each pick in its share of the eligible frames, so neither end of
  // the dataset is favoured.
  const step = eligible.length / count;
  return Array.from({ length: count }, (_, i) => eligible[Math.floor((i + 0.5) * step)]);
}
