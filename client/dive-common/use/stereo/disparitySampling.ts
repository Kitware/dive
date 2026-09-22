/** Desktop DenseStereoGrid defaults, in original rectified-image pixels. */
export const SAMPLE_RADIUS = 3;
export const SEGMENT_SAMPLES = 11;

/** Sample the desktop's 90th-percentile order statistic from a clipped 7x7
 * neighbourhood. Read a virtually upscaled disparity map (OpenCV linear resize)
 * so window size and segment error tolerance do not depend on ONNX resolution. */
export function sampleDisparity(
  data: Float32Array,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
) {
  const sx = width / sourceWidth; const sy = height / sourceHeight;
  const cx = Math.trunc(x + 0.5); const cy = Math.trunc(y + 0.5);
  if (!Number.isFinite(x + y) || cx < 0 || cy < 0 || cx >= sourceWidth || cy >= sourceHeight) return null;
  const values: number[] = []; let count = 0;
  for (let py = Math.max(0, cy - SAMPLE_RADIUS); py <= Math.min(sourceHeight - 1, cy + SAMPLE_RADIUS); py += 1) {
    for (let px = Math.max(0, cx - SAMPLE_RADIUS); px <= Math.min(sourceWidth - 1, cx + SAMPLE_RADIUS); px += 1) {
      const gx = Math.max(0, Math.min(width - 1, (px + 0.5) * sx - 0.5));
      const gy = Math.max(0, Math.min(height - 1, (py + 0.5) * sy - 0.5));
      const ix = Math.floor(gx); const iy = Math.floor(gy);
      const fx = gx - ix; const fy = gy - iy;
      const jx = Math.min(width - 1, ix + 1); const jy = Math.min(height - 1, iy + 1);
      const value = ((1 - fy) * ((1 - fx) * data[iy * width + ix] + fx * data[iy * width + jx])
        + fy * ((1 - fx) * data[jy * width + ix] + fx * data[jy * width + jx])) / sx;
      count += 1;
      if (Number.isFinite(value) && value > 0) values.push(value);
    }
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return { disparity: values[Math.min(values.length - 1, Math.floor(values.length * 0.9))], fraction: values.length / count };
}

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
