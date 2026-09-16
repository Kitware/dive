import { exportFilename, resultToCsv, resultToJson } from './export';
import { DEFAULT_SCORING_PARAMS } from './metrics';
import type { ScoringResultFile } from './types';

const RESULT: ScoringResultFile = {
  version: 1,
  id: 'scoring_1.json',
  datasetId: 'a',
  created: '2026-09-06T14:05:09.000Z',
  title: 'Alpha vs Beta',
  pairs: [{ computed: { datasetId: 'a', label: 'Alpha' }, truth: { datasetId: 'b', label: 'Beta, GT' } }],
  params: { ...DEFAULT_SCORING_PARAMS, labelSynonyms: '' },
  metrics: {
    precision: 0.5,
    recall: 0.25,
    custom_extra: 3,
    per_class: { fish: { precision: 1, recall: 0.5, f1_score: 0.6667 } },
    confusion_matrix: {
      class_names: ['fish', 'background'],
      matrix: [[2, 1], [3, 0]],
      normalized_matrix: [[0.67, 0.33], [1, 0]],
      per_class_accuracy: { fish: 0.67 },
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
        },
      },
    },
  },
};

describe('scoring exports', () => {
  it('names files by the run timestamp', () => {
    expect(exportFilename(RESULT, 'csv')).toMatch(/^scoring_2026\d{4}_\d{6}\.csv$/);
  });

  it('round-trips the run through JSON', () => {
    expect(JSON.parse(resultToJson(RESULT))).toEqual(RESULT);
  });

  it('writes labelled summary, per-class, confusion and sweep blocks', () => {
    const csv = resultToCsv(RESULT);
    expect(csv).toContain('# Run\ntitle,Alpha vs Beta');
    expect(csv).toContain('sequence 1 truth,"Beta, GT"');
    expect(csv).toContain('param iouThreshold,0.5');
    expect(csv).not.toContain('labelSynonyms');
    expect(csv).toContain('precision,Precision,0.5');
    expect(csv).toContain('custom_extra,custom_extra,3');
    expect(csv).toContain('# Per class\nclass,total_gt');
    expect(csv).toContain('\nfish,,,,,,1,0.5,0.6667,');
    expect(csv).toContain('truth \\ computed,fish,background\nfish,2,1\nbackground,3,0');
    expect(csv).toContain('overall,0.5,0.5,0.2,0');
  });
});
