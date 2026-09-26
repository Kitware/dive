import { createTypeListViewStore } from './typeListViewState';

function storage() {
  let value: string | null = null;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => { value = next; }),
    removeItem: vi.fn(() => { value = null; }),
  };
}

it('restores saved views across remounts/restarts without sharing mutable arrays', () => {
  const disk = storage();
  const store = createTypeListViewStore(disk);
  const state = { compact: false, collapsed: ['fish'] };
  store.write('dataset-a', state);
  state.collapsed.push('shark');
  const reopened = createTypeListViewStore(disk);
  expect(reopened.read('dataset-a')).toEqual({ compact: false, collapsed: ['fish'] });
  reopened.read('dataset-a').collapsed.push('salmon');
  expect(reopened.read('dataset-a').collapsed).toEqual(['fish']);
  expect(reopened.read('dataset-b')).toEqual({ compact: true, collapsed: [] });
});

it('retains navigation state when browser storage is blocked', () => {
  const disk = storage();
  disk.getItem.mockImplementation(() => { throw new Error('blocked'); });
  disk.setItem.mockImplementation(() => { throw new Error('quota'); });
  const store = createTypeListViewStore(disk);
  store.write('a', { compact: false, collapsed: ['root'] });
  expect(store.read('a')).toEqual({ compact: false, collapsed: ['root'] });
});

it('ignores malformed saved state and bounds retained datasets', () => {
  const disk = storage();
  disk.setItem('', '{broken');
  const store = createTypeListViewStore(disk);
  expect(store.read('a')).toEqual({ compact: true, collapsed: [] });
  for (let i = 0; i < 110; i += 1) store.write(String(i), { compact: false, collapsed: [] });
  const reopened = createTypeListViewStore(disk);
  expect(reopened.read('0').compact).toBe(true);
  expect(reopened.read('109').compact).toBe(false);
});
