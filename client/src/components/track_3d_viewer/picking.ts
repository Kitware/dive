/**
 * Picking a track by where it is drawn on screen: the nearest outline within a
 * few pixels of the click wins.
 */
export type Point2 = [number, number];

export interface Outline<Id> {
  id: Id;
  /** One or more connected points, in screen pixels. */
  points: Point2[];
}

function distanceToSegment([px, py]: Point2, [ax, ay]: Point2, [bx, by]: Point2) {
  const [dx, dy] = [bx - ax, by - ay];
  const lengthSquared = dx * dx + dy * dy;
  const along = lengthSquared === 0
    ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + along * dx), py - (ay + along * dy));
}

export function distanceToOutline(point: Point2, points: Point2[]) {
  if (points.length === 0) {
    return Infinity;
  }
  if (points.length === 1) {
    return Math.hypot(point[0] - points[0][0], point[1] - points[0][1]);
  }
  return Math.min(...points.slice(1).map((end, i) => distanceToSegment(point, points[i], end)));
}

export function nearestOutline<Id>(
  outlines: Outline<Id>[],
  point: Point2,
  tolerance: number,
): Id | null {
  let nearest: Id | null = null;
  let best = tolerance;
  outlines.forEach(({ id, points }) => {
    const distance = distanceToOutline(point, points);
    if (distance <= best) {
      best = distance;
      nearest = id;
    }
  });
  return nearest;
}
