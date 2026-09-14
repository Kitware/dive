/**
 * Review mode: contract shared by the review page, the chip loader and the
 * platform shells. The page shows many detections at once as cropped chips
 * so a user can audit and correct their types (or find them by attribute)
 * without opening every sequence in the viewer.
 */
import type { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import type { RectBounds } from 'vue-media-annotator/utils';

export type ReviewQueryMode = 'type' | 'attribute';

/** Where an attribute query looks for the attribute. */
export type ReviewAttributeScope = 'any' | 'track' | 'detection';

export interface ReviewQuery {
  mode: ReviewQueryMode;
  /** Type mode: the class to show; empty for every class. */
  type: string;
  /** Type mode: minimum confidence of the matching pair (0 shows everything). */
  threshold: number;
  /** Attribute mode: the attribute key to look for. */
  attributeKey: string;
  /** Attribute mode: required value (string compared); empty just requires presence. */
  attributeValue: string;
  attributeScope: ReviewAttributeScope;
}

export type ReviewSortOrder = 'dataset' | 'confidence-asc' | 'confidence-desc' | 'frame';

/** A polygon outline in image coordinates: [[x, y], ...] without a closing repeat. */
export type ReviewPolygon = [number, number][];

/** Extra geometry a detection may carry besides its box. */
export interface ReviewFrameGeometry {
  polygons?: ReviewPolygon[];
  head?: [number, number];
  tail?: [number, number];
}

/** One box of a track shown in a chip, in the dataset's own frame numbers. */
export interface ReviewFrameRef extends ReviewFrameGeometry {
  frame: number;
  bounds: RectBounds;
  /**
   * The track has no detection on this frame in this camera; `bounds` is
   * interpolated from its neighbours so the chip can still be cropped there,
   * and no box is drawn.
   */
  missing?: boolean;
}

/**
 * One grid entry: a track (or one detection of it) in one dataset. Built
 * once per query run; the live type is read from the review service so
 * edits show without the grid reshuffling.
 */
export interface ReviewItem {
  /** Stable within a query run: `${datasetId}#${trackId}` or with `@frame`. */
  key: string;
  datasetId: string;
  trackId: AnnotationId;
  /** The box shown first: the matched detection, or the track's first keyframe. */
  primary: ReviewFrameRef;
  /**
   * Boxes sampled along the track for the cycling animation, primary first.
   * A single entry means a static detection.
   */
  frames: ReviewFrameRef[];
  /** Number of keyframes in the track. */
  keyframeCount: number;
  /** Type and confidence of the pair the query matched on (top pair otherwise). */
  type: string;
  confidence: number;
  /** Attribute mode: what matched. */
  matchedAttribute?: {
    key: string;
    value: unknown;
    scope: 'track' | 'detection';
  };
}

/**
 * One grid entry: a track shown once per camera it appears in. Single
 * camera datasets have one item per entry; the cameras of a multicamera
 * dataset share the entry, with their items' frames aligned.
 */
export interface ReviewEntry {
  key: string;
  items: ReviewItem[];
  /** Camera name per item; empty strings for single-camera entries. */
  labels: string[];
}

/** Grid presentation settings, persisted per browser. */
export interface ReviewGridSettings {
  columns: number;
  rows: number;
  /**
   * Context around the box as a fraction of its longer side: 0.3 shows the
   * box plus 30% of its size on each side.
   */
  padding: number;
  /** Milliseconds between frames of a cycling track. */
  cycleIntervalMs: number;
  /** Most frames sampled along a track. */
  maxSequenceFrames: number;
}

export const DEFAULT_REVIEW_QUERY: ReviewQuery = {
  mode: 'type',
  type: '',
  threshold: 0.1,
  attributeKey: '',
  attributeValue: '',
  attributeScope: 'any',
};

export const DEFAULT_REVIEW_GRID: ReviewGridSettings = {
  columns: 5,
  rows: 4,
  padding: 0.3,
  cycleIntervalMs: 400,
  maxSequenceFrames: 8,
};

export const REVIEW_GRID_LIMITS = {
  columns: [1, 12] as const,
  rows: [1, 10] as const,
  padding: [0, 3] as const,
};
