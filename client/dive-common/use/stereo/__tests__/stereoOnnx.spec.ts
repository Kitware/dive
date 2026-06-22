import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import {
  describe, it, expect,
} from 'vitest';
import { StereoOnnxMatcher } from '../StereoOnnxMatcher';
import { rigFromNpz, baseline } from '../calibration';
import { rgbaToGray, GrayImage } from '../image';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

function loadGray(name: string): GrayImage {
  const png = PNG.sync.read(readFileSync(fixture(name)));
  return rgbaToGray({ data: png.data, width: png.width, height: png.height });
}

describe('rgbaToGray', () => {
  it('uses BT.601 luma weights', () => {
    const red = rgbaToGray({ data: new Uint8ClampedArray([255, 0, 0, 255]), width: 1, height: 1 });
    expect(red.data[0]).toBeCloseTo(0.299 * 255, 2);
  });
  it('passes through gray pixels', () => {
    const g = rgbaToGray({ data: new Uint8ClampedArray([123, 123, 123, 255]), width: 1, height: 1 });
    expect(g.data[0]).toBeCloseTo(123, 4);
  });
});

describe('rigFromNpz', () => {
  it('parses the calibration archive into a stereo rig', async () => {
    const rig = await rigFromNpz(readFileSync(fixture('calibration.npz')));
    expect(rig.Kl).toHaveLength(9);
    expect(rig.Kr).toHaveLength(9);
    expect(rig.distl).toHaveLength(8);
    expect(rig.R).toHaveLength(9);
    expect(rig.T).toHaveLength(3);
    expect(rig.Kl[0]).toBeGreaterThan(0); // fx
    expect(rig.Kl[8]).toBeCloseTo(1, 6); // homogeneous 1
    expect(baseline(rig)).toBeGreaterThan(0);
  });

  it('handles a Uint8Array view with a non-zero byteOffset (pool-safe)', async () => {
    // Node's readFileSync returns a Buffer backed by a shared pool, so a naive
    // `.buffer` read sees bytes beyond the file. Mimic that here.
    const file = readFileSync(fixture('calibration.npz'));
    const backing = new Uint8Array(file.length + 64);
    backing.set(file, 32);
    const view = backing.subarray(32, 32 + file.length);
    const rig = await rigFromNpz(view);
    expect(rig.Kl).toHaveLength(9);
    expect(baseline(rig)).toBeGreaterThan(0);
  });
});

describe('StereoOnnxMatcher.warpPoints', () => {
  it('warps points to the right image matching the VIAME reference', async () => {
    const rig = await rigFromNpz(readFileSync(fixture('calibration.npz')));
    const left = loadGray('left.png');
    const right = loadGray('right.png');
    const matcher = await StereoOnnxMatcher.create(fixture('stereo_match.onnx'));

    const pts: [number, number][] = [[330.43, 234.78], [361.74, 234.78]];
    const res = await matcher.warpPoints(pts, left, right, rig, {
      range: { minDisparity: 8, maxDisparity: 700 },
    });

    // Reference (VIAME C++ / Python ONNX): head -> (~309.6, ~235.5),
    // tail -> (~340.5, ~235.5), both confident matches.
    expect(res[0].x).toBeCloseTo(309.6, 0);
    expect(res[0].y).toBeCloseTo(235.5, 0);
    expect(res[1].x).toBeCloseTo(340.5, 0);
    expect(res[1].y).toBeCloseTo(235.5, 0);
    expect(res[0].score).toBeGreaterThan(0.9);
    expect(res[0].accepted).toBe(true);
    expect(res[1].accepted).toBe(true);
  }, 60000);
});
