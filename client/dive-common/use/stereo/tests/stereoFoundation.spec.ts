/**
 * The foundation matcher's bookkeeping — preprocessing, per-frame disparity
 * caching, prefetch dropping, serialised inference — runs here against a fake
 * session returning a constant disparity, so the geometry it implies is known.
 *
 * The real export (~100 MB) is not in the repo. Point
 * DIVE_STEREO_FOUNDATION_MODEL at a `fast_foundation_stereo_l.onnx` (from
 * VIAME's FAST-FDN-STEREO add-on) to also check its I/O contract.
 */

import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import * as ort from 'onnxruntime-web';
import {
  describe, it, expect,
} from 'vitest';

import {
  StereoFoundationMatcher, remapToInputTensor, DisparitySession, WEBGPU_REQUIRED_MESSAGE,
} from '../StereoFoundationMatcher';
import { rigFromNpz, StereoRig } from '../calibration';
import { rodrigues, computeRectification, rectifyPoint } from '../rectify';
import { RgbaImage } from '../image';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

const SPEC = { width: 96, height: 64 };
const SRC = { width: 320, height: 240 };

function makeRig(): StereoRig {
  const K = Float32Array.from([300, 0, 160, 0, 300, 120, 0, 0, 1]);
  return {
    Kl: K,
    Kr: Float32Array.from(K),
    distl: new Float32Array(8),
    distr: new Float32Array(8),
    R: rodrigues([0, 0, 0]),
    T: Float32Array.from([-100, 0, 0]),
  };
}

function solidImage(width: number, height: number, rgb: [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set([...rgb, 255], i * 4);
  }
  return { data, width, height };
}

/** Returns a constant disparity and counts runs; `gate` can hold a run open. */
function fakeSession(disparity: number): DisparitySession & { runs: number; feeds: Record<string, ort.Tensor>[] } {
  const session = {
    runs: 0,
    feeds: [] as Record<string, ort.Tensor>[],
    async run(feeds: Record<string, ort.Tensor>) {
      session.runs += 1;
      session.feeds.push(feeds);
      const plane = SPEC.width * SPEC.height;
      return {
        disparity: new ort.Tensor('float32', new Float32Array(plane).fill(disparity), [1, 1, SPEC.height, SPEC.width]),
      };
    },
  };
  return session;
}

const RANGE = { range: { minDisparity: 1, maxDisparity: 200 } };

describe('remapToInputTensor', () => {
  it('produces ImageNet-normalised RGB planes and black outside the source', () => {
    const img = solidImage(4, 4, [255, 128, 0]);
    const mapX = Float32Array.from([1, 1, -5]);
    const mapY = Float32Array.from([1, 2, 1]);
    const t = remapToInputTensor(img, mapX, mapY, 3, 1);
    expect(t.dims).toEqual([1, 3, 1, 3]);
    const d = t.data;
    expect(d[0]).toBeCloseTo((1 - 0.485) / 0.229, 4);
    expect(d[3]).toBeCloseTo((128 / 255 - 0.456) / 0.224, 4);
    expect(d[6]).toBeCloseTo((0 - 0.406) / 0.225, 4);
    // Outside the source: black, not zero-after-normalisation.
    expect(d[2]).toBeCloseTo((0 - 0.485) / 0.229, 4);
  });

  it('accepts a grayscale frame by replicating it across channels', () => {
    const gray = { data: Float32Array.from([200, 200, 200, 200]), width: 2, height: 2 };
    const t = remapToInputTensor(gray, Float32Array.from([0.5]), Float32Array.from([0.5]), 1, 1);
    const d = t.data;
    expect(d[0]).toBeCloseTo((200 / 255 - 0.485) / 0.229, 4);
    expect(d[1]).toBeCloseTo((200 / 255 - 0.456) / 0.224, 4);
  });
});

describe('StereoFoundationMatcher.create', () => {
  it('refuses to run without WebGPU rather than falling back to wasm', async () => {
    await expect(StereoFoundationMatcher.create(new Uint8Array(0), SPEC)).rejects.toThrow(WEBGPU_REQUIRED_MESSAGE);
  });
});

