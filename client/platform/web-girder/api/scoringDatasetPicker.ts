import type { ScoringDatasetSummary } from 'dive-common/scoring/types';
import { reactive } from 'vue';

export const scoringDatasetPickerState = reactive({
  open: false,
  purpose: 'scoring' as 'scoring' | 'review',
  excludeIds: [] as string[],
});

let pendingResolve: ((value: ScoringDatasetSummary | null) => void) | null = null;

function pickDataset(excludeIds: string[], purpose: 'scoring' | 'review'): Promise<ScoringDatasetSummary | null> {
  return new Promise((resolve) => {
    if (pendingResolve) {
      pendingResolve(null);
    }
    pendingResolve = resolve;
    scoringDatasetPickerState.excludeIds = [...excludeIds];
    scoringDatasetPickerState.purpose = purpose;
    scoringDatasetPickerState.open = true;
  });
}

export function finishScoringDatasetPicker(dataset: ScoringDatasetSummary | null) {
  scoringDatasetPickerState.open = false;
  scoringDatasetPickerState.excludeIds = [];
  pendingResolve?.(dataset);
  pendingResolve = null;
}

export function pickScoringDataset(excludeIds: string[]) {
  return pickDataset(excludeIds, 'scoring');
}

export function pickReviewDataset(excludeIds: string[]) {
  return pickDataset(excludeIds, 'review');
}
