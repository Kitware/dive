import { distanceToOutline, nearestOutline } from './picking';

describe('picking', () => {
  it('measures to the nearest part of a polyline', () => {
    expect(distanceToOutline([5, 3], [[0, 0], [10, 0], [10, 10]])).toBe(3);
    expect(distanceToOutline([-3, -4], [[0, 0], [10, 0]])).toBe(5);
    expect(distanceToOutline([3, 4], [[0, 0]])).toBe(5);
    expect(distanceToOutline([0, 0], [])).toBe(Infinity);
  });

  it('picks the closest outline within the tolerance', () => {
    const outlines = [
      { id: 7, points: [[0, 0], [100, 0]] as [number, number][] },
      { id: 0, points: [[0, 10], [100, 10]] as [number, number][] },
    ];
    expect(nearestOutline(outlines, [50, 8], 6)).toBe(0);
    expect(nearestOutline(outlines, [50, 2], 6)).toBe(7);
    expect(nearestOutline(outlines, [50, 40], 6)).toBeNull();
  });
});