describe('StereoFoundationMatcher with a fake session', () => {
  const rig = makeRig();
  const left = solidImage(SRC.width, SRC.height, [10, 20, 30]);
  const right = solidImage(SRC.width, SRC.height, [30, 20, 10]);
  const points: [number, number][] = [[160, 120], [200, 100]];

  it('shifts each point by the disparity, scaled back to source pixels', async () => {
    const disparity = 6;
    const matcher = new StereoFoundationMatcher(fakeSession(disparity), SPEC);
    const res = await matcher.warpPoints(points, left, right, rig, RANGE);
    const rect = computeRectification(rig, SRC.width, SRC.height, SPEC.width, SPEC.height);
    res.forEach((r, i) => {
      const [px, py] = points[i];
      const [rx] = rectifyPoint(px, py, rig, rect, false);
      expect(r.accepted).toBe(true);
      expect(r.score).toBe(1);
      // Aligned identical cameras: rectification is a pure scale, so the
      // shift in source pixels is the disparity divided by the scale.
      expect(r.x).toBeCloseTo(px - disparity / (SPEC.width / SRC.width), 3);
      expect(r.y).toBeCloseTo(py, 3);
      expect(rx).toBeGreaterThan(disparity);
    });
  });

  it('feeds the model at its own resolution', async () => {
    const session = fakeSession(4);
    const matcher = new StereoFoundationMatcher(session, SPEC);
    await matcher.warpPoints(points, left, right, rig, RANGE);
    expect(session.feeds[0].left_image.dims).toEqual([1, 3, SPEC.height, SPEC.width]);
    expect(session.feeds[0].right_image.dims).toEqual([1, 3, SPEC.height, SPEC.width]);
  });

  it('rejects a disparity outside the configured range', async () => {
    const matcher = new StereoFoundationMatcher(fakeSession(6), SPEC);
    // 6 model px = 20 source px; a range that excludes it must reject.
    const res = await matcher.warpPoints(points, left, right, rig, { range: { minDisparity: 30, maxDisparity: 200 } });
    expect(res.every((r) => !r.accepted)).toBe(true);
    expect(res.every((r) => Number.isFinite(r.x))).toBe(true);
  });

  it('reuses the disparity map across warps with the same frame key', async () => {
    const session = fakeSession(4);
    const matcher = new StereoFoundationMatcher(session, SPEC);
    await matcher.warpPoints(points, left, right, rig, { ...RANGE, frameKey: 'a>b@1' });
    await matcher.warpPoints(points.slice(0, 1), left, right, rig, { ...RANGE, frameKey: 'a>b@1' });
    expect(session.runs).toBe(1);
    await matcher.warpPoints(points, left, right, rig, { ...RANGE, frameKey: 'a>b@2' });
    expect(session.runs).toBe(2);
    // Without a key nothing can be reused.
    await matcher.warpPoints(points, left, right, rig, RANGE);
    await matcher.warpPoints(points, left, right, rig, RANGE);
    expect(session.runs).toBe(4);
  });

  it('prepare makes the following warp free', async () => {
    const session = fakeSession(4);
    const matcher = new StereoFoundationMatcher(session, SPEC);
    await matcher.prepare('a>b@7', left, right, rig);
    expect(session.runs).toBe(1);
    expect(matcher.isPrepared('a>b@7', rig, left)).toBe(true);
    await matcher.warpPoints(points, left, right, rig, { ...RANGE, frameKey: 'a>b@7' });
    expect(session.runs).toBe(1);
  });

  it('drops a prefetch that is no longer wanted, but not one a warp is waiting on', async () => {
    const session = fakeSession(4);
    const matcher = new StereoFoundationMatcher(session, SPEC);
    await matcher.prepare('stale', left, right, rig, () => false);
    expect(session.runs).toBe(0);
    expect(matcher.isPrepared('stale', rig, left)).toBe(false);

    // Queue a prefetch that would be stale, then ask for its result before it
    // runs: the warp must upgrade it rather than get nothing.
    const prefetch = matcher.prepare('upgraded', left, right, rig, () => false);
    const warp = matcher.warpPoints(points, left, right, rig, { ...RANGE, frameKey: 'upgraded' });
    await Promise.all([prefetch, warp]);
    expect(session.runs).toBe(1);
    expect((await warp)[0].accepted).toBe(true);
  });

  it('runs one inference at a time and dedupes concurrent requests for a frame', async () => {
    let active = 0;
    let maxActive = 0;
    const session: DisparitySession & { runs: number } = {
      runs: 0,
      async run() {
        session.runs += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        active -= 1;
        const plane = SPEC.width * SPEC.height;
        return { disparity: new ort.Tensor('float32', new Float32Array(plane).fill(3), [1, 1, SPEC.height, SPEC.width]) };
      },
    };
    const matcher = new StereoFoundationMatcher(session, SPEC);
    await Promise.all([
      matcher.prepare('f1', left, right, rig),
      matcher.warpPoints(points, left, right, rig, { ...RANGE, frameKey: 'f1' }),
      matcher.prepare('f2', left, right, rig),
      matcher.warpPoints(points, left, right, rig, { ...RANGE, frameKey: 'f2' }),
    ]);
    expect(session.runs).toBe(2);
    expect(maxActive).toBe(1);
  });

  it('evicts the least recently used map beyond the cache size', async () => {
    const session = fakeSession(4);
    const matcher = new StereoFoundationMatcher(session, SPEC, 2);
    await matcher.prepare('k1', left, right, rig);
    await matcher.prepare('k2', left, right, rig);
    await matcher.warpPoints(points, left, right, rig, { ...RANGE, frameKey: 'k1' });
    await matcher.prepare('k3', left, right, rig);
    expect(matcher.isPrepared('k1', rig, left)).toBe(true);
    expect(matcher.isPrepared('k2', rig, left)).toBe(false);
    expect(matcher.isPrepared('k3', rig, left)).toBe(true);
    expect(session.runs).toBe(3);
  });

  it('remembers an inference failure instead of retrying every frame', async () => {
    let runs = 0;
    const session: DisparitySession = {
      async run() {
        runs += 1;
        throw new Error('[WebGPU] Kernel failed');
      },
    };
    const matcher = new StereoFoundationMatcher(session, SPEC);
    await expect(matcher.prepare('f1', left, right, rig)).rejects.toThrow('Kernel failed');
    await expect(matcher.warpPoints(points, left, right, rig, { ...RANGE, frameKey: 'f2' })).rejects.toThrow('Kernel failed');
    expect(runs).toBe(1);
    expect(matcher.lastFailure?.message).toContain('Kernel failed');
  });

  it('keys the cache by rig so a new calibration is not served an old map', async () => {
    const session = fakeSession(4);
    const matcher = new StereoFoundationMatcher(session, SPEC);
    await matcher.prepare('f', left, right, rig);
    const other = { ...rig, T: Float32Array.from([-120, 0, 0]) };
    expect(matcher.isPrepared('f', other, left)).toBe(false);
    await matcher.warpPoints(points, left, right, other, { ...RANGE, frameKey: 'f' });
    expect(session.runs).toBe(2);
  });
});

const realModel = process.env.DIVE_STEREO_FOUNDATION_MODEL;

describe.skipIf(!realModel || !existsSync(realModel))('the served export', () => {
  // Running it needs WebGPU (the CPU path needs ~7 GB, past the wasm heap), so
  // Node can only check the graph honours the contract the matcher assumes.
  it('exposes left_image/right_image -> disparity at the sidecar resolution', async () => {
    const session = await ort.InferenceSession.create(realModel as string, {
      executionProviders: ['wasm'],
    });
    expect(session.inputNames).toEqual(['left_image', 'right_image']);
    expect(session.outputNames).toEqual(['disparity']);
    const rig = await rigFromNpz(readFileSync(fixture('calibration.npz')));
    const png = PNG.sync.read(readFileSync(fixture('left.png')));
    const rect = computeRectification(rig, png.width, png.height, 960, 576);
    expect(rect.width).toBe(960);
    expect(rect.height).toBe(576);
  }, 120000);
});
