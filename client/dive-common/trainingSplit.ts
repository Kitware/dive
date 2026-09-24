/**
 * Optional per-dataset role in a training run. Unlabeled datasets train;
 * validation and test datasets are held out and handed to `viame train`
 * as such.
 */
export type TrainingSplit = 'train' | 'validation' | 'test';

export const TrainingSplitOptions: readonly {
  value: TrainingSplit; text: string; color: string; hint: string;
}[] = [
  {
    value: 'train', text: 'Train', color: 'primary', hint: 'Used to fit the model',
  },
  {
    value: 'validation', text: 'Validation', color: 'warning', hint: 'Held out to monitor training',
  },
  {
    value: 'test', text: 'Test', color: 'success', hint: 'Excluded from training, kept for scoring',
  },
];

export function isTrainingSplit(value: unknown): value is TrainingSplit {
  return TrainingSplitOptions.some((option) => option.value === value);
}

export function trainingSplitOption(value: unknown) {
  return TrainingSplitOptions.find((option) => option.value === value) || null;
}

/** Counts per split for a training selection; unlabeled datasets train. */
export function summarizeTrainingSplits(splits: readonly unknown[]) {
  const counts: Record<TrainingSplit, number> = { train: 0, validation: 0, test: 0 };
  splits.forEach((split) => {
    counts[isTrainingSplit(split) ? split : 'train'] += 1;
  });
  const labeled = splits.some((split) => isTrainingSplit(split));
  const text = TrainingSplitOptions
    .filter((option) => counts[option.value] > 0)
    .map((option) => `${counts[option.value]} ${option.text.toLowerCase()}`)
    .join(' · ');
  return {
    counts,
    labeled,
    text,
    trainable: counts.train > 0,
  };
}
