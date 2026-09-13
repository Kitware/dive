import Track, { TrackSupportedFeature } from 'vue-media-annotator/track';
import {
  headTailFeatures, isHeadTailPoint, spineIndex, spineName,
} from 'vue-media-annotator/headTail';

export function namedPoint(track: Track | undefined, frame: number, key: string) {
  const [feature] = track ? track.getFeature(frame) : [null];
  return feature?.geometry?.features.find((g) => g.geometry.type === 'Point' && g.properties?.key === key);
}

function mappedPoint(track: Track | undefined, frame: number, key: string, camera: string) {
  const [feature] = track ? track.getFeature(frame) : [null];
  return feature?.geometry?.features.find((g) => g.geometry.type === 'Point'
    && g.properties?.stereoSource === camera && g.properties?.stereoKey === key);
}

/** A missing point can be added even when the target detection already exists. */
export function canMapPoint(track: Track | undefined, frame: number, key: string, sourceCamera: string) {
  const point = mappedPoint(track, frame, key, sourceCamera) ?? namedPoint(track, frame, key);
  return !point || point.properties?.stereoSource === sourceCamera;
}

export function pointUnchanged(track: Track | undefined, frame: number, key: string, point: [number, number]) {
  const current = namedPoint(track, frame, key);
  return current?.geometry.type === 'Point' && JSON.stringify(current.geometry.coordinates) === JSON.stringify(point);
}

export function applyMappedPoint(track: Track, frame: number, key: string, point: [number, number], sourceCamera: string, insert = false) {
  if (!key || !point.every(Number.isFinite)) throw new Error('Invalid mapped keypoint');
  const [feature] = track.getFeature(frame);
  const targetKey = (!insert && mappedPoint(track, frame, key, sourceCamera)?.properties?.key) || key;
  const marker: GeoJSON.Feature<GeoJSON.Point> = {
    type: 'Feature',
    properties: { key: targetKey, stereoSource: sourceCamera, stereoKey: key },
    geometry: { type: 'Point', coordinates: [...point] },
  };
  let geometry: GeoJSON.Feature<TrackSupportedFeature>[] = [marker];
  const line = feature?.geometry?.features.find((g) => g.geometry.type === 'LineString' && g.properties?.key === 'HeadTails');
  if (line?.geometry.type === 'LineString' && isHeadTailPoint(key)) {
    const coordinates = line.geometry.coordinates.map((p) => [...p]);
    const index = targetKey === 'head' ? 0 : spineIndex(targetKey);
    if (insert && spineIndex(key) !== null) {
      let best = Infinity; let segment = 0;
      for (let i = 0; i < coordinates.length - 1; i += 1) {
        const a = coordinates[i]; const b = coordinates[i + 1];
        const dx = b[0] - a[0]; const dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        const distance = Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
        if (distance < best) { best = distance; segment = i; }
      }
      coordinates.splice(segment + 1, 0, point);
      marker.properties = { ...marker.properties, key: spineName(segment + 1) };
    } else if (targetKey === 'tail') coordinates[coordinates.length - 1] = point;
    else if (index !== null && index < coordinates.length - 1) coordinates[index] = point;
    else if (index === coordinates.length - 1) coordinates.splice(index, 0, point);
    else throw new Error('Cannot insert a centerline point with a missing predecessor');
    geometry = [...headTailFeatures(coordinates).map((generated) => {
      // Preserve ownership of untouched vertices even when insertion renumbers them.
      const old = feature?.geometry?.features.find((g) => g.geometry.type === 'Point'
        && generated.geometry.type === 'Point'
        && JSON.stringify(g.geometry.coordinates) === JSON.stringify(generated.geometry.coordinates));
      const properties = { ...old?.properties, ...generated.properties };
      const sourceIndex = spineIndex(properties.stereoKey || '');
      const insertedIndex = spineIndex(key);
      if (insert && properties.stereoSource === sourceCamera && sourceIndex !== null
          && insertedIndex !== null && sourceIndex >= insertedIndex) {
        properties.stereoKey = spineName(sourceIndex + 1);
      }
      return { ...generated, properties };
    }), marker];
  }
  track.setFeature({
    frame,
    keyframe: true,
    interpolate: feature?.interpolate ?? false,
    bounds: feature?.bounds ?? [point[0] - 5, point[1] - 5, point[0] + 5, point[1] + 5],
  }, geometry);
  if (isHeadTailPoint(key)) track.invalidateMeasurement(frame);
}

/** Identify one inserted or moved vertex without guessing stereo correspondence. */
export function linePointEdit(before: GeoJSON.Position[] | undefined, after: GeoJSON.Position[]) {
  if (!before) return null;
  const same = (a: GeoJSON.Position, b: GeoJSON.Position) => JSON.stringify(a) === JSON.stringify(b);
  if (after.length === before.length + 1) {
    const index = after.findIndex((p, i) => !before[i] || !same(p, before[i]));
    if (index > 0 && index < after.length - 1
        && before.every((p, i) => same(p, after[i < index ? i : i + 1]))) {
      return { key: spineName(index), point: after[index] as [number, number], insert: true };
    }
  }
  if (before.length === after.length) {
    const changed = after.map((p, i) => (!same(p, before[i]) ? i : -1)).filter((i) => i >= 0);
    if (changed.length === 1) {
      const index = changed[0];
      let key = spineName(index);
      if (index === 0) key = 'head';
      if (index === after.length - 1) key = 'tail';
      return { key, point: after[index] as [number, number], insert: false };
    }
  }
  return null;
}

export function pointTargetState(track: Track | undefined, frame: number, key: string, insert = false, camera = '') {
  if (!insert) return JSON.stringify(mappedPoint(track, frame, key, camera) ?? namedPoint(track, frame, key));
  const [feature] = track ? track.getFeature(frame) : [null];
  return JSON.stringify(feature?.geometry);
}
