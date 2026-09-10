import { describe, expect, it } from 'vitest';
import { datasetTypeOptions, filterDatasetRows, selectableIds } from './datasetPicker';

const rows = [
  {
    id: 'a', name: 'Amchitka East', type: 'image-sequence', fps: 5,
  },
  {
    id: 'b', name: 'Bering clip', type: 'video', fps: 30,
  },
  { id: 'c', name: 'Caton rig', type: 'multi' },
];

describe('filterDatasetRows', () => {
  it('matches names only by default, ignoring case and surrounding space', () => {
    expect(filterDatasetRows(rows, '  bering ').map((r) => r.id)).toEqual(['b']);
    expect(filterDatasetRows(rows, 'ri').map((r) => r.id)).toEqual(['b', 'c']);
    expect(filterDatasetRows(rows, 'video')).toHaveLength(0);
    expect(filterDatasetRows(rows, '')).toHaveLength(3);
    expect(filterDatasetRows(rows, null)).toHaveLength(3);
  });

  it('keeps rows whose type equals the type filter, ignoring case and space', () => {
    expect(filterDatasetRows(rows, '', ['name'], '  VIDEO ').map((r) => r.id)).toEqual(['b']);
    expect(filterDatasetRows(rows, '', ['name'], 'image-sequence').map((r) => r.id)).toEqual(['a']);
    expect(filterDatasetRows(rows, '', ['name'], null)).toHaveLength(3);
  });

  it('applies search and type filter together', () => {
    expect(filterDatasetRows(rows, 'ri', ['name'], 'video').map((r) => r.id)).toEqual(['b']);
    expect(filterDatasetRows(rows, 'ri', ['name'], 'multi').map((r) => r.id)).toEqual(['c']);
    expect(filterDatasetRows(rows, 'Amchitka', ['name'], 'video')).toHaveLength(0);
  });
});

describe('datasetTypeOptions', () => {
  it('lists distinct types in sorted order', () => {
    expect(datasetTypeOptions(rows)).toEqual(['image-sequence', 'multi', 'video']);
  });
});

describe('selectableIds', () => {
  it('leaves out what is already selected', () => {
    expect(selectableIds(rows, ['b'])).toEqual(['a', 'c']);
    expect(selectableIds(filterDatasetRows(rows, 'rig'), ['c'])).toEqual([]);
  });
});
