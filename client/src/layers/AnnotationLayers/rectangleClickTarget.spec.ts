/// <reference types="vitest" />
import {
  candidateOwnsClick,
  pointInsideDetectionShape,
  type RectClickCandidate,
} from './rectangleClickTarget';

function box(
  trackId: number,
  area: number,
  opts: { hasPoly?: boolean; polygons?: RectClickCandidate['polygons'] } = {},
): RectClickCandidate {
  return {
    trackId,
    hasPoly: opts.hasPoly ?? false,
    polygons: opts.polygons ?? [],
    boxArea: area,
  };
}

/** Unit square (0,0)-(10,10) */
const unitOuter = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** Hole in the middle (3,3)-(7,7) */
const unitHole = [
  { x: 3, y: 3 },
  { x: 7, y: 3 },
  { x: 7, y: 7 },
  { x: 3, y: 7 },
];

describe('pointInsideDetectionShape', () => {
  it('treats box-only detections as containing any point', () => {
    expect(pointInsideDetectionShape(box(1, 100), { x: 999, y: 999 })).toBe(true);
  });

  it('uses polygon outer rings when present', () => {
    const det = box(1, 100, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    expect(pointInsideDetectionShape(det, { x: 5, y: 5 })).toBe(true);
    expect(pointInsideDetectionShape(det, { x: 50, y: 50 })).toBe(false);
  });

  it('excludes holes', () => {
    const det = box(1, 100, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [unitHole] }],
    });
    expect(pointInsideDetectionShape(det, { x: 1, y: 1 })).toBe(true);
    expect(pointInsideDetectionShape(det, { x: 5, y: 5 })).toBe(false);
  });
});

describe('candidateOwnsClick', () => {
  it('lets a lone detection keep envelope clicks outside its polygon', () => {
    const lone = box(1, 100, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    expect(candidateOwnsClick(1, [lone], { x: 50, y: 50 })).toBe(true);
  });

  it('yields a large poly envelope to a nested box-only hit', () => {
    const large = box(1, 10000, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    const nested = box(2, 100);
    // Outside large poly, inside both boxes (pointSearch already filtered)
    expect(candidateOwnsClick(1, [large, nested], { x: 50, y: 50 })).toBe(false);
    expect(candidateOwnsClick(2, [large, nested], { x: 50, y: 50 })).toBe(true);
  });

  it('prefers nested smallest box when click is outside every polygon', () => {
    const large = box(1, 10000, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    const nested = box(2, 100, {
      hasPoly: true,
      polygons: [{
        outer: [
          { x: 40, y: 40 },
          { x: 45, y: 40 },
          { x: 45, y: 45 },
          { x: 40, y: 45 },
        ],
        holes: [],
      }],
    });
    // Outside both polys
    expect(candidateOwnsClick(1, [large, nested], { x: 50, y: 50 })).toBe(false);
    expect(candidateOwnsClick(2, [large, nested], { x: 50, y: 50 })).toBe(true);
  });

  it('limits ownership to shape hits when at least one polygon contains the point', () => {
    const large = box(1, 10000, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    const nested = box(2, 100, {
      hasPoly: true,
      polygons: [{
        outer: [
          { x: 20, y: 20 },
          { x: 25, y: 20 },
          { x: 25, y: 25 },
          { x: 20, y: 25 },
        ],
        holes: [],
      }],
    });
    // Inside large poly only
    expect(candidateOwnsClick(1, [large, nested], { x: 5, y: 5 })).toBe(true);
    expect(candidateOwnsClick(2, [large, nested], { x: 5, y: 5 })).toBe(false);
  });

  it('allows every shape hit to own when multiple polygons contain the point', () => {
    const large = box(1, 10000, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [] }],
    });
    const nested = box(2, 100);
    // Nested is box-only so any candidate hit counts as a shape hit
    expect(candidateOwnsClick(1, [large, nested], { x: 5, y: 5 })).toBe(true);
    expect(candidateOwnsClick(2, [large, nested], { x: 5, y: 5 })).toBe(true);
  });

  it('lets a nested annotation in a hole own the click', () => {
    const large = box(1, 10000, {
      hasPoly: true,
      polygons: [{ outer: unitOuter, holes: [unitHole] }],
    });
    const nested = box(2, 10);
    // Inside large outer, inside hole → not a shape hit for large; nested box wins
    expect(candidateOwnsClick(1, [large, nested], { x: 5, y: 5 })).toBe(false);
    expect(candidateOwnsClick(2, [large, nested], { x: 5, y: 5 })).toBe(true);
  });
});
