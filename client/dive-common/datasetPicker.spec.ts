import { filterDatasetRows, selectableIds } from './datasetPicker';

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
  it('matches any listed field, ignoring case and surrounding space', () => {
    expect(filterDatasetRows(rows, '  VIDEO ').map((r) => r.id)).toEqual(['b']);
    expect(filterDatasetRows(rows, 'ri').map((r) => r.id)).toEqual(['b', 'c']);
    expect(filterDatasetRows(rows, '30', ['fps']).map((r) => r.id)).toEqual(['b']);
    expect(filterDatasetRows(rows, '')).toHaveLength(3);
  });
});

describe('selectableIds', () => {
  it('leaves out what is already selected', () => {
    expect(selectableIds(rows, ['b'])).toEqual(['a', 'c']);
    expect(selectableIds(filterDatasetRows(rows, 'rig'), ['c'])).toEqual([]);
  });
});
