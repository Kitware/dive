import {
  DEFAULT_SCORING_PARAMS,
  headlineMetrics,
  parseScoringMatches,
  parseScoringMetrics,
  perFrameErrorCounts,
  scoringCliArgs,
  summarizeResult,
} from './metrics';
import type { RawScoringMatches, ScoringResultFile } from './types';

const RAW_METRICS = {
  precision: 0.5,
  recall: 0.25,
  f1_score: 0.3333,
  mota: null,
  hota: Number.NaN,
  true_positives: 3,
  config: {
    iou_threshold: 0.5, confidence_threshold: 0, match_mode: 'polygon', keypoint_threshold: 0.1, per_class: true, tracking: true,
  },
  per_class: { fish: { precision: 1, recall: 0.5, ap50: null } },
  confusion_matrix: {
    class_names: ['fish', 'background'],
    matrix: [[2, 1], [3, 0]],
    normalized_matrix: [[0.6667, 0.3333], [1, 0]],
    per_class_accuracy: { fish: 0.6667 },
  },
  pr_curve: {
    average_precision: 0.4,
    max_f1: 0.5,
    best_threshold: 0.3,
    points: [{
      recall: 0, precision: 1, confidence: 0.9, f1: 0, tp: 0, fp: 0, fn: 4,
    }, {
      recall: 0.5, precision: 0.5, confidence: 0.3, f1: 0.5, tp: 2, fp: 2, fn: 2,
    }],
  },
  roc_curve: { mean_pd: 0.4, max_false_alarms_per_frame: 1, points: [{ false_alarms_per_frame: 0, true_positive_rate: 0, confidence: null }] },
  per_class_pr_curves: {
    fish: {
      average_precision: 0.4, max_f1: 0.5, best_threshold: 0.3, points: [],
    },
  },
  sweep: {
    interval: 2,
    curves: {
      overall: {
        best: {
          idf1: 0.5, idf1_thresh: 0.5, mota: 0.2, mota_thresh: 0,
        },
        thresholds: [0, 0.5],
        mota: [0.2, 0.1],
        idf1: [0.4, 0.5],
      },
    },
  },
};

const RAW_MATCHES: RawScoringMatches = {
  columns: ['sequence', 'frame', 'status', 'computed_id', 'gt_id', 'iou', 'confidence', 'computed_class', 'gt_class'],
  frame_names: [[0, 0, 'a.png'], [0, 2, 'c.png']],
  rows: [
    [0, 0, 'tp', 1, 7, 0.8, 0.9, 'fish', 'fish'],
    [0, 0, 'fp', 2, -1, 0, 0.4, 'fish', ''],
    [0, 2, 'fn', -1, 8, 0, 0, '', 'fish'],
    [0, 2, 'fn', -1, 9, 0, 0, '', 'fish'],
  ],
};

describe('scoringCliArgs', () => {
  const paths = {
    computed: '/c.csv', truth: '/t.csv', metricsOut: '/m.json', matchesOut: '/x.json', sweepDir: '/sweep',
  };

  it('emits the sweep, match and curve flags for the defaults', () => {
    const args = scoringCliArgs(DEFAULT_SCORING_PARAMS, paths);
    expect(args.slice(0, 6)).toEqual(['-c', '/c.csv', '-t', '/t.csv', '-o', '/m.json']);
    expect(args).toContain('--json-curves');
    expect(args).toContain('--per-class');
    expect(args).toContain('--sweep-thresholds');
    expect(args).toContain('--output-sweep');
    expect(args).toContain('--output-matches');
    expect(args).not.toContain('--no-tracking');
    expect(args).not.toContain('--labels');
    expect(args[args.indexOf('--match-mode') + 1]).toBe('box');
  });

  it('drops the sweep and tracking flags when disabled and adds the labels file', () => {
    const args = scoringCliArgs({
      ...DEFAULT_SCORING_PARAMS, sweep: false, tracking: false, matchMode: 'polygon', defaultLabel: 'fish',
    }, { ...paths, labelsFile: '/labels.txt' });
    expect(args).not.toContain('--sweep-thresholds');
    expect(args).toContain('--no-tracking');
    expect(args[args.indexOf('--match-mode') + 1]).toBe('polygon');
    expect(args[args.indexOf('--labels') + 1]).toBe('/labels.txt');
    expect(args[args.indexOf('--defaultlabel') + 1]).toBe('fish');
  });
});

