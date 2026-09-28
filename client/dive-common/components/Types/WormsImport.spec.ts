import { defineComponent, h, nextTick } from 'vue';
import { shallowMount } from '@vue/test-utils';
import { WormsRecord } from '../../worms';
import WormsImport from './WormsImport.vue';

const api = vi.hoisted(() => ({ search: vi.fn(), children: vi.fn(), prepare: vi.fn() }));
vi.mock('../../worms', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../worms')>(),
  WormsClient: class {
    search = api.search;

    children = api.children;

    prepare = api.prepare;
  },
}));
const taxon = (id: number): WormsRecord => ({
  AphiaID: id,
  scientificname: `taxon ${id}`,
  rank: 'Species',
  status: 'accepted',
  valid_AphiaID: id,
  valid_name: `taxon ${id}`,
});
function mountImport() {
  let vm: InstanceType<typeof WormsImport> | undefined;
  const prepared = vi.fn();
  const Host = defineComponent({
    setup: () => () => h(WormsImport, {
      on: { prepared },
      ref: (instance) => { vm = instance as InstanceType<typeof WormsImport>; },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { WormsImport: false } });
  if (!vm) throw new Error('WoRMS import did not mount.');
  return { vm, wrapper, prepared };
}

describe('WoRMS import selection and request lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.search.mockResolvedValue([taxon(1), taxon(2)]);
    api.children.mockResolvedValue([taxon(3)]);
    api.prepare.mockResolvedValue({ types: ['taxon 1'], warnings: [] });
  });

  it('keeps selections across pages and navigates children back to the original search', async () => {
    const { vm, wrapper } = mountImport();
    vm.query = 'taxon';
    await vm.search();
    vm.selectPage();
    expect(vm.selected).toHaveLength(2);
    api.search.mockResolvedValue([taxon(4)]);
    await vm.loadPage(51);
    vm.selectPage();
    expect(vm.selected.map((row) => row.AphiaID)).toEqual([1, 2, 4]);
    expect(api.search).toHaveBeenLastCalledWith('taxon', 51, expect.any(AbortSignal));
    await vm.browse(taxon(2));
    expect(api.children).toHaveBeenCalledWith(2, 1, expect.any(AbortSignal));
    await vm.back();
    expect(vm.currentParent).toBeUndefined();
    expect(api.search).toHaveBeenLastCalledWith('taxon', 1, expect.any(AbortSignal));
    wrapper.destroy();
  });

  it('prepares the selected taxa and invalidates the preview when selection changes', async () => {
    const { vm, wrapper, prepared } = mountImport();
    vm.toggle(taxon(1));
    await vm.prepare();
    expect(api.prepare).toHaveBeenCalledWith([taxon(1)], true, expect.any(AbortSignal), expect.any(Function));
    expect(prepared).toHaveBeenLastCalledWith({ types: ['taxon 1'], warnings: [] });
    vm.toggle(taxon(2));
    expect(prepared).toHaveBeenLastCalledWith(null);
    vm.clearSelection();
    expect(vm.selected).toEqual([]);
    wrapper.destroy();
  });

  it('ignores out-of-order searches and aborts on unmount', async () => {
    let finish: (records: WormsRecord[]) => void = () => {};
    api.search.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const { vm, wrapper } = mountImport();
    vm.query = 'old';
    const first = vm.search();
    const firstSignal = api.search.mock.calls[0][2] as AbortSignal;
    vm.query = 'new';
    await vm.search();
    expect(firstSignal.aborted).toBe(true);
    finish([taxon(99)]);
    await first;
    expect(vm.results.map((row) => row.AphiaID)).toEqual([1, 2]);
    const latestSignal = api.search.mock.calls[1][2] as AbortSignal;
    wrapper.destroy();
    expect(latestSignal.aborted).toBe(true);
  });

  it('does not publish a prepared import after cancellation', async () => {
    let finish: (result: unknown) => void = () => {};
    api.prepare.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const { vm, wrapper, prepared } = mountImport();
    vm.toggle(taxon(1));
    const pending = vm.prepare();
    vm.cancel();
    finish({ types: ['stale'], warnings: [] });
    await pending;
    expect(prepared).toHaveBeenLastCalledWith(null);
    expect(vm.busy).toBe(false);
    wrapper.destroy();
  });

  it('shows recoverable network errors and keeps Add disabled until preparation succeeds', async () => {
    const { vm, wrapper, prepared } = mountImport();
    api.search.mockRejectedValueOnce(new Error('offline'));
    vm.query = 'taxon';
    await vm.search();
    expect(vm.error).toBe('offline');
    await vm.search();
    expect(vm.error).toBe('');
    vm.toggle(taxon(1));
    api.prepare.mockRejectedValueOnce(new Error('classification unavailable'));
    await vm.prepare();
    expect(vm.error).toBe('classification unavailable');
    expect(prepared).toHaveBeenLastCalledWith(null);
    await vm.prepare();
    expect(prepared).toHaveBeenLastCalledWith({ types: ['taxon 1'], warnings: [] });
    await nextTick();
    wrapper.destroy();
  });
});
