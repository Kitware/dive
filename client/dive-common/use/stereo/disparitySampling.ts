/** Desktop DenseStereoGrid defaults, in original rectified-image pixels. */
export const SAMPLE_RADIUS = 3;
export const SEGMENT_SAMPLES = 11;

/** Port of VIAME core/disparity_segment.cxx: 11 samples, at most 3 outliers,
 * 10-pixel residual, deterministic pair consensus followed by least squares. */
export function fitDisparitySegment(samples: [number, number][]): [number, number] | null {
  if (samples.length > SEGMENT_SAMPLES) return null;
  const valid = samples.filter(([f, d]) => Number.isFinite(f) && Number.isFinite(d) && f >= 0 && f <= 1 && d > 0)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (valid.length < 8 || valid.some((p, i) => i > 0 && p[0] - valid[i - 1][0] < 1e-9)) return null;
  let best: [number, number][] = []; let bestError = Infinity;
  valid.forEach(([f, d], i) => {
    valid.slice(i + 1).forEach(([g, e]) => {
      const slope = (e - d) / (g - f); const intercept = d - slope * f;
      const inliers = valid.filter(([h, v]) => Math.abs(v - intercept - slope * h) <= 10);
      const error = inliers.reduce((sum, [h, v]) => sum + (v - intercept - slope * h) ** 2, 0);
      if (inliers.length >= 8 && (inliers.length > best.length || (inliers.length === best.length && error < bestError))) {
        best = inliers; bestError = error;
      }
    });
  });
  if (!best.length) return null;
  const mf = best.reduce((sum, p) => sum + p[0], 0) / best.length;
  const md = best.reduce((sum, p) => sum + p[1], 0) / best.length;
  const slope = best.reduce((sum, [f, d]) => sum + (f - mf) * (d - md), 0)
    / best.reduce((sum, [f]) => sum + (f - mf) ** 2, 0);
  const head = md - slope * mf; const tail = head + slope;
  if (!Number.isFinite(head + tail) || head <= 0 || tail <= 0
    || best.some(([f, d]) => Math.abs(d - (head + slope * f)) > 10)) return null;
  return [head, tail];
}
