import { readFileSync } from 'fs';
import { DisparitySampler } from '../DisparitySampler';
import sampleDisparity from './disparitySamplingReference';

let sampler: DisparitySampler;
beforeAll(async () => {
  sampler = await DisparitySampler.create(readFileSync(new URL('../../../../public/models/stereo_sample.onnx', import.meta.url)));
});
afterAll(async () => { await sampler?.dispose(); });

it.each([[7, 7, 7, 7], [19, 11, 120, 80], [1, 1, 8, 4], [16, 12, 8, 6]])('matches the previous sampler at model %ix%i and source %ix%i', async (w, h, sw, sh) => {
  const grid = Float32Array.from({ length: w * h }, (_, i) => (i % 7 ? 1 + ((i * 37) % 113) / 10 : 0));
  const points: [number, number][] = [
    [0, 0], [sw - 1, sh - 1], [-2, 0], [NaN, 1], [Infinity, 0], [-0.6, 0.4], [sw, 0],
    [sw / 2, sh / 2], [sw / 3, sh / 3], [1.49, 2.51],
  ];
  const actual = await sampler.run(grid, w, h, sw, sh, points);
  points.forEach(([x, y], i) => {
    const expected = sampleDisparity(grid, w, h, sw, sh, x, y);
    if (!expected) expect(actual[i]).toBeNull();
    else {
      expect(actual[i]!.disparity).toBeCloseTo(expected.disparity, 4);
      expect(actual[i]!.fraction).toBeCloseTo(expected.fraction, 6);
    }
  });
});

it('selects the foreground percentile and accepts one valid border sample', async () => {
  const grid = new Float32Array(49).fill(2);
  grid.fill(10, 40);
  expect(await sampler.run(grid, 7, 7, 7, 7, [[3, 3]])).toEqual([{ disparity: 10, fraction: 1 }]);
  grid.fill(0); grid[0] = 8;
  expect(await sampler.run(grid, 7, 7, 7, 7, [[0, 0], [6, 6]])).toEqual([{ disparity: 8, fraction: 1 / 16 }, null]);
});

it('rejects nonfinite and nonpositive neighbourhoods and handles no prompts', async () => {
  await Promise.all([0, -1, NaN, Infinity].map(async (value) => {
    expect(await sampler.run(new Float32Array(49).fill(value), 7, 7, 7, 7, [[3, 3]])).toEqual([null]);
  }));
  expect(await sampler.run(new Float32Array(49), 7, 7, 7, 7, [])).toEqual([]);
  await expect(sampler.run(new Float32Array(1), 7, 7, 7, 7, [[0, 0]])).rejects.toThrow('dimensions');
});

it('serializes concurrent requests without retaining the previous frame', async () => {
  const results = await Promise.all([1, 5, 9].map((value) => sampler.run(new Float32Array(49).fill(value), 7, 7, 7, 7, [[3, 3]])));
  expect(results.map((r) => r[0]?.disparity)).toEqual([1, 5, 9]);
});
