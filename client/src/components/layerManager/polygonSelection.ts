import { pointInPolygon } from '../../utils';

interface PolygonCandidate {
  trackId: number;
  polygonKey: string;
  polygon: GeoJSON.Polygon;
  isHole?: boolean;
}

/** Prefer polygons containing the click; resolve overlap/gaps by boundary distance. */
export default function pickPolygon(polygons: PolygonCandidate[], trackId: number, point: number[], nearestOutside = false): PolygonCandidate | undefined {
  const positions = (ring: GeoJSON.Position[]) => ring.map(([x, y]) => ({ x, y }));
  const ranked = polygons.filter((p) => p.trackId === trackId && !p.isHole).map((polygon) => {
    const [outer, ...holes] = polygon.polygon.coordinates;
    const inside = pointInPolygon({ x: point[0], y: point[1] }, positions(outer), holes.map(positions));
    let distance = Infinity;
    polygon.polygon.coordinates.forEach((ring) => ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length];
      const dx = b[0] - a[0]; const dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      distance = Math.min(distance, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
    }));
    return { polygon, inside, distance };
  });
  const containing = ranked.filter((p) => p.inside);
  let candidates = nearestOutside ? ranked : [];
  if (containing.length) candidates = containing;
  return candidates.sort((a, b) => a.distance - b.distance)[0]?.polygon;
}
