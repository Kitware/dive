/**
 * Video search results as review grid items plus the chip store that
 * renders them, shared by the Video Search side panel (row thumbnails) and
 * the full-window results grid. Chips are cropped client-side from each
 * result's own dataset media through the review frame sources, so
 * cross-dataset results need no backend frame extraction.
 *
 * Results and their cached chips are only comparable within one query
 * generation (state.queryGeneration): the service can reuse refs across
 * queries, so the store is reset whenever a new query starts.
 */
import { computed, Ref, watch } from 'vue';
import { loadConfig } from 'platform/desktop/frontend/api';
import type { VideoSearchContextType } from 'platform/desktop/frontend/useVideoSearch';
import { createChipStore } from 'dive-common/review/chipStore';
import { createFrameSourceRegistry } from 'dive-common/review/frameSource';
import { searchResultItem } from 'dive-common/review/searchResultItems';
import type { ReviewItem } from 'dive-common/review/types';
import { DEFAULT_REVIEW_GRID } from 'dive-common/review/types';

/** How many of the newest results the panel eagerly loads thumbnails for. */
const EagerLoadCount = 50;
/** Thumbnail resolution for the panel list; the grid re-renders at its own size. */
const PanelChipSize = 128;

export function createSearchChips(search: VideoSearchContextType) {
  const registry = createFrameSourceRegistry(loadConfig);
  const store = createChipStore({ frameSourceFor: registry.frameSourceFor }, {
    padding: DEFAULT_REVIEW_GRID.padding, size: PanelChipSize, aspect: 1, outline: '#00e5ff',
  });

  /** Every current result as a grid item, in rank order. */
  const items = computed<ReviewItem[]>(() => search.state.results
    .map((result) => searchResultItem(
      result,
      search.resultDatasetId(result) ?? '',
      DEFAULT_REVIEW_GRID.maxSequenceFrames,
    ))
    .filter((item): item is ReviewItem => item !== null));

  const itemsByRef = computed(() => {
    const map = new Map<string, ReviewItem>();
    items.value.forEach((item) => map.set(item.key, item));
    return map;
  });

  let generation = search.state.queryGeneration;
  // Immediate so results that predate this store (e.g. the panel was
  // toggled closed and back open) still get their chips loaded.
  watch(items, (current) => {
    if (search.state.queryGeneration !== generation) {
      // New query: refs may repeat with different content, so start over.
      generation = search.state.queryGeneration;
      store.reset();
    }
    // Refinement re-ranks within the same query; cached chips stay valid.
    store.ensurePrimary(current.slice(0, EagerLoadCount));
  }, { immediate: true });

  function dispose() {
    store.reset();
    registry.dispose();
  }

  return {
    store,
    items,
    itemsByRef,
    chips: store.chips,
    dispose,
  };
}

export type SearchChips = ReturnType<typeof createSearchChips>;

/**
 * Chips for any list of grid items whose datasets can be loaded by id
 * (e.g. text query hits), with the same cross-dataset cropping.
 */
export function createItemChips(items: Ref<ReviewItem[]>) {
  const registry = createFrameSourceRegistry(loadConfig);
  const store = createChipStore({ frameSourceFor: registry.frameSourceFor }, {
    padding: DEFAULT_REVIEW_GRID.padding, size: PanelChipSize, aspect: 1, outline: '',
  });
  const itemsByKey = computed(() => new Map(items.value.map((item) => [item.key, item])));
  watch(items, (current, previous) => {
    // A new hit list is a new result set; cached chips would belong to the old one.
    if (!previous || current.length === 0 || current[0]?.key !== previous[0]?.key) store.reset();
    store.ensurePrimary(current.slice(0, EagerLoadCount));
  }, { immediate: true });
  return {
    store,
    items,
    itemsByKey,
    chips: store.chips,
    dispose: () => {
      store.reset();
      registry.dispose();
    },
  };
}

export type ItemChips = ReturnType<typeof createItemChips>;
