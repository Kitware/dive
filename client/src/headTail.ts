/** Ordered editable centerlines share the existing HeadTails line/keypoint schema. */
export const spineIndex = (key: string): number | null => {
  const match = /^spine_([0-9]+)$/.exec(key);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
};
export const spineName = (index: number) => `spine_${String(index).padStart(3, '0')}`;
export const isHeadTailPoint = (key: string) => key === 'head' || key === 'tail' || spineIndex(key) !== null;

type Shape = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;

function vertexName(index: number, count: number): string {
  if (index === 0) return 'head';
  if (index === count - 1) return 'tail';
  return spineName(index);
}

export function headTailFeatures(coordinates: GeoJSON.Position[]): GeoJSON.Feature<Shape>[] {
  if (coordinates.length < 2) return [];
  return [
    ...coordinates.map((point, i): GeoJSON.Feature<GeoJSON.Point> => ({
      type: 'Feature',
      properties: { key: vertexName(i, coordinates.length) },
      geometry: { type: 'Point', coordinates: [...point] },
    })),
    { type: 'Feature', properties: { key: 'HeadTails' }, geometry: { type: 'LineString', coordinates: coordinates.map((p) => [...p]) } },
  ];
}

export function orderedHeadTail(features: GeoJSON.Feature<Shape>[]): GeoJSON.Position[] | null {
  const points = new Map<string, GeoJSON.Position>();
  features.forEach((f) => {
    if (f.geometry.type === 'Point') points.set(f.properties?.key, f.geometry.coordinates);
  });
  const head = points.get('head'); const tail = points.get('tail');
  if (!head || !tail) return null;
  const spine = [...points.entries()].filter(([k]) => spineIndex(k) !== null)
    .sort(([a], [b]) => (spineIndex(a) as number) - (spineIndex(b) as number));
  return [head, ...spine.map(([, p]) => p), tail];
}

/** Line geometry is authoritative when present; otherwise reconstruct from points. */
export function syncHeadTail(features: GeoJSON.Feature<Shape>[]): GeoJSON.Feature<Shape>[] {
  const line = features.find((f) => f.properties?.key === 'HeadTails' && f.geometry.type === 'LineString');
  const coordinates = line?.geometry.type === 'LineString' ? line.geometry.coordinates : orderedHeadTail(features);
  if (!coordinates || coordinates.length < 2) return features;
  const retained = features.filter((f) => !(f.geometry.type === 'Point' && isHeadTailPoint(f.properties?.key || ''))
    && !(f.geometry.type === 'LineString' && f.properties?.key === 'HeadTails'));
  return [...retained, ...headTailFeatures(coordinates)];
}

/** Uniform arc-distance samples on the editable polyline (no index matching). */
export function sampleHeadTail(points: [number, number][], count = 32): [number, number][] {
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    distances.push(distances[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const total = distances[distances.length - 1];
  if (!(total > 0) || !Number.isFinite(total)) throw new Error('Invalid centerline');
  const positions = [...new Set([...distances, ...Array.from({ length: count }, (_, i) => (i * total) / (count - 1))])].sort((a, b) => a - b);
  return positions.map((d) => {
    let j = 1;
    while (j < distances.length - 1 && distances[j] <= d) j += 1;
    const t = (d - distances[j - 1]) / (distances[j] - distances[j - 1] || 1);
    return [points[j - 1][0] * (1 - t) + points[j][0] * t,
      points[j - 1][1] * (1 - t) + points[j][1] * t];
  });
}

export function distanceToHeadTail(point: [number, number], curve: [number, number][]): number {
  let best = Infinity;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1]; const b = curve[i];
    const dx = b[0] - a[0]; const dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy));
  }
  return best;
}
