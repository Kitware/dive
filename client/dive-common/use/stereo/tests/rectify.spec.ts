/**
 * Rectification is the only new geometry the foundation matcher adds, and it is
 * the part that silently produces plausible-but-wrong warps if it is off. These
 * check it against properties that must hold for any correct rectification,
 * rather than against a golden matrix.
 */

import { describe, it, expect } from 'vitest';

import {
  computeRectification, rectifyPoint, unrectifyPoint, rodrigues, rodriguesInv,
} from '../rectify';
import { StereoRig } from '../calibration';
import { project } from '../triangulate';

const I3 = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]);
const Z3 = Float32Array.from([0, 0, 0]);

/** Project a world point (left-camera frame) into one of the rig's cameras. */
function projectInto(p: [number, number, number], rig: StereoRig, target: boolean): [number, number] {
  return target
    ? project(p, rig.Kr, rig.distr, rig.R, rig.T)
    : project(p, rig.Kl, rig.distl, I3, Z3);
}

const W = 960;
const H = 576;

/** A rig with a mostly-horizontal baseline and a small relative rotation. */
function makeRig(rotation: [number, number, number] = [0.01, -0.02, 0.004]): StereoRig {
  const K = Float32Array.from([1000, 0, 640, 0, 1000, 400, 0, 0, 1]);
  return {
    Kl: K,
    Kr: Float32Array.from(K),
    distl: new Float32Array(8),
    distr: new Float32Array(8),
    R: rodrigues(rotation),
    T: Float32Array.from([-200, -30, -5]),
  };
}

describe('rodrigues', () => {
  it('round-trips a rotation vector through the matrix form', () => {
    const v: [number, number, number] = [0.11, -0.24, 0.07];
    const back = rodriguesInv(rodrigues(v));
    back.forEach((c, i) => expect(c).toBeCloseTo(v[i], 6));
  });

  it('returns identity for a zero rotation', () => {
    const R = rodrigues([0, 0, 0]);
    expect(Array.from(R)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
});

describe('computeRectification', () => {
  it('produces orthonormal rectifying rotations', () => {
    const { R1, R2 } = computeRectification(makeRig(), W, H);
    [R1, R2].forEach((R) => {
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const dot = R[i * 3] * R[j * 3] + R[i * 3 + 1] * R[j * 3 + 1] + R[i * 3 + 2] * R[j * 3 + 2];
          expect(dot).toBeCloseTo(i === j ? 1 : 0, 5);
        }
      }
    });
  });

  it('puts corresponding points on the same rectified row', () => {
    // The defining property of rectification: a 3D point seen by both cameras
    // must land on one row, so disparity is a pure horizontal shift.
    const rig = makeRig();
    const rect = computeRectification(rig, W, H);
    const worldPoints: [number, number, number][] = [
      [0, 0, 3000], [400, -200, 2500], [-350, 250, 4000], [120, 90, 1800],
    ];
    worldPoints.forEach((p) => {
      const left = projectInto(p, rig, false);
      const right = projectInto(p, rig, true);
      const [, ly] = rectifyPoint(left[0], left[1], rig, rect, false);
      const [, ry] = rectifyPoint(right[0], right[1], rig, rect, true);
      expect(ry).toBeCloseTo(ly, 2);
    });
  });

  it('scales the rectified view to a different output size', () => {
    // The network input is smaller than the frame, so rectification must also
    // resize: the same source pixel lands at the same relative position, and a
    // point at a source corner stays inside the output instead of being cropped.
    const rig = makeRig();
    const full = computeRectification(rig, 1280, 800);
    const small = computeRectification(rig, 1280, 800, W, H);
    expect(small.fx).toBeCloseTo(full.fx * (W / 1280), 6);
    expect(small.fy).toBeCloseTo(full.fy * (H / 800), 6);
    // Pixel centres: position relative to the image centre scales with the size.
    [[0, 0], [1279, 799], [640, 400]].forEach(([px, py]) => {
      const [fx, fy] = rectifyPoint(px, py, rig, full, false);
      const [sx, sy] = rectifyPoint(px, py, rig, small, false);
      expect(sx - (W - 1) / 2).toBeCloseTo((fx - (1280 - 1) / 2) * (W / 1280), 3);
      expect(sy - (H - 1) / 2).toBeCloseTo((fy - (800 - 1) / 2) * (H / 800), 3);
    });
    const [cx, cy] = rectifyPoint(640, 400, rig, small, false);
    expect(cx).toBeGreaterThan(W * 0.3);
    expect(cx).toBeLessThan(W * 0.7);
    expect(cy).toBeGreaterThan(H * 0.3);
    expect(cy).toBeLessThan(H * 0.7);
  });

  it('gives a positive disparity that shrinks with range', () => {
    const rig = makeRig();
    const rect = computeRectification(rig, W, H);
    const disparityAt = (z: number) => {
      const p: [number, number, number] = [0, 0, z];
      const [lx] = rectifyPoint(...projectInto(p, rig, false), rig, rect, false);
      const [rx] = rectifyPoint(...projectInto(p, rig, true), rig, rect, true);
      return lx - rx;
    };
    const near = disparityAt(1500);
    const far = disparityAt(6000);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
    expect(near).toBeGreaterThan(far);
  });
});

describe('rectifyPoint / unrectifyPoint', () => {
  it('keeps corresponding points on one row when the output size differs', () => {
    const rig = makeRig();
    const rect = computeRectification(rig, 1280, 800, W, H);
    const p: [number, number, number] = [150, -80, 2200];
    const [, ly] = rectifyPoint(...projectInto(p, rig, false), rig, rect, false);
    const [, ry] = rectifyPoint(...projectInto(p, rig, true), rig, rect, true);
    expect(ry).toBeCloseTo(ly, 2);
  });

  it('round-trips a pixel on both cameras, with and without distortion', () => {
    const plain = makeRig();
    const distorted: StereoRig = {
      ...plain,
      distl: Float32Array.from([-0.16, 0.10, -0.001, 0.002, 0, 0, 0, 0]),
      distr: Float32Array.from([-0.15, 0.09, -0.001, 0.002, 0, 0, 0, 0]),
    };
    [plain, distorted].forEach((rig) => {
      const rect = computeRectification(rig, 1280, 800, W, H);
      [false, true].forEach((target) => {
        [[640, 400], [300, 180], [900, 550]].forEach(([px, py]) => {
          const [rx, ry] = rectifyPoint(px, py, rig, rect, target);
          const [bx, by] = unrectifyPoint(rx, ry, rig, rect, target);
          expect(bx).toBeCloseTo(px, 2);
          expect(by).toBeCloseTo(py, 2);
        });
      });
    });
  });
});
