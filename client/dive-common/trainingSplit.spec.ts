import { describe, expect, it } from 'vitest';
import { isTrainingSplit, summarizeTrainingSplits } from './trainingSplit';

describe('summarizeTrainingSplits', () => {
  it('treats unlabeled and unknown values as training data', () => {
    const summary = summarizeTrainingSplits([null, undefined, 'holdout', 'train']);
    expect(summary.counts).toEqual({ train: 4, validation: 0, test: 0 });
    expect(summary.labeled).toBe(true);
    expect(summary.trainable).toBe(true);
    expect(summary.text).toBe('4 train');
  });

  it('reports each split in order and flags a selection with nothing to train on', () => {
    const summary = summarizeTrainingSplits(['test', 'validation', 'test']);
    expect(summary.text).toBe('1 validation · 2 test');
    expect(summary.trainable).toBe(false);
    expect(summarizeTrainingSplits([]).labeled).toBe(false);
  });

  it('recognizes only the three split names', () => {
    expect(['train', 'validation', 'test'].every(isTrainingSplit)).toBe(true);
    expect(isTrainingSplit('Train')).toBe(false);
    expect(isTrainingSplit(null)).toBe(false);
  });
});
