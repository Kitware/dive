import {
  computed, reactive, ref,
} from 'vue';
import {
  describe, expect, it, vi,
} from 'vitest';
import type { ChipStore } from './chipStore';
import { useReviewGrid } from './useReviewGrid';
import { DEFAULT_REVIEW_GRID, type ReviewGridSettings, type ReviewItem } from './types';

function reviewItem(key: string, multiFrame = false): ReviewItem {
  const primary = { frame: 0, bounds: [0, 0, 1, 1] as [number, number, number, number] };
  const frames = multiFrame
    ? [primary, { frame: 10, bounds: [0, 0, 1, 1] as [number, number, number, number] }]
    : [primary];
  return {
    key,
    datasetId: 'd',
    trackId: 1,
    primary,
    frames,
    keyframeCount: frames.length,
    type: 'fish',
    confidence: 0.9,
  };
}

function mockChipStore(): { chipStore: ChipStore; ensureSequences: ReturnType<typeof vi.fn> } {
  const ensureSequences = vi.fn();
  const chipStore = {
    ensurePrimary: vi.fn(),
    ensureSequences,
    trimQueues: vi.fn(),
    setOptions: vi.fn(),
  } as unknown as ChipStore;
  return { chipStore, ensureSequences };
}

describe('useReviewGrid sequence loading', () => {
  it('loads sequence frames for the whole page unless hover mode is on', () => {
    const items = ref([reviewItem('a', true), reviewItem('b', true)]);
    const grid = reactive<ReviewGridSettings>({ ...DEFAULT_REVIEW_GRID, columns: 2, rows: 1 });
    const { chipStore, ensureSequences } = mockChipStore();
    const controller = useReviewGrid({
      items,
      grid,
      chipStore,
      active: ref(true),
      activateOnHover: false,
    });
    controller.ensureVisible();
    const sequences = ensureSequences.mock.calls[0][0] as ReviewItem[];
    expect(sequences.map((item) => item.key).sort()).toEqual(['a', 'b']);
  });

  it('loads sequence frames only for hovered entries when hover mode is on', () => {
    const items = ref([reviewItem('a', true), reviewItem('b', true)]);
    const grid = reactive<ReviewGridSettings>({ ...DEFAULT_REVIEW_GRID, columns: 2, rows: 1 });
    const { chipStore, ensureSequences } = mockChipStore();
    const hoverEntryKeys = ref(new Set<string>());
    const controller = useReviewGrid({
      items,
      grid,
      chipStore,
      active: ref(true),
      activateOnHover: computed(() => true),
      hoverEntryKeys,
      entryKeyOf: (entry) => entry.key,
    });
    controller.ensureVisible();
    expect(ensureSequences.mock.calls[0][0]).toEqual([]);
    hoverEntryKeys.value = new Set(['b']);
    controller.ensureVisible();
    const sequences = ensureSequences.mock.calls[1][0] as ReviewItem[];
    expect(sequences.map((item) => item.key)).toEqual(['b']);
  });
});
