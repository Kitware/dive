import { readFileSync } from 'fs';
import { fitDisparitySegment } from '../disparitySampling';
import sampleDisparity from './disparitySamplingReference';

const desktopFits: { samples: [number, number][]; expected: [number, number] | null }[] = JSON.parse(readFileSync(new URL('./desktopSegmentFits.json', import.meta.url), 'utf8'));

it('uses the foreground-biased 90th percentile rather than the median', () => {
  const grid = new Float32Array(49).fill(2);
  grid.fill(10, 40);
  expect(sampleDisparity(grid, 7, 7, 7, 7, 3, 3)).toEqual({ disparity: 10, fraction: 1 });
});

it('accepts a single positive neighbour and clips windows at the image border', () => {
  const grid = new Float32Array(49);
  grid[0] = 8;
  expect(sampleDisparity(grid, 7, 7, 7, 7, 0, 0)).toEqual({ disparity: 8, fraction: 1 / 16 });
  expect(sampleDisparity(grid, 7, 7, 7, 7, 6, 6)).toBeNull();
  expect(sampleDisparity(grid, 7, 7, 7, 7, 8, 0)).toBeNull();
});

it('samples a native-pixel neighbourhood from a linearly resized ONNX grid', () => {
  const grid = Float32Array.from({ length: 64 }, (_, i) => (i % 8) + 1);
  // OpenCV resize 8 -> 16: native columns 5..11 give 6.5,7.5,...12.5
  // disparities after multiplying by the width ratio. The 90th percentile is 12.5.
  expect(sampleDisparity(grid, 8, 8, 16, 16, 8, 8)?.disparity).toBeCloseTo(12.5);
});

it('fits endpoint disparity despite three erroneous interior samples', () => {
  const samples: [number, number][] = Array.from({ length: 11 }, (_, i) => [i / 10, 20 + i]);
  [0, 5, 10].forEach((i) => { samples[i][1] = 150 + i * 4; });
  const result = fitDisparitySegment(samples)!;
  expect(result[0]).toBeCloseTo(20);
  expect(result[1]).toBeCloseTo(30);
});

it('refuses insufficient, duplicate, or inconsistent samples', () => {
  expect(fitDisparitySegment(Array.from({ length: 7 }, (_, i) => [i / 10, 20]))).toBeNull();
  expect(fitDisparitySegment(Array.from({ length: 11 }, () => [0, 20]))).toBeNull();
  expect(fitDisparitySegment(Array.from({ length: 11 }, (_, i) => [i / 10, 1 + i * i * 40]))).toBeNull();
});

// Reference results from VIAME's compiled core/disparity_segment.cxx, covering
// noisy linear disparity with zero through five injected outliers.
it.each(desktopFits)('matches native C++ segment fitting %#', ({ samples, expected }) => {
  const actual = fitDisparitySegment(samples as [number, number][]);
  if (expected === null) expect(actual).toBeNull();
  else {
    expect(actual![0]).toBeCloseTo(expected[0], 9);
    expect(actual![1]).toBeCloseTo(expected[1], 9);
  }
});
