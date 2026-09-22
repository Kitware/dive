/**
 * Grid presentation settings (columns, rows, context margin) shared by every
 * chip grid in the app and remembered per browser.
 */
import { reactive, watch } from 'vue';
import { DEFAULT_REVIEW_GRID, REVIEW_GRID_LIMITS, ReviewGridSettings } from './types';

/**
 * Size factor for a cell's footer text: a 5x4 grid reads about a tenth
 * larger than the base size, a 3x3 grid about a third larger, and dense
 * grids stay at the base size.
 */
export function cellScaleFor(columns: number, rows: number): number {
  const cells = Math.max(1, columns * rows);
  return Math.round(Math.min(1.35, Math.max(1, 5 / Math.sqrt(cells))) * 100) / 100;
}

const GRID_STORAGE_KEY = 'dive.review.grid';

export function loadGridSettings(): ReviewGridSettings {
  try {
    const raw = window.localStorage.getItem(GRID_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_REVIEW_GRID, ...parsed };
      }
    }
  } catch {
    // Storage may be unavailable; defaults are fine.
  }
  return { ...DEFAULT_REVIEW_GRID };
}

export function storeGridSettings(grid: ReviewGridSettings) {
  try {
    window.localStorage.setItem(GRID_STORAGE_KEY, JSON.stringify(grid));
  } catch {
    // Ignore storage failures.
  }
}

export function clampGrid(grid: ReviewGridSettings): ReviewGridSettings {
  const clamp = (value: number, [min, max]: readonly [number, number], fallback: number) => (
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
  );
  return {
    ...grid,
    columns: Math.round(clamp(grid.columns, REVIEW_GRID_LIMITS.columns, DEFAULT_REVIEW_GRID.columns)),
    rows: Math.round(clamp(grid.rows, REVIEW_GRID_LIMITS.rows, DEFAULT_REVIEW_GRID.rows)),
    padding: clamp(grid.padding, REVIEW_GRID_LIMITS.padding, DEFAULT_REVIEW_GRID.padding),
  };
}

/** A reactive settings object seeded from storage and written back on change. */
export function usePersistentGridSettings(): ReviewGridSettings {
  const grid = reactive<ReviewGridSettings>(clampGrid(loadGridSettings()));
  watch(grid, () => storeGridSettings({ ...grid }), { deep: true });
  return grid;
}
