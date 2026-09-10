/**
 * Pure helpers that turn a dataset's tracks into review grid items for a
 * query, plus the type/attribute vocabularies the query controls offer.
 */
import type { TrackData, Feature } from 'vue-media-annotator/track';
import type { StringKeyObject } from 'vue-media-annotator/BaseAnnotation';
import type { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import { compareTypeNames } from 'dive-common/typeHierarchy';
import type { RectBounds } from 'vue-media-annotator/utils';
import type {
  ReviewEntry, ReviewFrameGeometry, ReviewFrameRef, ReviewItem, ReviewPolygon, ReviewQuery, ReviewSortOrder,
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

/**
 * Milliseconds between the sampled frames of a track so that cycling
 * through them plays at the dataset's real-time rate: consecutive frames
 * advance every 1/fps seconds, and sparser samples wait proportionally
 * longer. Clamped so a loop is neither a strobe nor a slideshow.
 */
export function cycleIntervalFor(frames: readonly ReviewFrameRef[], fps: number, fallbackMs: number): number {
  if (frames.length < 2 || !(fps > 0)) return fallbackMs;
  const span = frames[frames.length - 1].frame - frames[0].frame;
  const stride = Math.max(1, span / (frames.length - 1));
  return Math.min(2000, Math.max(33, Math.round((stride / fps) * 1000)));
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

/** Which multicamera parent and camera a dataset id belongs to, if any. */
export interface CameraMembership {
  parent: string;
  camera: string;
  /** Position of the camera in the rig's display order. */
  rank: number;
}

/**
 * Box a track would have on `frame` in one camera, interpolated between
 * its nearest keyframes with boxes (held at the ends), or null when the
 * track has no boxes there at all.
 */
export function interpolateBounds(track: TrackData, frame: number): RectBounds | null {
  const features = boxedFeatures(track);
  if (features.length === 0) return null;
  const exact = features.find((f) => f.frame === frame);
  if (exact?.bounds) return exact.bounds;
  const before = [...features].reverse().find((f) => f.frame < frame);
  const after = features.find((f) => f.frame > frame);
  if (before?.bounds && after?.bounds) {
    const t = (frame - before.frame) / (after.frame - before.frame);
    return before.bounds.map((v, i) => v + ((after.bounds as RectBounds)[i] - v) * t) as RectBounds;
  }
  return (before?.bounds ?? after?.bounds) ?? null;
}

/**
 * Give the items of a multicamera entry the same frames: the union of their
 * keyframes sampled once, with a camera that lacks a detection on a frame
 * getting an interpolated, box-less reference there.
 */
export function alignCameraFrames(
  items: ReviewItem[],
  trackOf: (item: ReviewItem) => TrackData | undefined,
  maxSequenceFrames: number,
): ReviewItem[] {
  if (items.length < 2) return items;
  const byFrame = new Map<number, Feature>();
  items.forEach((item) => {
    const track = trackOf(item);
    if (!track) return;
    boxedFeatures(track).forEach((feature) => {
      if (!byFrame.has(feature.frame)) byFrame.set(feature.frame, feature);
    });
  });
  const union = Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame);
  // Detection matches keep their own frame first so the query hit stays visible.
  const sampled = sampleFrames(union, maxSequenceFrames).map((ref) => ref.frame);
  const anchor = items.find((item) => item.key.includes('@'))?.primary.frame;
  if (anchor !== undefined && !sampled.includes(anchor)) sampled.unshift(anchor);

  return items.map((item) => {
    const track = trackOf(item);
    if (!track) return item;
    const frames: ReviewFrameRef[] = [];
    sampled.forEach((frame) => {
      const feature = track.features.find((f) => f.frame === frame && f.bounds);
      if (feature) {
        const ref = frameRefFor(feature);
        if (ref) frames.push(ref);
        return;
      }
      const bounds = interpolateBounds(track, frame);
      if (bounds) frames.push({ frame, bounds, missing: true });
    });
    if (frames.length === 0) return item;
    return {
      ...item, primary: frames[0], frames, keyframeCount: boxedFeatures(track).length,
    };
  });
}

/**
 * Group items into grid entries: one per track, holding an item per camera
 * the track appears in (in rig order) for multicamera datasets.
 */
export function groupReviewItems(
  items: readonly ReviewItem[],
  membershipOf: (datasetId: string) => CameraMembership | undefined,
  trackOf: (item: ReviewItem) => TrackData | undefined,
  maxSequenceFrames: number,
): ReviewEntry[] {
  const entries: ReviewEntry[] = [];
  const byKey = new Map<string, { items: ReviewItem[]; ranks: number[]; labels: string[] }>();
  items.forEach((item) => {
    const membership = membershipOf(item.datasetId);
    if (!membership) {
      entries.push({ key: item.key, items: [item], labels: [''] });
      return;
    }
    const key = item.key.replace(item.datasetId, membership.parent);
    let group = byKey.get(key);
    if (!group) {
      group = { items: [], ranks: [], labels: [] };
      byKey.set(key, group);
      entries.push({ key, items: group.items, labels: group.labels });
    }
    // Keep cameras in rig order whatever order the items arrived in.
    let at = group.ranks.findIndex((rank) => rank > membership.rank);
    if (at < 0) at = group.ranks.length;
    group.items.splice(at, 0, item);
    group.ranks.splice(at, 0, membership.rank);
    group.labels.splice(at, 0, membership.camera);
  });
  return entries.map((entry) => (entry.items.length > 1
    ? { ...entry, items: alignCameraFrames(entry.items, trackOf, maxSequenceFrames) }
    : entry));
}

/** Every type named by any confidence pair, in type order. */
/**
 * Types present on the tracks, sorted; with a threshold, only those some
 * track carries at that confidence or above, so a type query built from
 * the list always finds something.
 */
export function collectTypes(tracks: Iterable<TrackData>, threshold = 0): string[] {
  const types = new Set<string>();
  Array.from(tracks).forEach((track) => {
    track.confidencePairs.forEach(([type, confidence]) => {
      if (type && confidence >= threshold) types.add(type);
    });
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
