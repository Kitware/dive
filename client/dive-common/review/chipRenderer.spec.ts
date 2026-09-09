import { chipRegion, chipSizeFor, frameRegion } from './chipRenderer';

describe('chipRegion', () => {
  it('is a square centred on the box, padded on every side', () => {
    const region = chipRegion([10, 20, 30, 60], 0.5);
    // Longer side 40, padded by 50% each side -> 80.
    expect(region).toEqual({
      x: 20 - 40, y: 40 - 40, width: 80, height: 80,
    });
  });

  it('extends the square to the requested aspect ratio, keeping the box centred', () => {
    const wide = chipRegion([10, 20, 30, 60], 0, 2);
    expect(wide).toEqual({
      x: 20 - 40, y: 40 - 20, width: 80, height: 40,
    });
    const tall = chipRegion([10, 20, 30, 60], 0, 0.5);
    expect(tall).toEqual({
      x: 20 - 20, y: 40 - 40, width: 40, height: 80,
    });
    expect(chipRegion([0, 0, 10, 10], 0, Number.NaN).width).toBe(10);
  });

  it('tolerates inverted or degenerate boxes', () => {
    expect(chipRegion([30, 60, 10, 20], 0).width).toBe(40);
    expect(chipRegion([5, 5, 5, 5], 0).width).toBe(1);
    expect(chipRegion([0, 0, 10, 10], -1).width).toBe(10);
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

describe('frameRegion', () => {
  it('covers the whole frame, padding the shorter direction to the aspect', () => {
    expect(frameRegion(100, 50, 2)).toEqual({
      x: 0, y: 0, width: 100, height: 50,
    });
    expect(frameRegion(100, 50, 1)).toEqual({
      x: 0, y: -25, width: 100, height: 100,
    });
    expect(frameRegion(100, 50, 4)).toEqual({
      x: -50, y: 0, width: 200, height: 50,
    });
  });
});