describe('parseScoringMetrics', () => {
  const parsed = parseScoringMetrics(RAW_METRICS);

  it('separates flat values from the structured sections', () => {
    expect(parsed.values.precision).toBe(0.5);
    expect(parsed.values.mota).toBeNull();
    expect(parsed.values.hota).toBeNull();
    expect(parsed.values.config).toBeUndefined();
    expect(parsed.config?.matchMode).toBe('polygon');
    expect(parsed.perClass.fish.ap50).toBeNull();
  });

  it('parses the confusion matrix, curves and sweep', () => {
    expect(parsed.confusionMatrix?.classNames).toEqual(['fish', 'background']);
    expect(parsed.confusionMatrix?.matrix[1][0]).toBe(3);
    expect(parsed.prCurve?.points).toHaveLength(2);
    expect(parsed.prCurve?.points[1].confidence).toBe(0.3);
    expect(parsed.rocCurve?.points[0].confidence).toBeNull();
    expect(Object.keys(parsed.perClassPrCurves)).toEqual(['fish']);
    expect(parsed.sweep?.curves.overall.thresholds).toEqual([0, 0.5]);
    expect(parsed.sweep?.curves.overall.metrics.mota).toEqual([0.2, 0.1]);
    expect(parsed.sweep?.curves.overall.metrics.best).toBeUndefined();
    expect(parsed.sweep?.curves.overall.best.idf1Thresh).toBe(0.5);
  });

  it('tolerates a metrics file with none of the optional sections', () => {
    const minimal = parseScoringMetrics({ precision: 1 });
    expect(minimal.confusionMatrix).toBeNull();
    expect(minimal.prCurve).toBeNull();
    expect(minimal.sweep).toBeNull();
    expect(minimal.perClass).toEqual({});
  });
});

describe('parseScoringMatches', () => {
  const matches = parseScoringMatches(RAW_MATCHES);

  it('resolves frame names and turns -1 ids into nulls', () => {
    expect(matches).toHaveLength(4);
    expect(matches[0]).toMatchObject({
      frame: 0, frameName: 'a.png', status: 'tp', computedId: 1, gtId: 7, iou: 0.8,
    });
    expect(matches[1].gtId).toBeNull();
    expect(matches[2].computedId).toBeNull();
    expect(matches[2].frameName).toBe('c.png');
  });

  it('tallies per frame in frame order', () => {
    expect(perFrameErrorCounts(matches)).toEqual([
      {
        frame: 0, tp: 1, fp: 1, fn: 0,
      },
      {
        frame: 2, tp: 0, fp: 0, fn: 2,
      },
    ]);
  });

  it('returns nothing for a missing payload', () => {
    expect(parseScoringMatches(undefined)).toEqual([]);
  });
});

describe('summaries', () => {
  it('keeps only finite headline numbers', () => {
    const headline = headlineMetrics(RAW_METRICS);
    expect(headline.precision).toBe(0.5);
    expect(headline.mota).toBeNull();
    expect(headline.hota).toBeNull();
    expect('config' in headline).toBe(false);
  });

  it('summarizes a result file without its payloads', () => {
    const file: ScoringResultFile = {
      version: 1,
      id: 'scoring_1.json',
      datasetId: 'a',
      created: '2026-09-06T00:00:00.000Z',
      title: 'a vs b',
      pairs: [{ computed: { datasetId: 'a' }, truth: { datasetId: 'b' } }],
      params: DEFAULT_SCORING_PARAMS,
      metrics: RAW_METRICS,
      matches: RAW_MATCHES,
    };
    const summary = summarizeResult(file);
    expect(summary.headline.precision).toBe(0.5);
    expect(summary.datasetId).toBe('a');
    expect(summary.pairs).toHaveLength(1);
    expect('metrics' in summary).toBe(false);
    expect('matches' in summary).toBe(false);
  });
});
