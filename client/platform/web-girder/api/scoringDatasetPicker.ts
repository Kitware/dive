import type { ScoringDatasetSummary } from 'dive-common/scoring/types';
import { reactive } from 'vue';

export const scoringDatasetPickerState = reactive({
  open: false,
  excludeIds: [] as string[],
});

let pendingResolve: ((value: ScoringDatasetSummary | null) => void) | null = null;

export function pickScoringDataset(excludeIds: string[]): Promise<ScoringDatasetSummary | null> {
  return new Promise((resolve) => {
    if (pendingResolve) {
      pendingResolve(null);
    }
    pendingResolve = resolve;
    scoringDatasetPickerState.excludeIds = [...excludeIds];
    scoringDatasetPickerState.open = true;
  });
}

export function finishScoringDatasetPicker(dataset: ScoringDatasetSummary | null) {
  scoringDatasetPickerState.open = false;
  scoringDatasetPickerState.excludeIds = [];
  pendingResolve?.(dataset);
  pendingResolve = null;
}
