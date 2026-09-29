/**
 * Picking a track by the ball drawn at its current position: a click inside a
 * ball selects it, the nearest center winning where balls overlap.
 */
export type Point2 = [number, number];

export interface Ball<Id> {
  id: Id;
  /** In screen pixels. */
  center: Point2;
  radius: number;
}

export function ballAt<Id>(balls: Ball<Id>[], point: Point2, minimumRadius: number): Id | null {
  let picked: Id | null = null;
  let best = Infinity;
  balls.forEach(({ id, center, radius }) => {
    const distance = Math.hypot(point[0] - center[0], point[1] - center[1]);
    // Far away balls shrink to a few pixels, too small to hit without some allowance
    if (distance <= Math.max(radius, minimumRadius) && distance < best) {
      best = distance;
      picked = id;
    }
  });
  return picked;
}
