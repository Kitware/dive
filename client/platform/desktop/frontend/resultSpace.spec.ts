import {
  DEFAULT_ORBIT, normalizePositions, orbitDrag, orbitZoom, paintOrder, pick, project, rotate,
} from './resultSpace';

const viewport = { width: 400, height: 300 };

it('normalizes the farthest point onto the unit sphere and keeps the origin fixed', () => {
  const points = normalizePositions([
    { key: 'a', position: [0, 0, 0] },
    { key: 'b', position: [3, 0, 4] },
    { key: 'c', position: [0, 2.5, 0] },
  ]);
  expect(points[0].position).toEqual([0, 0, 0]);
  expect(points[1].position).toEqual([0.6, 0, 0.8]);
  expect(points[2].position).toEqual([0, 0.5, 0]);
  expect(normalizePositions([{ key: 'a', position: [0, 0, 0] }])[0].position).toEqual([0, 0, 0]);
});

it('projects the origin to the viewport center and nearer points larger', () => {
  const orbit = { yaw: 0, pitch: 0, zoom: 1 };
  const [origin, near, far] = project([
    { key: 'o', position: [0, 0, 0] },
    { key: 'near', position: [0.5, 0, 0.5] },
    { key: 'far', position: [0.5, 0, -0.5] },
  ], orbit, viewport);
  expect(origin.x).toBe(200);
  expect(origin.y).toBe(150);
  expect(origin.scale).toBe(1);
  expect(near.depth).toBeLessThan(far.depth);
  expect(near.scale).toBeGreaterThan(1);
  expect(far.scale).toBeLessThan(1);
  expect(near.x - 200).toBeGreaterThan(far.x - 200);
  expect(paintOrder([near, far, origin]).map((p) => p.key)).toEqual(['far', 'o', 'near']);
});

it('rotates with yaw and pitch and zooms toward the origin', () => {
  const [x, , z] = rotate([1, 0, 0], { yaw: Math.PI / 2, pitch: 0, zoom: 1 });
  expect(x).toBeCloseTo(0);
  expect(z).toBeCloseTo(-1);
  const [, y, z2] = rotate([0, 0, 1], { yaw: 0, pitch: Math.PI / 2, zoom: 1 });
  expect(y).toBeCloseTo(-1);
  expect(z2).toBeCloseTo(0);
  const [side] = project([{ key: 's', position: [0.5, 0, 0] }], DEFAULT_ORBIT, viewport);
  const [closer] = project([{ key: 's', position: [0.5, 0, 0] }], orbitZoom(DEFAULT_ORBIT, -100), viewport);
  expect(Math.abs(closer.x - 200)).toBeGreaterThan(Math.abs(side.x - 200));
  expect(orbitZoom(DEFAULT_ORBIT, 100000).zoom).toBe(0.4);
  expect(orbitZoom(DEFAULT_ORBIT, -100000).zoom).toBe(4);
});

it('clamps the pitch while dragging', () => {
  const dragged = orbitDrag(DEFAULT_ORBIT, 50, 100000);
  expect(dragged.yaw).toBeCloseTo(DEFAULT_ORBIT.yaw + 0.4);
  expect(dragged.pitch).toBeLessThan(Math.PI / 2);
  expect(orbitDrag(DEFAULT_ORBIT, 0, -100000).pitch).toBeGreaterThan(-Math.PI / 2);
});

it('picks the nearest billboard under the cursor', () => {
  const projected = [
    {
      key: 'behind', x: 100, y: 100, depth: 4, scale: 0.8,
    },
    {
      key: 'front', x: 104, y: 98, depth: 2, scale: 1.5,
    },
    {
      key: 'elsewhere', x: 300, y: 100, depth: 1, scale: 1,
    },
  ];
  expect(pick(projected, 101, 101, 20)?.key).toBe('front');
  expect(pick(projected, 100, 100, 1)?.key).toBe('behind');
  expect(pick(projected, 200, 200, 20)).toBeNull();
});
