import type {
  RawScoringMatches,
  RawScoringMetrics,
  ScoringParams,
  ScoringResultFile,
  ScoringResultSummary,
} from './types';

export const DEFAULT_SCORING_PARAMS: ScoringParams = {
  iouThreshold: 0.5,
  confidenceThreshold: 0.0,
  matchMode: 'box',
  perClass: true,
  topClass: false,
  auxConfidence: false,
  tracking: true,
  keypointThreshold: 0.1,
  sweep: true,
  sweepInterval: 50,
  filterEstimator: 'min',
  defaultLabel: '',
  labelSynonyms: '',
};

export const FILTER_ESTIMATORS: { value: ScoringParams['filterEstimator']; text: string }[] = [
  { value: 'min', text: 'Lower of the IDF1 and MOTA thresholds' },
  { value: 'avg', text: 'Average of the IDF1 and MOTA thresholds' },
  { value: 'avg_minus_1p', text: 'Average minus 0.01' },
  { value: 'idf1', text: 'Threshold maximising IDF1' },
  { value: 'mota', text: 'Threshold maximising MOTA' },
  { value: 'none', text: 'Do not recommend a filter' },
];

export interface ScoringCliPaths {
  computed: string;
  truth: string;
  metricsOut: string;
  matchesOut?: string;
  sweepDir?: string;
  labelsFile?: string;
}

/**
 * The `viame score` argument list for a parameter set. Tokens are returned
 * unquoted so each platform can quote for its own shell; paths are passed
 * through untouched.
 */
export function scoringCliArgs(params: ScoringParams, paths: ScoringCliPaths): string[] {
  const args = [
    '-c', paths.computed,
    '-t', paths.truth,
    '-o', paths.metricsOut,
    '--json-curves',
    '--iou', String(params.iouThreshold),
    '--conf', String(params.confidenceThreshold),
    '--match-mode', params.matchMode,
    '--keypoint-threshold', String(params.keypointThreshold),
  ];
  if (params.perClass) args.push('--per-class');
  if (params.topClass) args.push('--top-class');
  if (params.auxConfidence) args.push('--aux-confidence');
  if (!params.tracking) args.push('--no-tracking');
  if (params.defaultLabel) args.push('--defaultlabel', params.defaultLabel);
  if (paths.labelsFile) args.push('--labels', paths.labelsFile);
  if (paths.matchesOut) args.push('--output-matches', paths.matchesOut);
  if (params.sweep) {
    args.push('--sweep-thresholds', '--sweep-interval', String(params.sweepInterval));
    args.push('--filter-estimator', params.filterEstimator);
    if (paths.sweepDir) args.push('--output-sweep', paths.sweepDir);
  }
  return args;
}

export const HEADLINE_METRIC_KEYS = [
  'precision', 'recall', 'f1_score', 'average_precision', 'ap50', 'mean_ap',
  'mota', 'idf1', 'hota', 'mean_iou', 'mean_polygon_iou', 'keypoint_pck', 'length_mape',
  'true_positives', 'false_positives', 'false_negatives',
];

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function headlineMetrics(raw: RawScoringMetrics): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  HEADLINE_METRIC_KEYS.forEach((key) => {
    if (key in raw) out[key] = asNumberOrNull(raw[key]);
  });
  return out;
}

export function summarizeResult(file: ScoringResultFile): ScoringResultSummary {
  return {
    id: file.id,
    datasetId: file.datasetId,
    created: file.created,
    title: file.title,
    pairs: file.pairs,
    params: file.params,
    headline: headlineMetrics(file.metrics),
  };
}

/** Stable, distinguishable colors for class names outside the annotator's style manager. */
export const CLASS_PALETTE = [
  '#4c9ac2', '#f4a261', '#2a9d8f', '#e76f51', '#e9c46a', '#a29bfe', '#fd79a8',
  '#81ecec', '#ffeaa7', '#55efc4', '#fab1a0', '#74b9ff', '#dfe6e9', '#ff7675',
];

// ---------------------------------------------------------------------------
// Structured view of the metrics JSON

