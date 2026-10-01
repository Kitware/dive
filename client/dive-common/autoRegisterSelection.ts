/** Even frame spread for auto-register; skew filter because RANSAC can't reject desync. */

export interface ProposalOptions {
  /** Per-camera usable frame counts; the proposal spans [0, min(counts)). */
  counts: number[];
  /** Per-camera per-frame epoch seconds; frames missing any camera's stamp skip the filter. */
  timestamps?: (number | undefined)[][];
  count: number;
  /** Seconds; frames with larger inter-camera skew are excluded. */
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
  // Centre each pick in its share so neither end is favoured.
  const step = eligible.length / count;
  return Array.from({ length: count }, (_, i) => eligible[Math.floor((i + 0.5) * step)]);
}
