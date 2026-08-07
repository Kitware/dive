/**
 * Candidate-frame proposal for the auto-register pipeline (stage 0 of the
 * selection contract): DIVE picks for diversity and synchronization, VIAME
 * picks for image quality.
 *
 * Stratified, not "evenly spread" and not "most featureful": the flight is
 * divided into `bins` equal time bins and `perBin` candidates are proposed
 * within each, so temporal spread is guaranteed structurally -- a single
 * scene-rich stretch can never supply every frame, which would reconstitute
 * exactly the single-scene bias the multi-pair restructure exists to remove.
 * The pipeline then keeps the best candidate per bin by image quality
 * (`max_frames` is the bin count), so oversampling here is deliberate.
 *
 * Within a bin, candidates rank by inter-camera timestamp skew when every
 * camera carries per-frame timestamps: on a survey aircraft at ~100 kt,
 * 100 ms of desync is ~5 m of ground motion baked straight into the "ground
 * truth" points, and RANSAC cannot reject it because it is consistent
 * within the frame. Without timestamps (positional alignment), candidates
 * spread evenly within the bin and skew is unknowable -- no threshold
 * applies.
 */

export interface ProposalOptions {
  /** Per-camera usable frame counts; the proposal spans [0, min(counts)). */
  counts: number[];
  /**
   * Optional per-camera per-frame capture timestamps (epoch seconds;
   * undefined entries = unknown). Skew ranking applies only when every
   * camera has a timestamp for the frame under consideration.
   */
  timestamps?: (number | undefined)[][];
  /** Number of temporal bins (the pipeline's max_frames budget). */
  bins: number;
  /** Candidates proposed per bin. */
  perBin: number;
  /** Candidates with a larger inter-camera skew (seconds) are dropped. */
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
 * Propose candidate frame indices, sorted ascending. Returns at most
 * `bins * perBin` frames; short datasets simply yield fewer.
 */
export default function proposeRegistrationFrames(options: ProposalOptions): number[] {
  const usable = Math.min(...options.counts);
  if (!Number.isFinite(usable) || usable <= 0 || options.bins <= 0 || options.perBin <= 0) {
    return [];
  }
  const bins = Math.min(options.bins, usable);
  const { timestamps } = options;
  const maxSkew = options.maxSkewSeconds ?? 0.5;
  const chosen = new Set<number>();
  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor((bin * usable) / bins);
    const end = Math.floor(((bin + 1) * usable) / bins); // exclusive
    const size = end - start;
    if (size <= 0) {
      continue;
    }
    const perBin = Math.min(options.perBin, size);
    if (timestamps && timestamps.length) {
      // Rank the whole bin by skew; unknowable-skew frames rank after
      // measured ones (evenly spread among themselves), over-threshold
      // frames are dropped outright.
      const measured: { frame: number; skew: number }[] = [];
      const unknowable: number[] = [];
      for (let frame = start; frame < end; frame += 1) {
        const skew = frameSkew(timestamps, frame);
        if (skew === null) {
          unknowable.push(frame);
        } else if (skew <= maxSkew) {
          measured.push({ frame, skew });
        }
      }
      measured.sort((a, b) => a.skew - b.skew || a.frame - b.frame);
      measured.slice(0, perBin).forEach(({ frame }) => chosen.add(frame));
      let still = perBin - Math.min(measured.length, perBin);
      if (still > 0 && unknowable.length) {
        const step = unknowable.length / still;
        for (let i = 0; i < still; i += 1) {
          chosen.add(unknowable[Math.floor(i * step)]);
        }
        still = 0;
      }
    } else {
      // No timeline: spread evenly within the bin.
      const step = size / perBin;
      for (let i = 0; i < perBin; i += 1) {
        chosen.add(start + Math.floor(i * step + step / 2));
      }
    }
  }
  return [...chosen].sort((a, b) => a - b);
}