export interface PRCurvePoint {
  recall: number; precision: number; confidence: number; f1: number;
  tp: number; fp: number; fn: number;
}
export interface PRCurve {
  averagePrecision: number | null;
  maxF1: number | null;
  bestThreshold: number | null;
  points: PRCurvePoint[];
}
export interface ROCCurvePoint {
  falseAlarmsPerFrame: number; truePositiveRate: number; confidence: number | null;
}
export interface ROCCurve {
  meanPd: number | null;
  maxFalseAlarmsPerFrame: number | null;
  points: ROCCurvePoint[];
}
export interface ConfusionMatrix {
  classNames: string[];
  matrix: number[][];
  normalized: (number | null)[][];
  perClassAccuracy: Record<string, number | null>;
}
export interface SweepCurve {
  thresholds: number[];
  metrics: Record<string, (number | null)[]>;
  best: { idf1: number | null; idf1Thresh: number | null; mota: number | null; motaThresh: number | null };
}
export interface ScoringRunConfig {
  iouThreshold: number | null;
  confidenceThreshold: number | null;
  matchMode: string;
  keypointThreshold: number | null;
  perClass: boolean;
  tracking: boolean;
}
export interface ScoringMetrics {
  values: Record<string, number | null>;
  config: ScoringRunConfig | null;
  perClass: Record<string, Record<string, number | null>>;
  confusionMatrix: ConfusionMatrix | null;
  prCurve: PRCurve | null;
  rocCurve: ROCCurve | null;
  perClassPrCurves: Record<string, PRCurve>;
  sweep: { interval: number; curves: Record<string, SweepCurve> } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePrCurve(raw: unknown): PRCurve | null {
  if (!isRecord(raw) || !Array.isArray(raw.points)) return null;
  return {
    averagePrecision: asNumberOrNull(raw.average_precision),
    maxF1: asNumberOrNull(raw.max_f1),
    bestThreshold: asNumberOrNull(raw.best_threshold),
    points: raw.points.filter(isRecord).map((p) => ({
      recall: asNumberOrNull(p.recall) ?? 0,
      precision: asNumberOrNull(p.precision) ?? 0,
      confidence: asNumberOrNull(p.confidence) ?? 0,
      f1: asNumberOrNull(p.f1) ?? 0,
      tp: asNumberOrNull(p.tp) ?? 0,
      fp: asNumberOrNull(p.fp) ?? 0,
      fn: asNumberOrNull(p.fn) ?? 0,
    })),
  };
}

function parseRocCurve(raw: unknown): ROCCurve | null {
  if (!isRecord(raw) || !Array.isArray(raw.points)) return null;
  return {
    meanPd: asNumberOrNull(raw.mean_pd),
    maxFalseAlarmsPerFrame: asNumberOrNull(raw.max_false_alarms_per_frame),
    points: raw.points.filter(isRecord).map((p) => ({
      falseAlarmsPerFrame: asNumberOrNull(p.false_alarms_per_frame) ?? 0,
      truePositiveRate: asNumberOrNull(p.true_positive_rate) ?? 0,
      confidence: asNumberOrNull(p.confidence),
    })),
  };
}

function parseNumberMap(raw: unknown): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  if (isRecord(raw)) {
    Object.entries(raw).forEach(([k, v]) => { out[k] = asNumberOrNull(v); });
  }
  return out;
}

export function parseScoringMetrics(raw: RawScoringMetrics): ScoringMetrics {
  const values: Record<string, number | null> = {};
  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value === 'number' || value === null) values[key] = asNumberOrNull(value);
  });

  const perClass: Record<string, Record<string, number | null>> = {};
  if (isRecord(raw.per_class)) {
    Object.entries(raw.per_class).forEach(([name, metrics]) => {
      perClass[name] = parseNumberMap(metrics);
    });
  }

  let confusionMatrix: ConfusionMatrix | null = null;
  if (isRecord(raw.confusion_matrix) && Array.isArray(raw.confusion_matrix.class_names)) {
    const cm = raw.confusion_matrix;
    confusionMatrix = {
      classNames: (cm.class_names as unknown[]).map(String),
      matrix: Array.isArray(cm.matrix)
        ? (cm.matrix as unknown[][]).map((row) => row.map((v) => asNumberOrNull(v) ?? 0)) : [],
      normalized: Array.isArray(cm.normalized_matrix)
        ? (cm.normalized_matrix as unknown[][]).map((row) => row.map(asNumberOrNull)) : [],
      perClassAccuracy: parseNumberMap(cm.per_class_accuracy),
    };
  }

  const perClassPrCurves: Record<string, PRCurve> = {};
  if (isRecord(raw.per_class_pr_curves)) {
    Object.entries(raw.per_class_pr_curves).forEach(([name, curve]) => {
      const parsed = parsePrCurve(curve);
      if (parsed) perClassPrCurves[name] = parsed;
    });
  }

  let sweep: ScoringMetrics['sweep'] = null;
  if (isRecord(raw.sweep) && isRecord(raw.sweep.curves)) {
    const curves: Record<string, SweepCurve> = {};
    Object.entries(raw.sweep.curves).forEach(([name, curve]) => {
      if (!isRecord(curve) || !Array.isArray(curve.thresholds)) return;
      const metrics: Record<string, (number | null)[]> = {};
      Object.entries(curve).forEach(([key, series]) => {
        if (key !== 'thresholds' && key !== 'best' && Array.isArray(series)) {
          metrics[key] = series.map(asNumberOrNull);
        }
      });
      const best = isRecord(curve.best) ? curve.best : {};
      curves[name] = {
        thresholds: (curve.thresholds as unknown[]).map((t) => asNumberOrNull(t) ?? 0),
        metrics,
        best: {
          idf1: asNumberOrNull(best.idf1),
          idf1Thresh: asNumberOrNull(best.idf1_thresh),
          mota: asNumberOrNull(best.mota),
          motaThresh: asNumberOrNull(best.mota_thresh),
        },
      };
    });
    sweep = { interval: asNumberOrNull(raw.sweep.interval) ?? 0, curves };
  }

  let config: ScoringRunConfig | null = null;
  if (isRecord(raw.config)) {
    config = {
      iouThreshold: asNumberOrNull(raw.config.iou_threshold),
      confidenceThreshold: asNumberOrNull(raw.config.confidence_threshold),
      matchMode: String(raw.config.match_mode ?? 'box'),
      keypointThreshold: asNumberOrNull(raw.config.keypoint_threshold),
      perClass: raw.config.per_class === true,
      tracking: raw.config.tracking !== false,
    };
  }

  return {
    values,
    config,
    perClass,
    confusionMatrix,
    prCurve: parsePrCurve(raw.pr_curve),
    rocCurve: parseRocCurve(raw.roc_curve),
    perClassPrCurves,
    sweep,
  };
}

