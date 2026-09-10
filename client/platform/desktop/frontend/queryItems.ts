/**
 * Pure helpers behind the Query page: which frames a text query visits and
 * how its hits become review grid items.
 */
import type { TextQueryDetection } from 'dive-common/apispec';
import type { ReviewItem, ReviewPolygon } from 'dive-common/review/types';

/** One detection a text query found on a frame of a dataset. */
export interface TextQueryHit {
  key: string;
  datasetId: string;
  frame: number;
  box: [number, number, number, number];
  score: number;
  label: string;
  polygon?: ReviewPolygon;
  /** Image the query ran on, reusable as an exemplar for a similarity search. */
  imagePath: string;
}

/**
 * Frames a text query visits in a dataset: every `stride`-th frame from the
 * first, capped at `maxFrames` spread evenly when the dataset is long.
 * `frameCount` null (unknown length, e.g. a video) yields `maxFrames` frames
 * at the stride.
 */
export function textQueryFrames(frameCount: number | null, stride: number, maxFrames: number): number[] {
  const step = Math.max(1, Math.round(stride));
  const cap = Math.max(1, Math.round(maxFrames));
  if (frameCount === null) {
    return Array.from({ length: cap }, (_, i) => i * step);
  }
  const count = Math.max(0, Math.floor(frameCount));
  if (count === 0) return [];
  const strided: number[] = [];
  for (let frame = 0; frame < count; frame += step) strided.push(frame);
  if (strided.length <= cap) return strided;
  // Too many: keep an even spread over the strided frames, ends included.
  return Array.from({ length: cap }, (_, i) => strided[Math.round((i * (strided.length - 1)) / (cap - 1))]);
}

export function textQueryHits(
  datasetId: string,
  frame: number,
  imagePath: string,
  detections: readonly TextQueryDetection[],
): TextQueryHit[] {
  return detections.map((det, index) => ({
    key: `text:${datasetId}#${frame}#${index}`,
    datasetId,
    frame,
    box: det.box,
    score: det.score,
    label: det.label,
    polygon: det.polygon && det.polygon.length >= 3 ? det.polygon : undefined,
    imagePath,
  }));
}

/** A grid item for a text query hit: one box on one frame. */
export function textHitItem(hit: TextQueryHit): ReviewItem {
  const primary = {
    frame: hit.frame,
    bounds: hit.box,
    ...(hit.polygon ? { polygons: [hit.polygon] } : {}),
  };
  return {
    key: hit.key,
    datasetId: hit.datasetId,
    trackId: -1,
    primary,
    frames: [primary],
    keyframeCount: 1,
    type: hit.label,
    confidence: hit.score,
  };
}
