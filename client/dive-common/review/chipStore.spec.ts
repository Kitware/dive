import { expect, it, vi } from 'vitest';
import { createChipStore } from './chipStore';
import type { ReviewItem } from './types';

vi.mock('./chipRenderer', () => ({
  renderChip: () => ({ dataUrl: 'chip', transform: {} }),
}));

function item(key: string): ReviewItem {
  return {
    key, datasetId: 'a', primary: { frame: 0 }, frames: [],
  } as unknown as ReviewItem;
}

it('bounds cached chips across pages while retaining the visible page', async () => {
  const store = createChipStore({
    cacheSize: 2,
    frameSourceFor: () => ({ frameCount: 1, getFrame: vi.fn(), dispose: vi.fn() }),
  }, {
    padding: 0, size: 256, aspect: 1, outline: '',
  });
  store.ensurePrimary([item('a'), item('b'), item('c')]);
  await vi.waitFor(() => expect(Object.keys(store.chips.value)).toHaveLength(3));
  store.trimQueues(new Set(['c']));
  expect(Object.keys(store.chips.value)).toEqual(['b', 'c']);
  expect(store.transforms.value.a).toBeUndefined();
  store.ensurePrimary([item('a')]);
  await vi.waitFor(() => expect(store.chips.value.a).toBe('chip'));
  store.trimQueues(new Set(['a', 'b', 'c']));
  expect(Object.keys(store.chips.value)).toHaveLength(3);
});
