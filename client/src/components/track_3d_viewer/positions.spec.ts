import { featurePosition, robustBounds, Vec3 } from './positions';

describe('featurePosition', () => {
  it('reads the midpoint, from numbers or numeric strings', () => {
    expect(featurePosition({ midpoint_x: 1, midpoint_y: '2.5', midpoint_z: -3 }))
      .toEqual({ x: 1, y: 2.5, z: -3 });
  });

  it('includes head and tail only when both are complete', () => {
    const midpoint = { midpoint_x: 1, midpoint_y: 1, midpoint_z: 1 };
    const head = { head_x: 0, head_y: 0, head_z: 0 };
    expect(featurePosition({
      ...midpoint, ...head, tail_x: 2, tail_y: 2, tail_z: 2,
    })).toEqual({
      x: 1, y: 1, z: 1, head: [0, 0, 0], tail: [2, 2, 2],
    });
    expect(featurePosition({ ...midpoint, ...head, tail_x: 2 })).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('falls back to the middle of head and tail without a midpoint', () => {
    expect(featurePosition({
      head_x: 0, head_y: 0, head_z: 10, tail_x: 4, tail_y: 2, tail_z: 20,
    })).toMatchObject({ x: 2, y: 1, z: 15 });
  });

  it('is null without a usable position', () => {
    expect(featurePosition(undefined)).toBeNull();
    expect(featurePosition({ length: 10 })).toBeNull();
    expect(featurePosition({ midpoint_x: 1, midpoint_y: '', midpoint_z: 3 })).toBeNull();
  });
});

describe('robustBounds', () => {
  it('spans all points when none is an outlier', () => {
    expect(robustBounds([[0, 0, 10], [2, 4, 20], [1, 2, 15]])).toEqual([0, 2, 0, 4, 10, 20]);
  });

  it('leaves out points far from the rest', () => {
    const points: Vec3[] = Array.from({ length: 20 }, (_, i) => [i, 0, 1000 + i]);
    points.push([5, 0, 684541]);
    expect(robustBounds(points)).toEqual([0, 19, 0, 0, 1000, 1019]);
  });

  it('is null without points', () => {
    expect(robustBounds([])).toBeNull();
  });
});
