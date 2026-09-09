import { chipRegion, chipSizeFor } from './chipRenderer';

describe('chipRegion', () => {
  it('is a square centred on the box, padded on every side', () => {
    const region = chipRegion([10, 20, 30, 60], 0.5);
    // Longer side 40, padded by 50% each side -> 80.
    expect(region.side).toBe(80);
    expect(region.x).toBe(20 - 40);
    expect(region.y).toBe(40 - 40);
  });

  it('tolerates inverted or degenerate boxes', () => {
    expect(chipRegion([30, 60, 10, 20], 0).side).toBe(40);
    expect(chipRegion([5, 5, 5, 5], 0).side).toBe(1);
    expect(chipRegion([0, 0, 10, 10], -1).side).toBe(10);
  });
});

describe('chipSizeFor', () => {
  it('rounds cell sizes up to a bucket and caps at the largest', () => {
    expect(chipSizeFor(100)).toBe(128);
    expect(chipSizeFor(128)).toBe(128);
    expect(chipSizeFor(129)).toBe(192);
    expect(chipSizeFor(5000)).toBe(768);
  });
});
