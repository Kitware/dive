import { clampGrid } from './gridSettings';
import { DEFAULT_REVIEW_GRID } from './types';

describe('clampGrid', () => {
  it('rounds and clamps columns and rows and clamps padding', () => {
    expect(clampGrid({
      ...DEFAULT_REVIEW_GRID, columns: 40, rows: 0.4, padding: -2,
    })).toMatchObject({
      columns: 12, rows: 1, padding: 0,
    });
    expect(clampGrid({
      ...DEFAULT_REVIEW_GRID, columns: 3.6, rows: 2.2, padding: 0.5,
    })).toMatchObject({
      columns: 4, rows: 2, padding: 0.5,
    });
  });

  it('falls back to defaults for non-numbers', () => {
    expect(clampGrid({ ...DEFAULT_REVIEW_GRID, columns: Number.NaN, rows: Infinity })).toMatchObject({
      columns: DEFAULT_REVIEW_GRID.columns, rows: DEFAULT_REVIEW_GRID.rows,
    });
  });
});
