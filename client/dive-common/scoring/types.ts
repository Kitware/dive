/**
 * Scoring mode: contract shared by the viewer panel, the web platform and the
 * desktop platform. Both platforms run the `viame score` applet on two VIAME
 * CSV exports and store its output verbatim inside a {@link ScoringResultFile}.
 */

export type ScoringMatchMode = 'box' | 'polygon';

export type ScoringFilterEstimator = 'none' | 'min' | 'avg' | 'avg_minus_1p' | 'idf1' | 'mota';

/** Every `viame score` option the panel exposes. */
export interface ScoringParams {
  /** IoU needed for a computed object to match a truth object (--iou) */
  iouThreshold: number;
  /** Computed objects below this confidence are dropped before scoring (--conf) */
  confidenceThreshold: number;
  /** Overlap boxes, or polygons where both sides carry one (--match-mode) */
  matchMode: ScoringMatchMode;
  /** Also report every class on its own (--per-class) */
  perClass: boolean;
  /** Offer each detection only to its best class in per-class scoring (--top-class) */
  topClass: boolean;
  /** Rank on the detection confidence column rather than the class score (--aux-confidence) */
  auxConfidence: boolean;
  /** Compute MOT, HOTA and KWANT track metrics (omits --no-tracking) */
  tracking: boolean;
  /** Keypoint tolerance as a fraction of the truth length (--keypoint-threshold) */
  keypointThreshold: number;
  /** Score across a range of confidence thresholds (--sweep-thresholds) */
  sweep: boolean;
  /** Number of thresholds in the sweep (--sweep-interval) */
  sweepInterval: number;
  /** How swept thresholds become a recommended confidence filter (--filter-estimator) */
  filterEstimator: ScoringFilterEstimator;
  /** Class reported for objects that carry none (--defaultlabel) */
  defaultLabel?: string;
  /** Class synonym file content, one `canonical: alias, alias` per line (--labels) */
  labelSynonyms?: string;
}

/**
 * One side of a comparison. The dataset supplies the media, so two sources
 * naming the same dataset compare two annotation sets of one sequence, and two
 * naming different datasets compare separately imported annotations of the
 * same footage.
 */
export interface ScoringSource {
  datasetId: string;
  /** Web annotation set; the default set when empty */
  set?: string;
  /** Web revision to score at; the latest when omitted */
  revision?: number;
  /**
   * Desktop annotation file: an earlier `result_*.json` rotated into the
   * project's auxiliary folder, or any annotation file on disk. The dataset's
   * current annotations when omitted.
   */
  file?: string;
  /** Shown in the results view in place of the raw identifiers */
  label?: string;
}

/** One sequence to score: computed annotations against the truth for the same footage. */
export interface ScoringPair {
  computed: ScoringSource;
  truth: ScoringSource;
}

/**
 * A run scores every pair together, so the metrics aggregate across sequences
 * the way `viame score` does for a folder of files. The result is stored on
 * the first pair's computed dataset.
 */
export interface ScoringJobArgs {
  pairs: ScoringPair[];
  params: ScoringParams;
  title?: string;
}

/** Choices a platform can offer for a source on a given dataset. */
export interface ScoringSourceOptions {
  sets: string[];
  revisions: {
    revision: number;
    description: string;
    created: string;
    author?: string;
    set?: string;
  }[];
  files: {
    path: string;
    name: string;
    modified: string;
  }[];
  /** The platform can score any annotation file the user browses to */
  allowFilePaths?: boolean;
}

export interface ScoringDatasetSummary {
  id: string;
  name: string;
  type?: string;
}

/** The metrics JSON `viame score -o` writes, kept exactly as emitted. */
export type RawScoringMetrics = Record<string, unknown>;

/** The JSON `viame score --output-matches` writes, kept exactly as emitted. */
export interface RawScoringMatches {
  columns: string[];
  frame_names: [number, number, string][];
  rows: (number | string | null)[][];
}

export const SCORING_RESULT_VERSION = 1;

/** What a platform persists for one run; also what it hands back on load. */
export interface ScoringResultFile {
  version: number;
  id: string;
  /** Dataset the result is stored on: the first pair's computed dataset */
  datasetId: string;
  created: string;
  title: string;
  /** In the order they were scored; the matches' sequence index refers to this */
  pairs: ScoringPair[];
  params: ScoringParams;
  metrics: RawScoringMetrics;
  matches?: RawScoringMatches;
  summaryText?: string;
}

/** Listing entry: everything but the bulky payloads, plus headline numbers. */
export interface ScoringResultSummary {
  id: string;
  datasetId: string;
  created: string;
  title: string;
  pairs: ScoringPair[];
  params: ScoringParams;
  headline: Record<string, number | null>;
}

export type ScoringResult = ScoringResultFile;
