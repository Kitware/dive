import { polygonContains } from 'd3';
import { maskGeometry, maskKeypoints, maskSeeds } from './maskGeometry';

it('keeps disjoint components and holes, with full-resolution RLE', () => {
  const mask = new Uint8Array(30 * 20);
  for (let y = 2; y < 18; y += 1) {
    for (let x = 2; x < 28; x += 1) {
      if ((x < 15 || x > 20) && !(x > 5 && x < 10 && y > 5 && y < 12)) mask[y * 30 + x] = 1;
    }
  }
  const result = maskGeometry(mask, 30, 20);
  expect(result.success).toBe(true);
  expect(result.polygons).toHaveLength(2);
  expect(result.polygons!.flatMap((p) => p.holes)).toHaveLength(1);
  expect(result.maskShape).toEqual([20, 30]);
  expect(result.rleMask!.flatMap(([value, count]) => Array(count).fill(value))).toEqual([...mask]);
  const seeds = maskSeeds(result.polygons!);
  expect(seeds.length).toBeGreaterThan(1);
  seeds.forEach((point) => expect(result.polygons!.some((p) => polygonContains(p.exterior, point)
    && !p.holes.some((hole) => polygonContains(hole, point)))).toBe(true));
});

it('derives hull-extremes head/tail across all components and clips to their boundaries', () => {
  const a = { exterior: [[0, 0], [10, 0], [10, 4], [0, 4]] as [number, number][], holes: [] };
  const b = { exterior: [[15, 0], [20, 0], [20, 4], [15, 4]] as [number, number][], holes: [] };
  expect(maskKeypoints([a, b])).toEqual({ success: true, head: [20, 2], tail: [0, 2] });
});

it('returns a failure for an empty mask rather than an infinite bounding box', () => {
  expect(maskGeometry(new Uint8Array(100), 10, 10).success).toBe(false);
});