// ---------------------------------------------------------------------------
// Matches

export type ScoringMatchStatus = 'tp' | 'fp' | 'fn';

export interface ScoringMatch {
  sequence: number;
  frame: number;
  frameName: string;
  status: ScoringMatchStatus;
  computedId: number | null;
  gtId: number | null;
  iou: number;
  confidence: number;
  computedClass: string;
  gtClass: string;
}

export function parseScoringMatches(raw: RawScoringMatches | undefined): ScoringMatch[] {
  if (!raw || !Array.isArray(raw.rows)) return [];
  const names = new Map<string, string>();
  (raw.frame_names || []).forEach(([seq, frame, name]) => names.set(`${seq}:${frame}`, name));
  const col = (name: string) => raw.columns.indexOf(name);
  const idx = {
    sequence: col('sequence'),
    frame: col('frame'),
    status: col('status'),
    computedId: col('computed_id'),
    gtId: col('gt_id'),
    iou: col('iou'),
    confidence: col('confidence'),
    computedClass: col('computed_class'),
    gtClass: col('gt_class'),
  };
  const num = (row: (number | string | null)[], i: number) => asNumberOrNull(row[i]);
  const str = (row: (number | string | null)[], i: number) => (i >= 0 && row[i] != null ? String(row[i]) : '');
  return raw.rows.map((row) => {
    const sequence = num(row, idx.sequence) ?? 0;
    const frame = num(row, idx.frame) ?? 0;
    const status = str(row, idx.status) as ScoringMatchStatus;
    const computedId = num(row, idx.computedId);
    const gtId = num(row, idx.gtId);
    return {
      sequence,
      frame,
      frameName: names.get(`${sequence}:${frame}`) ?? '',
      status,
      computedId: computedId !== null && computedId >= 0 ? computedId : null,
      gtId: gtId !== null && gtId >= 0 ? gtId : null,
      iou: num(row, idx.iou) ?? 0,
      confidence: num(row, idx.confidence) ?? 0,
      computedClass: str(row, idx.computedClass),
      gtClass: str(row, idx.gtClass),
    };
  });
}

export interface FrameErrorCount {
  frame: number;
  tp: number;
  fp: number;
  fn: number;
}

/** Per-frame tallies in frame order, one entry per frame that carries any object. */
export function perFrameErrorCounts(matches: ScoringMatch[]): FrameErrorCount[] {
  const byFrame = new Map<number, FrameErrorCount>();
  matches.forEach((m) => {
    let entry = byFrame.get(m.frame);
    if (!entry) {
      entry = {
        frame: m.frame, tp: 0, fp: 0, fn: 0,
      };
      byFrame.set(m.frame, entry);
    }
    entry[m.status] += 1;
  });
  return Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame);
}

// ---------------------------------------------------------------------------
// Display definitions

export interface MetricDefinition {
  key: string;
  label: string;
  description: string;
  format: 'ratio' | 'count' | 'pixels' | 'frames' | 'number';
  higherIsBetter?: boolean;
}

