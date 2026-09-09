/**
 * Paging, zoom and chip-loading behaviour shared by every chip grid: the
 * review page and any other view that shows {@link ReviewItem}s in a
 * {@link ReviewGrid}. Owns the current page, keeps the chip store rendering
 * at the cells' resolution and aspect ratio, and loads chips for the
 * visible page (plus a prefetch of the next one).
 */
import {
  computed, ref, Ref, unref, watch,
} from 'vue';
import { debounce } from 'lodash';
import type { ChipStore } from './chipStore';
import { chipSizeFor } from './chipRenderer';
import { clampGrid } from './gridSettings';
import { REVIEW_GRID_LIMITS, ReviewGridSettings, ReviewItem } from './types';

const CHIP_OUTLINE = '#00e5ff';
/** Height of a cell's footer (type field and caption), excluded from the image area. */
const CELL_FOOTER_PX = 46;

/** Chip aspect for a cell, coarsened so window resizes rarely force a re-render. */
export function chipAspectFor(cellWidth: number, cellHeight: number, footerPx = CELL_FOOTER_PX): number {
  const imageHeight = cellHeight - footerPx;
  if (cellWidth <= 0 || imageHeight <= 0) return 1;
  const ratio = Math.min(3, Math.max(1 / 3, cellWidth / imageHeight));
  return Math.round(ratio * 10) / 10;
}

export interface ReviewGridOptions {
  items: Ref<readonly ReviewItem[]>;
  /** Reactive grid settings (mutated in place by the setters below). */
  grid: ReviewGridSettings;
  chipStore: ChipStore;
  /** Whether the grid is on screen; chips only load and keys only page while true. */
  active: Ref<boolean>;
  /** Footer height to exclude from the chip aspect ratio. */
  footerPx?: number | Ref<number>;
  /** Box outline burned into the chips; empty draws none (the cell overlays it). */
  outline?: string;
}

/** How long paging must be idle before chips load, so skipped pages never render. */
const PAGE_SETTLE_MS = 250;

export function useReviewGrid(options: ReviewGridOptions) {
  const {
    items, grid, chipStore, active,
  } = options;
  const page = ref(0);
  const cellSize = ref({ width: 0, height: 0 });

  const perPage = computed(() => grid.columns * grid.rows);
  const pageCount = computed(() => Math.max(1, Math.ceil(items.value.length / perPage.value)));
  const pageItems = computed(() => items.value.slice(page.value * perPage.value, (page.value + 1) * perPage.value));
  const nextPageItems = computed(() => items.value.slice((page.value + 1) * perPage.value, (page.value + 2) * perPage.value));

  function ensureVisible() {
    if (!active.value) return;
    const visible = pageItems.value;
    const prefetch = nextPageItems.value;
    chipStore.trimQueues(new Set([...visible, ...prefetch].map((i) => i.key)));
    chipStore.ensurePrimary([...visible, ...prefetch]);
    chipStore.ensureSequences(visible);
  }

  const applyChipOptions = debounce(() => {
    const pixels = Math.max(cellSize.value.width, cellSize.value.height)
      * (window.devicePixelRatio || 1);
    if (pixels <= 0) return;
    chipStore.setOptions({
      padding: grid.padding,
      size: chipSizeFor(pixels),
      aspect: chipAspectFor(cellSize.value.width, cellSize.value.height, unref(options.footerPx)),
      outline: options.outline ?? CHIP_OUTLINE,
    });
    ensureVisible();
  }, 200);

  /**
   * Rapid paging only loads the page landed on: queued work for pages
   * passed over is dropped at once, and new work waits for paging to settle.
   */
  const ensureVisibleSettled = debounce(ensureVisible, PAGE_SETTLE_MS);
  function onPageChanged() {
    if (!active.value) return;
    chipStore.trimQueues(new Set(pageItems.value.map((i) => i.key)));
    ensureVisibleSettled();
  }

  watch(() => [grid.padding, cellSize.value.width, cellSize.value.height, unref(options.footerPx)], applyChipOptions);
  watch(page, onPageChanged);
  watch(active, ensureVisible);
  watch(items, () => {
    page.value = 0;
    ensureVisible();
  });
  watch(perPage, () => {
    page.value = Math.min(page.value, pageCount.value - 1);
    ensureVisible();
  });

  function goToPage(next: number) {
    page.value = Math.min(Math.max(0, next), pageCount.value - 1);
  }

  function setColumns(value: number) {
    Object.assign(grid, clampGrid({ ...grid, columns: Number(value) }));
  }

  function setRows(value: number) {
    Object.assign(grid, clampGrid({ ...grid, rows: Number(value) }));
  }

  function setPadding(value: number) {
    Object.assign(grid, clampGrid({ ...grid, padding: Number(value) }));
  }

  /** Fewer, larger cells (-1) or more, smaller cells (+1), keeping the shape. */
  function zoom(direction: 1 | -1) {
    const ratio = grid.rows / grid.columns;
    const columns = grid.columns + direction;
    const rows = Math.max(1, Math.round(columns * ratio));
    Object.assign(grid, clampGrid({ ...grid, columns, rows }));
  }

  const canZoomIn = computed(() => grid.columns > REVIEW_GRID_LIMITS.columns[0]);
  const canZoomOut = computed(() => grid.columns < REVIEW_GRID_LIMITS.columns[1]);

  function isTypingTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
  }

  /** Arrow / page keys page the grid; returns true when the key was consumed. */
  function handleKeydown(event: KeyboardEvent): boolean {
    if (!active.value || isTypingTarget(event.target)) return false;
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
      goToPage(page.value - 1);
    } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
      goToPage(page.value + 1);
    } else if (event.key === 'Home') {
      goToPage(0);
    } else if (event.key === 'End') {
      goToPage(pageCount.value - 1);
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  }

  function dispose() {
    applyChipOptions.cancel();
    ensureVisibleSettled.cancel();
  }

  return {
    page,
    pageCount,
    perPage,
    pageItems,
    cellSize,
    ensureVisible,
    goToPage,
    setColumns,
    setRows,
    setPadding,
    zoom,
    canZoomIn,
    canZoomOut,
    handleKeydown,
    dispose,
  };
}

export type ReviewGridController = ReturnType<typeof useReviewGrid>;
