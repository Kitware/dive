import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  describe, it, expect,
} from 'vitest';
import { rigFromNpz, invertRig, StereoRig } from '../calibration';
import {
  triangulatePoint, measureLine, aggregateLengths, unmap, mapPoint, project,
} from '../triangulate';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const loadRig = () => rigFromNpz(readFileSync(fixture('calibration.npz')));

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO = [0, 0, 0];

/** Project a world point into both cameras of a rig. */
function projectBoth(rig: StereoRig, p: [number, number, number]) {
  return {
    left: project(p, rig.Kl, rig.distl, IDENTITY, ZERO),
    right: project(p, rig.Kr, rig.distr, rig.R, rig.T),
  };
}

describe('unmap / mapPoint', () => {
  it('round-trips a pixel through the distortion model', async () => {
    const rig = await loadRig();
    const px: [number, number] = [412.5, 233.25];
    const [nx, ny] = unmap(px[0], px[1], rig.Kl, rig.distl);
    const back = mapPoint(nx, ny, rig.Kl, rig.distl);
    expect(back[0]).toBeCloseTo(px[0], 4);
    expect(back[1]).toBeCloseTo(px[1], 4);
  });

  it('inverts a non-trivial radial-tangential distortion', () => {
    // The bundled calibration is distortion-free, so exercise the Newton
    // inverse against coefficients that actually bend the image.
    const K = Float32Array.from([800, 0, 320, 0, 800, 240, 0, 0, 1]);
    const dist = Float32Array.from([-0.28, 0.12, 0.001, -0.002, -0.03, 0, 0, 0]);
    [[600, 400], [40, 60], [320, 240]].forEach(([px, py]) => {
      const [nx, ny] = unmap(px, py, K, dist);
      const back = mapPoint(nx, ny, K, dist);
      expect(back[0]).toBeCloseTo(px, 3);
      expect(back[1]).toBeCloseTo(py, 3);
    });
    // A corner pixel must actually move, or the model is being ignored.
    const naive = [(600 - 320) / 800, (400 - 240) / 800];
    const [nx] = unmap(600, 400, K, dist);
    expect(Math.abs(nx - naive[0])).toBeGreaterThan(1e-3);
  });

  it('triangulates through distortion', () => {
    const K = Float32Array.from([800, 0, 320, 0, 800, 240, 0, 0, 1]);
    const dist = Float32Array.from([-0.28, 0.12, 0.001, -0.002, -0.03, 0, 0, 0]);
    const rig: StereoRig = {
      Kl: K,
      distl: dist,
      Kr: K,
      distr: dist,
      R: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      T: Float32Array.from([-120, 0, 0]),
    };
    const truth: [number, number, number] = [150, -60, 2400];
    const { left, right } = projectBoth(rig, truth);
    const got = triangulatePoint(rig, left, right);
    expect(got).not.toBeNull();
    (got as number[]).forEach((v, i) => expect(v).toBeCloseTo(truth[i], 2));
  });
});

describe('triangulatePoint', () => {
  it('recovers a synthetic 3D point from its two projections', async () => {
    const rig = await loadRig();
    const truth: [number, number, number] = [120, -50, 2500];
    const { left, right } = projectBoth(rig, truth);
    const got = triangulatePoint(rig, left, right);
    expect(got).not.toBeNull();
    (got as number[]).forEach((v, i) => expect(v).toBeCloseTo(truth[i], 2));
  });

  it('is consistent when the rig is inverted and the views swap', async () => {
    const rig = await loadRig();
    const truth: [number, number, number] = [-200, 80, 3100];
    const { left, right } = projectBoth(rig, truth);
    // In the inverted rig the right camera is the world origin, so the same
    // physical point must come back as its coordinates in that frame.
    const inverted = triangulatePoint(invertRig(rig), right, left);
    expect(inverted).not.toBeNull();
    const expected = [
      rig.R[0] * truth[0] + rig.R[1] * truth[1] + rig.R[2] * truth[2] + rig.T[0],
      rig.R[3] * truth[0] + rig.R[4] * truth[1] + rig.R[5] * truth[2] + rig.T[1],
      rig.R[6] * truth[0] + rig.R[7] * truth[1] + rig.R[8] * truth[2] + rig.T[2],
    ];
    (inverted as number[]).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 2));
  });
});

describe('measureLine', () => {
  it('measures a synthetic segment exactly, with near-zero reprojection error', async () => {
    const rig = await loadRig();
    const head: [number, number, number] = [-100, 0, 2000];
    const tail: [number, number, number] = [100, 0, 2000];
    const h = projectBoth(rig, head);
    const t = projectBoth(rig, tail);

    const m = measureLine(rig, [h.left, t.left], [h.right, t.right]);
    expect(m).not.toBeNull();
    const measurement = m as NonNullable<typeof m>;
    expect(measurement.length).toBeCloseTo(200, 3);
    expect(measurement.midpoint_x).toBeCloseTo(0, 3);
    expect(measurement.midpoint_y).toBeCloseTo(0, 3);
    expect(measurement.midpoint_z).toBeCloseTo(2000, 3);
    // Range is the midpoint's distance from the left camera at the origin.
    expect(measurement.midpoint_range).toBeCloseTo(2000, 3);
    expect(measurement.stereo_rms).toBeLessThan(0.01);
  });

  it('reports a real reprojection error for an inconsistent correspondence', async () => {
    const rig = await loadRig();
    const h = projectBoth(rig, [-100, 0, 2000]);
    const t = projectBoth(rig, [100, 0, 2000]);
    // Push one match well off its epipolar-consistent position.
    const m = measureLine(
      rig,
      [h.left, t.left],
      [[h.right[0], h.right[1] + 12], t.right],
    );
    expect(m).not.toBeNull();
    expect((m as NonNullable<typeof m>).stereo_rms).toBeGreaterThan(0.1);
  });

  it('measures the real matched fixture correspondence as a positive length', async () => {
    const rig = await loadRig();
    // The points the matcher test warps: left (330.43, 234.78) / (361.74, 234.78)
    // to right (309.6, 235.5) / (340.5, 235.5).
    const m = measureLine(
      rig,
      [[330.43, 234.78], [361.74, 234.78]],
      [[309.6, 235.5], [340.5, 235.5]],
    );
    expect(m).not.toBeNull();
    const measurement = m as NonNullable<typeof m>;
    expect(measurement.length).toBeGreaterThan(0);
    expect(measurement.midpoint_range).toBeGreaterThan(0);
    expect(Number.isFinite(measurement.stereo_rms)).toBe(true);
  });
});

describe('aggregateLengths', () => {
  it('averages only the positive lengths', () => {
    expect(aggregateLengths([1, 3, -1, 0])).toBeCloseTo(2, 6);
  });
  it('returns null when nothing is measurable', () => {
    expect(aggregateLengths([])).toBeNull();
    expect(aggregateLengths([-2, 0])).toBeNull();
  });
});