export interface MetricGroup {
  name: string;
  /** Show the group only when this metric is present and non-zero */
  requires?: string;
  metrics: MetricDefinition[];
}

export const METRIC_GROUPS: MetricGroup[] = [
  {
    name: 'Detection',
    metrics: [
      {
        key: 'precision', label: 'Precision', description: 'Fraction of computed objects that matched truth', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'recall', label: 'Recall', description: 'Fraction of truth objects that were found', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'f1_score', label: 'F1', description: 'Harmonic mean of precision and recall', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'average_precision', label: 'AP', description: 'Area under the precision-recall curve at the configured IoU', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'ap50', label: 'AP@50', description: 'Average precision at IoU 0.5', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'ap75', label: 'AP@75', description: 'Average precision at IoU 0.75', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'ap50_95', label: 'AP@[.5:.95]', description: 'COCO-style average precision over IoU 0.5 to 0.95', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'ap_any', label: 'AP@any', description: 'Average precision counting any overlap as a hit', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'mean_ap', label: 'mAP', description: 'Mean of the per-class average precisions', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'mcc', label: 'MCC', description: 'Matthews correlation coefficient', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'true_positives', label: 'True positives', description: 'Computed objects matched to truth', format: 'count',
      },
      {
        key: 'false_positives', label: 'False positives', description: 'Computed objects with no matching truth', format: 'count', higherIsBetter: false,
      },
      {
        key: 'false_negatives', label: 'False negatives', description: 'Truth objects that were missed', format: 'count', higherIsBetter: false,
      },
    ],
  },
  {
    name: 'Localization',
    metrics: [
      {
        key: 'mean_iou', label: 'Mean IoU', description: 'Mean overlap of matched pairs', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'median_iou', label: 'Median IoU', description: 'Median overlap of matched pairs', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'mean_center_distance', label: 'Center distance', description: 'Mean distance between matched box centers', format: 'pixels', higherIsBetter: false,
      },
      {
        key: 'mean_size_error', label: 'Size error', description: 'Mean relative area error of matched boxes', format: 'ratio', higherIsBetter: false,
      },
    ],
  },
  {
    name: 'Segmentation',
    requires: 'polygon_pairs',
    metrics: [
      {
        key: 'polygon_pairs', label: 'Polygon pairs', description: 'Matched pairs with a polygon on both sides', format: 'count',
      },
      {
        key: 'mean_polygon_iou', label: 'Mean polygon IoU', description: 'Mean mask overlap of those pairs', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'median_polygon_iou', label: 'Median polygon IoU', description: 'Median mask overlap of those pairs', format: 'ratio', higherIsBetter: true,
      },
    ],
  },
  {
    name: 'Keypoints',
    requires: 'keypoint_pairs',
    metrics: [
      {
        key: 'keypoint_pairs', label: 'Keypoint pairs', description: 'Matched pairs with head or tail on both sides', format: 'count',
      },
      {
        key: 'keypoint_pck', label: 'PCK', description: 'Fraction of keypoints within the tolerance', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'head_pck', label: 'Head PCK', description: 'Fraction of head points within the tolerance', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'tail_pck', label: 'Tail PCK', description: 'Fraction of tail points within the tolerance', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'keypoint_mean_error', label: 'Mean error', description: 'Mean keypoint distance from truth', format: 'pixels', higherIsBetter: false,
      },
      {
        key: 'head_mean_error', label: 'Head error', description: 'Mean head distance from truth', format: 'pixels', higherIsBetter: false,
      },
      {
        key: 'tail_mean_error', label: 'Tail error', description: 'Mean tail distance from truth', format: 'pixels', higherIsBetter: false,
      },
    ],
  },
  {
    name: 'Length',
    requires: 'length_pairs',
    metrics: [
      {
        key: 'length_pairs', label: 'Length pairs', description: 'Matched pairs with a length on both sides', format: 'count',
      },
      {
        key: 'length_mae', label: 'MAE', description: 'Mean absolute length error', format: 'number', higherIsBetter: false,
      },
      {
        key: 'length_mape', label: 'MAPE', description: 'Mean absolute length error relative to truth', format: 'ratio', higherIsBetter: false,
      },
      {
        key: 'length_rmse', label: 'RMSE', description: 'Root mean square length error', format: 'number', higherIsBetter: false,
      },
      {
        key: 'length_bias', label: 'Bias', description: 'Mean signed length error, computed minus truth', format: 'number',
      },
    ],
  },
  {
    name: 'Tracking',
    requires: 'total_gt_tracks',
    metrics: [
      {
        key: 'mota', label: 'MOTA', description: 'Multiple object tracking accuracy', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'motp', label: 'MOTP', description: 'Mean IoU of matches (higher is better)', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'hota', label: 'HOTA', description: 'Higher order tracking accuracy', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'deta', label: 'DetA', description: 'HOTA detection accuracy', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'assa', label: 'AssA', description: 'HOTA association accuracy', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'loca', label: 'LocA', description: 'HOTA localization accuracy', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'idf1', label: 'IDF1', description: 'Identity F1', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'idp', label: 'IDP', description: 'Identity precision', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'idr', label: 'IDR', description: 'Identity recall', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'id_switches', label: 'ID switches', description: 'Times a truth track changed computed identity', format: 'count', higherIsBetter: false,
      },
      {
        key: 'fragmentations', label: 'Fragmentations', description: 'Times a truth track lost and regained coverage', format: 'count', higherIsBetter: false,
      },
      {
        key: 'mostly_tracked', label: 'Mostly tracked', description: 'Truth tracks covered at least 80% of their span', format: 'count', higherIsBetter: true,
      },
      {
        key: 'partially_tracked', label: 'Partially tracked', description: 'Truth tracks covered 20% to 80% of their span', format: 'count',
      },
      {
        key: 'mostly_lost', label: 'Mostly lost', description: 'Truth tracks covered under 20% of their span', format: 'count', higherIsBetter: false,
      },
      {
        key: 'faf', label: 'False alarms / frame', description: 'False positives per frame', format: 'number', higherIsBetter: false,
      },
      {
        key: 'avg_track_continuity', label: 'Track continuity', description: 'KWANT continuity of computed tracks', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'avg_track_purity', label: 'Track purity', description: 'KWANT purity of computed tracks', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'avg_target_continuity', label: 'Target continuity', description: 'KWANT continuity of truth tracks', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'avg_target_purity', label: 'Target purity', description: 'KWANT purity of truth tracks', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'track_pd', label: 'Track Pd', description: 'Fraction of truth tracks detected', format: 'ratio', higherIsBetter: true,
      },
      {
        key: 'track_fa', label: 'Track FA', description: 'Computed tracks matching no truth', format: 'count', higherIsBetter: false,
      },
      {
        key: 'avg_track_length', label: 'Avg track length', description: 'Mean computed track length', format: 'frames',
      },
      {
        key: 'avg_gt_track_length', label: 'Avg truth length', description: 'Mean truth track length', format: 'frames',
      },
      {
        key: 'track_completeness', label: 'Completeness', description: 'Mean truth coverage by the best computed track', format: 'ratio', higherIsBetter: true,
      },
    ],
  },
  {
    name: 'Dataset',
    metrics: [
      {
        key: 'total_frames', label: 'Frames', description: 'Frames carrying any object', format: 'count',
      },
      {
        key: 'total_gt_objects', label: 'Truth objects', description: 'Truth objects scored', format: 'count',
      },
      {
        key: 'total_computed', label: 'Computed objects', description: 'Computed objects scored', format: 'count',
      },
      {
        key: 'total_gt_tracks', label: 'Truth tracks', description: 'Distinct truth track ids', format: 'count',
      },
      {
        key: 'total_computed_tracks', label: 'Computed tracks', description: 'Distinct computed track ids', format: 'count',
      },
      {
        key: 'classification_accuracy', label: 'Classification accuracy', description: 'Matched pairs whose classes agree', format: 'ratio', higherIsBetter: true,
      },
    ],
  },
];

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = Object.fromEntries(
  METRIC_GROUPS.flatMap((group) => group.metrics.map((m) => [m.key, m])),
);

export function formatMetric(value: number | null | undefined, format: MetricDefinition['format'] = 'ratio'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  switch (format) {
    case 'count':
      return String(Math.round(value));
    case 'frames':
      return `${value.toFixed(1)} f`;
    case 'pixels':
      return `${value.toFixed(1)} px`;
    case 'number':
      return value.toFixed(3);
    case 'ratio':
    default:
      return value.toFixed(3);
  }
}

/** Compact label for a source, used in chips and result titles. */
export function describeSource(source: { datasetId: string; set?: string; revision?: number; file?: string; label?: string }, datasetName?: string): string {
  if (source.label) return source.label;
  const parts = [datasetName || source.datasetId];
  if (source.set) parts.push(`set ${source.set}`);
  if (source.revision !== undefined) parts.push(`rev ${source.revision}`);
  if (source.file) parts.push(source.file.split(/[\\/]/).pop() || source.file);
  return parts.join(' · ');
}
