/**
 * Pure helpers that turn a dataset's tracks into review grid items for a
 * query, plus the type/attribute vocabularies the query controls offer.
 */
import type { TrackData, Feature } from 'vue-media-annotator/track';
import type { StringKeyObject } from 'vue-media-annotator/BaseAnnotation';
import type { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import { compareTypeNames } from 'dive-common/typeHierarchy';
import type {
  ReviewFrameGeometry, ReviewFrameRef, ReviewItem, ReviewPolygon, ReviewQuery, ReviewSortOrder,
} from './types';

function isPoint(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

/**
 * Polygons and head/tail points of a keyframe. Points come from the
 * GeoJSON features keyed "head"/"tail" (how DIVE stores them), falling back
 * to the feature's own head/tail fields.
 */
export function frameGeometry(feature: Feature): ReviewFrameGeometry {
  const geometry: ReviewFrameGeometry = {};
  const polygons: ReviewPolygon[] = [];
  (feature.geometry?.features || []).forEach((geo) => {
    const key = (geo.properties as { key?: unknown } | null)?.key;
    if (geo.geometry.type === 'Polygon') {
      const ring = (geo.geometry.coordinates[0] || []).filter(isPoint).map(([x, y]) => [x, y] as [number, number]);
      if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) {
        ring.pop();
      }
      if (ring.length >= 3) polygons.push(ring);
    } else if (geo.geometry.type === 'Point' && (key === 'head' || key === 'tail')) {
      const point = geo.geometry.coordinates;
      if (isPoint(point)) geometry[key] = [point[0], point[1]];
    }
  });
  if (!geometry.head && isPoint(feature.head)) geometry.head = [feature.head[0], feature.head[1]];
  if (!geometry.tail && isPoint(feature.tail)) geometry.tail = [feature.tail[0], feature.tail[1]];
  if (polygons.length) geometry.polygons = polygons;
  return geometry;
}

/** A frame reference for a keyframe, carrying its extra geometry when present. */
export function frameRefFor(feature: Feature): ReviewFrameRef | null {
  if (!feature.bounds) return null;
  return { frame: feature.frame, bounds: feature.bounds, ...frameGeometry(feature) };
}

/** Keyframes carrying a box, in frame order. */
export function boxedFeatures(track: TrackData): Feature[] {
  return track.features
    .filter((f) => !!f.bounds)
    .sort((a, b) => a.frame - b.frame);
}

/** Up to `max` boxes evenly sampled along `features` (which must be in frame order). */
export function sampleFrames(features: Feature[], max: number): ReviewFrameRef[] {
  if (features.length === 0) return [];
  const count = Math.max(1, Math.min(max, features.length));
  const chosen: ReviewFrameRef[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const index = count === 1 ? 0 : Math.round((i * (features.length - 1)) / (count - 1));
    const feature = features[index];
    const ref = frameRefFor(feature);
    if (ref && !seen.has(feature.frame)) {
      seen.add(feature.frame);
      chosen.push(ref);
    }
  }
  return chosen;
}

/** The pair a type query matches on, or null when the track does not qualify. */
export function matchTypePair(
  pairs: readonly (readonly [string, number])[],
  type: string,
  threshold: number,
): [string, number] | null {
  if (pairs.length === 0) {
    // Untyped annotations only show up when every type is requested.
    return type === '' && threshold <= 0 ? ['', 0] : null;
  }
  // Stored pairs are normally sorted by confidence, but files are not guaranteed to be.
  const candidates = type === '' ? pairs : pairs.filter(([name]) => name === type);
  const best = candidates.reduce<readonly [string, number] | null>(
    (acc, pair) => (acc === null || pair[1] > acc[1] ? pair : acc),
    null,
  );
  if (!best || best[1] < threshold) return null;
  return [best[0], best[1]];
}

function ownAttributes(attributes: StringKeyObject | undefined): [string, unknown][] {
  if (!attributes) return [];
  return Object.entries(attributes).filter(([key]) => key !== 'userAttributes');
}

/** Attribute values compare as strings, case-insensitively; empty wanted means "present". */
export function attributeMatches(value: unknown, wanted: string): boolean {
  if (value === undefined || value === null) return false;
  if (wanted === '') return true;
  const asText = Array.isArray(value) ? value.map(String).join(',') : String(value);
  return asText.toLowerCase() === wanted.trim().toLowerCase();
}

function trackTopPair(track: TrackData): [string, number] {
  const top = track.confidencePairs.reduce<readonly [string, number] | null>(
    (acc, pair) => (acc === null || pair[1] > acc[1] ? pair : acc),
    null,
  );
  return top ? [top[0], top[1]] : ['', 0];
}

function attributeItem(
  datasetId: string,
  track: TrackData,
  query: ReviewQuery,
  maxSequenceFrames: number,
): ReviewItem | null {
  const key = query.attributeKey.trim();
  if (!key) return null;
  const features = boxedFeatures(track);
  if (features.length === 0) return null;
  const [type, confidence] = trackTopPair(track);
  const base = {
    datasetId,
    trackId: track.id,
    keyframeCount: features.length,
    type,
    confidence,
  };
  if (query.attributeScope !== 'detection') {
    const hit = ownAttributes(track.attributes).find(
      ([name, value]) => name === key && attributeMatches(value, query.attributeValue),
    );
    if (hit) {
      const frames = sampleFrames(features, maxSequenceFrames);
      return {
        ...base,
        key: `${datasetId}#${track.id}`,
        primary: frames[0],
        frames,
        matchedAttribute: { key, value: hit[1], scope: 'track' },
      };
    }
  }
  if (query.attributeScope !== 'track') {
    const matching = features.filter((f) => ownAttributes(f.attributes).some(
      ([name, value]) => name === key && attributeMatches(value, query.attributeValue),
    ));
    if (matching.length > 0) {
      const frames = sampleFrames(matching, maxSequenceFrames);
      const hit = ownAttributes(matching[0].attributes).find(([name]) => name === key);
      return {
        ...base,
        key: `${datasetId}#${track.id}@${matching[0].frame}`,
        primary: frames[0],
        frames,
        matchedAttribute: { key, value: hit ? hit[1] : undefined, scope: 'detection' },
      };
    }
  }
  return null;
}

function typeItem(
  datasetId: string,
  track: TrackData,
  query: ReviewQuery,
  maxSequenceFrames: number,
): ReviewItem | null {
  const pair = matchTypePair(track.confidencePairs, query.type, query.threshold);
  if (!pair) return null;
  const features = boxedFeatures(track);
  if (features.length === 0) return null;
  const frames = sampleFrames(features, maxSequenceFrames);
  return {
    key: `${datasetId}#${track.id}`,
    datasetId,
    trackId: track.id,
    primary: frames[0],
    frames,
    keyframeCount: features.length,
    type: pair[0],
    confidence: pair[1],
  };
}

/** Every grid item one dataset contributes to a query, in track id order. */
export function buildReviewItems(
  datasetId: string,
  tracks: Iterable<TrackData>,
  query: ReviewQuery,
  maxSequenceFrames: number,
): ReviewItem[] {
  const items: ReviewItem[] = [];
  Array.from(tracks)
    .sort((a, b) => a.id - b.id)
    .forEach((track) => {
      const item = query.mode === 'attribute'
        ? attributeItem(datasetId, track, query, maxSequenceFrames)
        : typeItem(datasetId, track, query, maxSequenceFrames);
      if (item) items.push(item);
    });
  return items;
}

export function sortReviewItems(
  items: ReviewItem[],
  order: ReviewSortOrder,
  datasetOrder: readonly string[],
): ReviewItem[] {
  const rank = new Map(datasetOrder.map((id, index) => [id, index]));
  const byDataset = (a: ReviewItem, b: ReviewItem) => (
    (rank.get(a.datasetId) ?? Infinity) - (rank.get(b.datasetId) ?? Infinity)
  );
  const sorted = [...items];
  switch (order) {
    case 'confidence-asc':
      sorted.sort((a, b) => a.confidence - b.confidence || byDataset(a, b) || a.trackId - b.trackId);
      break;
    case 'confidence-desc':
      sorted.sort((a, b) => b.confidence - a.confidence || byDataset(a, b) || a.trackId - b.trackId);
      break;
    case 'frame':
      sorted.sort((a, b) => byDataset(a, b) || a.primary.frame - b.primary.frame || a.trackId - b.trackId);
      break;
    default:
      sorted.sort((a, b) => byDataset(a, b) || a.trackId - b.trackId);
  }
  return sorted;
}

/** Every type named by any confidence pair, in type order. */
export function collectTypes(tracks: Iterable<TrackData>): string[] {
  const types = new Set<string>();
  Array.from(tracks).forEach((track) => {
    track.confidencePairs.forEach(([type]) => { if (type) types.add(type); });
  });
  return Array.from(types).sort(compareTypeNames);
}

/**
 * Attribute keys the query control can offer: those defined in the dataset
 * configuration plus any actually present on tracks or detections.
 */
export function collectAttributeKeys(
  tracks: Iterable<TrackData>,
  definitions: Readonly<Record<string, Attribute>> | undefined,
): string[] {
  const keys = new Set<string>();
  Object.values(definitions || {}).forEach((attribute) => keys.add(attribute.name));
  Array.from(tracks).forEach((track) => {
    ownAttributes(track.attributes).forEach(([key]) => keys.add(key));
    track.features.forEach((feature) => {
      ownAttributes(feature.attributes).forEach(([key]) => keys.add(key));
    });
  });
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}
