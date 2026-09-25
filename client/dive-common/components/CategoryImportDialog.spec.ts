import {
  defineComponent, h, ref, nextTick,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import { clientSettings } from 'dive-common/store/settings';
import CategoryImportDialog from './CategoryImportDialog.vue';

const mocks = vi.hoisted(() => ({ apply: vi.fn(), readOnly: false }));
vi.mock('vue-media-annotator/provides', () => ({
  useReadOnlyMode: () => ref(mocks.readOnly),
  useTrackFilters: () => ({
    typeHierarchy: ref({ fish: 'animal' }),
    importCategoryDefinitions: mocks.apply,
  }),
}));

function mountDialog() {
  let vm: InstanceType<typeof CategoryImportDialog> | undefined;
  const close = vi.fn();
  const Host = defineComponent({
    setup: () => () => h(CategoryImportDialog, {
      on: { close },
      ref: (instance) => { vm = instance as InstanceType<typeof CategoryImportDialog>; },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { CategoryImportDialog: false } });
  if (!vm) throw new Error('Dialog did not mount.');
  return { vm, wrapper, close };
}

function file(name: string, contents: string): File {
  return { name, text: async () => contents } as File;
}

describe('category import dialog shared by web and desktop', () => {
  beforeEach(() => {
    mocks.apply.mockReset();
    mocks.readOnly = false;
    clientSettings.typeSettings.showEmptyTypes = false;
    clientSettings.typeSettings.filterTypesByFrame = true;
  });

  it('previews file hierarchy and applies it only on Add', async () => {
    const { vm, wrapper, close } = mountDialog();
    await vm.selectFile(file('coco.json', '{"categories":[{"name":"shark","supercategory":"fish"}]}'));
    expect(vm.preview.names).toEqual(['shark', 'fish']);
    expect(vm.canImport).toBe(true);
    expect(mocks.apply).not.toHaveBeenCalled();
    vm.confirmImport();
    expect(mocks.apply).toHaveBeenCalledWith(['shark'], { shark: 'fish' }, undefined);
    expect(close).toHaveBeenCalledOnce();
    wrapper.destroy();
  });

  it('stages WoRMS on the file page without applying until the second Add', async () => {
    const { vm, wrapper } = mountDialog();
    vm.source = 'worms';
    await nextTick();
    const taxonomySources = { 3: { aphiaId: 3, scientificName: 'shark', rank: 'Species' } };
    vm.setWormsImport({
      types: ['shark'], typeHierarchy: { shark: 'fish' }, taxonomySources, warnings: [],
    });
    expect(vm.source).toBe('file');
    expect(vm.pastedTypes).toBe('shark');
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(clientSettings.typeSettings.showEmptyTypes).toBe(false);
    await nextTick();
    expect(vm.canImport).toBe(true);
    expect(wrapper.text()).toContain('fish → shark');
    expect(wrapper.text()).not.toContain('shark → fish');
    vm.confirmImport();
    expect(mocks.apply).toHaveBeenCalledWith(['shark'], { shark: 'fish' }, taxonomySources);
    expect(clientSettings.typeSettings.showEmptyTypes).toBe(true);
    expect(clientSettings.typeSettings.filterTypesByFrame).toBe(false);
    vm.source = 'file';
    await nextTick();
    vm.source = 'worms';
    await nextTick();
    expect(vm.canImport).toBe(false);
    wrapper.destroy();
  });

  it('summarizes WoRMS synonym remaps and expands grouped details on demand', async () => {
    const { vm, wrapper } = mountDialog();
    vm.source = 'worms';
    await nextTick();
    vm.setWormsImport({
      types: ['salmon', 'trout'],
      warnings: ['"Seriola gigas" resolves to multiple accepted names: "Seriola dumerili", "Seriola hippos".'],
      synonymRemaps: [
        { original: 'old salmon', accepted: 'salmon' },
        { original: 'Salmo old', accepted: 'salmon' },
        { original: 'old trout', accepted: 'trout' },
      ],
    });
    await nextTick();
    expect(wrapper.text()).toContain('3 synonyms will be imported as 2 accepted names.');
    expect(wrapper.text()).toContain('Show details');
    expect(wrapper.text()).not.toContain('salmon ←');
    expect(wrapper.text()).toContain('resolves to multiple accepted names');
    vm.showSynonymDetails = true;
    await nextTick();
    expect(wrapper.text()).toContain('salmon ← old salmon, Salmo old');
    expect(wrapper.text()).toContain('trout ← old trout');
    expect(wrapper.text()).toContain('Hide details');
    wrapper.destroy();
  });

  it('merges staged WoRMS taxa with a pending file and survives tab changes', async () => {
    const { vm, wrapper } = mountDialog();
    await vm.selectFile(file('categories.json', '{"typeHierarchy":{"salmon":"fish"}}'));
    vm.source = 'worms';
    await nextTick();
    vm.setWormsImport({ types: ['shark'], typeHierarchy: { shark: 'fish' }, warnings: [] });
    await nextTick();
    expect(vm.preview.incoming?.typeHierarchy).toEqual({ salmon: 'fish', shark: 'fish' });
    expect(vm.preview.names).toEqual(expect.arrayContaining(['salmon', 'fish', 'shark']));
    vm.source = 'worms';
    await nextTick();
    expect(vm.canImport).toBe(false);
    vm.source = 'file';
    await nextTick();
    expect(vm.canImport).toBe(true);
    expect(vm.preview.incoming?.typeHierarchy).toEqual({ salmon: 'fish', shark: 'fish' });
    expect(mocks.apply).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it('does not replace pending categories when a WoRMS hierarchy conflicts', async () => {
    const { vm, wrapper } = mountDialog();
    await vm.selectFile(file('categories.json', '{"typeHierarchy":{"shark":"fish"}}'));
    vm.source = 'worms';
    await nextTick();
    vm.setWormsImport({ types: ['shark'], typeHierarchy: { shark: 'other' }, warnings: [] });
    expect(vm.errorMessage).toContain('conflicting parents');
    expect(vm.source).toBe('worms');
    expect(vm.preview.incoming?.typeHierarchy).toEqual({ shark: 'fish' });
    expect(mocks.apply).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it('retains pasted names with spaces and trims blank or repeated lines', () => {
    const { vm, wrapper } = mountDialog();
    vm.pastedTypes = ' red fish \r\n\nred fish\nshark';
    vm.confirmImport();
    expect(mocks.apply).toHaveBeenCalledWith(['red fish', 'shark'], undefined, undefined);
    wrapper.destroy();
  });

  it('prevents conflicting hierarchy imports and permits correction', async () => {
    const { vm, wrapper } = mountDialog();
    await vm.selectFile(file('labels.json', '{"typeHierarchy":{"fish":"other"}}'));
    expect(vm.errorMessage).toContain('conflicting parents');
    expect(vm.canImport).toBe(false);
    vm.confirmImport();
    expect(mocks.apply).not.toHaveBeenCalled();
    await vm.selectFile(file('labels.txt', 'shark'));
    expect(vm.canImport).toBe(true);
    wrapper.destroy();
  });

  it('shows parse and read errors without applying any types', async () => {
    const { vm, wrapper } = mountDialog();
    await vm.selectFile(file('labels.json', '{'));
    expect(vm.errorMessage).toBeTruthy();
    expect(vm.canImport).toBe(false);
    await vm.selectFile(Object.assign(new File([], 'labels.txt'), { text: async () => { throw new Error('Read failed'); } }));
    expect(vm.errorMessage).toBe('Read failed');
    expect(mocks.apply).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it('ignores stale reads after clearing or replacing a file', async () => {
    const { vm, wrapper } = mountDialog();
    let finish: (value: string) => void = () => {};
    const pending = vm.selectFile({
      name: 'slow.txt', text: () => new Promise<string>((resolve) => { finish = resolve; }),
    } as File);
    expect(vm.canImport).toBe(false);
    await vm.selectFile(file('new.txt', 'shark'));
    finish('old');
    await pending;
    expect(vm.preview.names).toEqual(['shark']);
    await vm.selectFile(null);
    expect(vm.canImport).toBe(false);
    wrapper.destroy();
  });

  it('blocks imports in read-only mode', async () => {
    mocks.readOnly = true;
    const { vm, wrapper } = mountDialog();
    await vm.selectFile(file('labels.txt', 'shark'));
    vm.confirmImport();
    expect(vm.canImport).toBe(false);
    expect(mocks.apply).not.toHaveBeenCalled();
    wrapper.destroy();
  });

  it('keeps the dialog open when applying fails', async () => {
    const { vm, wrapper, close } = mountDialog();
    await vm.selectFile(file('labels.txt', 'shark'));
    mocks.apply.mockImplementation(() => { throw new Error('Changed hierarchy'); });
    vm.confirmImport();
    expect(vm.errorMessage).toBe('Changed hierarchy');
    expect(close).not.toHaveBeenCalled();
    wrapper.destroy();
  });
});
