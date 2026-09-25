import {
  defineComponent, h, ref, nextTick,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
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

  it('switches to WoRMS imports and passes source records to the atomic import', async () => {
    const { vm, wrapper } = mountDialog();
    vm.source = 'worms';
    await nextTick();
    const taxonomySources = { 3: { aphiaId: 3, scientificName: 'shark', rank: 'Species' } };
    vm.setWormsImport({
      types: ['shark'], typeHierarchy: { shark: 'fish' }, taxonomySources, warnings: [],
    });
    expect(vm.canImport).toBe(true);
    vm.confirmImport();
    expect(mocks.apply).toHaveBeenCalledWith(['shark'], { shark: 'fish' }, taxonomySources);
    vm.source = 'file';
    await nextTick();
    vm.source = 'worms';
    await nextTick();
    expect(vm.canImport).toBe(false);
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
