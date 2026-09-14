import { cellScaleFor, clampGrid } from './gridSettings';
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

describe('cellScaleFor', () => {
  it('grows footer text as the grid shows fewer cells, within limits', () => {
    expect(cellScaleFor(5, 4)).toBeCloseTo(1.12, 2);
    expect(cellScaleFor(3, 3)).toBe(1.35);
    expect(cellScaleFor(1, 1)).toBe(1.35);
    expect(cellScaleFor(8, 6)).toBe(1);
    expect(cellScaleFor(12, 10)).toBe(1);
  });
});
