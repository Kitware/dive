/// <reference types="vitest" />
import {
  candidateOwnsClick,
  distanceToRingSquared,
  pointInsideDetectionShape,
} from './rectangleClickTarget';
import type { Point2D, RectClickCandidate } from './rectangleClickTarget';

function rectRing(x1: number, y1: number, x2: number, y2: number): Point2D[] {
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}

function box(
  trackId: number,
  ring: Point2D[],
  opts: { hasPoly?: boolean; polygons?: RectClickCandidate['polygons'] } = {},
): RectClickCandidate {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const boxArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  return {
    trackId,
    hasPoly: opts.hasPoly ?? false,
    polygons: opts.polygons ?? [],
    boxRing: ring,
    boxArea,
  };
}

/** Unit square (0,0)-(10,10) */
const unitOuter = rectRing(0, 0, 10, 10);

/** Hole in the middle (3,3)-(7,7) */
const unitHole = rectRing(3, 3, 7, 7);

describe('pointInsideDetectionShape', () => {
  it('treats box-only detections as containing any point', () => {
    expect(pointInsideDetectionShape(box(1, unitOuter), { x: 999, y: 999 })).toBe(true);
  });

  it('uses polygon outer rings when present', () => {
    const det = box(1, unitOuter, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    expect(pointInsideDetectionShape(det, { x: 5, y: 5 })).toBe(true);
    expect(pointInsideDetectionShape(det, { x: 50, y: 50 })).toBe(false);
  });

  it('excludes holes', () => {
    const det = box(1, unitOuter, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [unitHole] }],
    });
    expect(pointInsideDetectionShape(det, { x: 1, y: 1 })).toBe(true);
    expect(pointInsideDetectionShape(det, { x: 5, y: 5 })).toBe(false);
  });
});

describe('distanceToRingSquared', () => {
  it('is zero on the border and smaller nearer the edge', () => {
    expect(distanceToRingSquared({ x: 0, y: 5 }, unitOuter)).toBe(0);
    expect(distanceToRingSquared({ x: 1, y: 5 }, unitOuter))
      .toBeLessThan(distanceToRingSquared({ x: 5, y: 5 }, unitOuter));
  });
});

describe('candidateOwnsClick', () => {
  it('lets a lone detection keep envelope clicks outside its polygon', () => {
    const lone = box(1, rectRing(0, 0, 100, 100), {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    expect(candidateOwnsClick(1, [lone], { x: 50, y: 50 })).toBe(true);
  });

  it('yields a large poly envelope to a nested box-only hit', () => {
    const large = box(1, rectRing(0, 0, 100, 100), {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    const nested = box(2, rectRing(40, 40, 60, 60));
    // Outside large poly, inside both boxes (pointSearch already filtered)
    expect(candidateOwnsClick(1, [large, nested], { x: 50, y: 50 })).toBe(false);
    expect(candidateOwnsClick(2, [large, nested], { x: 50, y: 50 })).toBe(true);
  });

  it('uses closest border among envelope hits outside every polygon', () => {
    const large = box(1, rectRing(0, 0, 100, 100), {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    const nested = box(2, rectRing(40, 40, 60, 60), {
      hasPoly: true,
      polygons: [{ outer: rectRing(42, 42, 44, 44), holes: [] }],
    });
    // Outside both polys, inside both boxes — nearer the nested border
    expect(candidateOwnsClick(1, [large, nested], { x: 50, y: 50 })).toBe(false);
    expect(candidateOwnsClick(2, [large, nested], { x: 50, y: 50 })).toBe(true);
  });

  it('limits ownership to shape hits when at least one polygon contains the point', () => {
    const large = box(1, rectRing(0, 0, 100, 100), {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    const nested = box(2, rectRing(40, 40, 60, 60), {
      hasPoly: true,
      polygons: [{ outer: rectRing(20, 20, 25, 25), holes: [] }],
    });
    // Inside large poly only
    expect(candidateOwnsClick(1, [large, nested], { x: 5, y: 5 })).toBe(true);
    expect(candidateOwnsClick(2, [large, nested], { x: 5, y: 5 })).toBe(false);
  });

  it('among overlapping shape hits, picks the closest rectangle border', () => {
    const large = box(1, rectRing(0, 0, 100, 100), {
      hasPoly: true,
      polygons: [{ outer: rectRing(0, 0, 100, 100), holes: [] }],
    });
    const nested = box(2, rectRing(40, 40, 60, 60));
    // Both are shape hits and the point is inside both boxes; nested border is closer
    expect(candidateOwnsClick(1, [large, nested], { x: 50, y: 50 })).toBe(false);
    expect(candidateOwnsClick(2, [large, nested], { x: 50, y: 50 })).toBe(true);
  });

  it('lets a nested annotation in a hole own the click', () => {
    const large = box(1, rectRing(0, 0, 10, 10), {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [unitHole] }],
    });
    const nested = box(2, rectRing(4, 4, 6, 6));
    // Inside large outer, inside hole → not a shape hit for large; nested box wins
    expect(candidateOwnsClick(1, [large, nested], { x: 5, y: 5 })).toBe(false);
    expect(candidateOwnsClick(2, [large, nested], { x: 5, y: 5 })).toBe(true);
  });
});
