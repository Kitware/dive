/** Frozen pre-ONNX implementation, retained only as a regression oracle. */
import { SAMPLE_RADIUS } from '../disparitySampling';

/** Sample the desktop's 90th-percentile order statistic from a clipped 7x7
 * neighbourhood. Read a virtually upscaled disparity map (OpenCV linear resize)
 * so window size and segment error tolerance do not depend on ONNX resolution. */
export default function sampleDisparity(
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
