import {
  defineComponent, h, nextTick, ref, shallowReactive,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import { TypeHierarchyError } from 'dive-common/typeHierarchy';
import BaseFilterControls from '../BaseFilterControls';
import TrackFilterControls from '../TrackFilterControls';
import TypeEditor from './TypeEditor.vue';

const promptMock = vi.hoisted(() => vi.fn());
const provideMocks = vi.hoisted(() => ({ readOnly: false }));

vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: promptMock }),
}));

vi.mock('../provides', () => ({
  useReadOnlyMode: () => ref(provideMocks.readOnly),
}));

function makeFilters({
  allTypes = ['leaf', 'root'],
  hierarchy = { leaf: 'root' } as Record<string, string> | undefined,
} = {}) {
  const filters = Object.create(TrackFilterControls.prototype) as TrackFilterControls;
  filters.allTypes = ref(allTypes);
  filters.usedTypes = ref([]);
  filters.typeHierarchy = ref(hierarchy);
  filters.typeInUseOnAnyCamera = vi.fn(() => false);
  filters.validateTypeDefinition = vi.fn(() => undefined);
  filters.updateTypeDefinition = vi.fn();
  filters.updateTypeName = vi.fn();
  filters.importTypes = vi.fn();
  filters.deleteType = vi.fn(() => true);
  return filters;
}

function makeGroupFilters() {
  const filters = Object.create(BaseFilterControls.prototype) as BaseFilterControls<never>;
  filters.usedTypes = ref([]);
  filters.updateTypeName = vi.fn();
  filters.deleteType = vi.fn(() => true);
  return filters;
}

function makeStyleManager() {
  return Object.freeze({
    typeStyling: ref({
      color: (type: string) => `color:${type}`,
      strokeWidth: () => 3,
      fill: () => false,
      opacity: () => 0.8,
      labelSettings: () => ({ showLabel: true, showConfidence: true }),
    }),
    updateTypeStyle: vi.fn(),
    renameTypeStyle: vi.fn(),
    deleteTypeStyle: vi.fn(),
  });
}

interface MountOptions {
  selectedType?: string;
  filters?: BaseFilterControls<never> | TrackFilterControls | null;
  styleManager?: ReturnType<typeof makeStyleManager>;
  group?: boolean;
  styleOnly?: boolean;
}

/**
 * `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
 * SFC is not, so the editor is rendered from a host that captures the real instance and its
 * emitted events. It is left unstubbed to keep shallow semantics for its own children.
 */
function mountEditor({
  selectedType = 'leaf',
  filters = makeFilters(),
  styleManager = makeStyleManager(),
  group = false,
  styleOnly = false,
}: MountOptions = {}) {
  const closeEvents: unknown[] = [];
  const filterControls = filters ?? undefined;
  const props = shallowReactive({
    selectedType,
    filterControls,
    styleManager,
    group,
    styleOnly,
  });
  let child: InstanceType<typeof TypeEditor> | undefined;
  const Host = defineComponent({
    setup: () => () => h(TypeEditor, {
      props,
      on: { close: () => closeEvents.push([]) },
      ref: (instance) => {
        if (instance && !(instance instanceof Element)) {
          child = instance as InstanceType<typeof TypeEditor>;
        }
      },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { TypeEditor: false } });
  if (!child) {
    throw new Error('TypeEditor did not mount');
  }
  const setProps = async (next: Partial<typeof props>) => {
    Object.assign(props, next);
    await nextTick();
  };
  return {
    filters: filterControls as TrackFilterControls,
    styleManager,
    wrapper,
    vm: child,
    closeEvents,
    setProps,
  };
}

describe('TypeEditor hierarchy editing', () => {
  beforeEach(() => {
    promptMock.mockReset();
    provideMocks.readOnly = false;
  });

  it('shows Parent Type only for dataset track types and initializes its parent', () => {
    const track = mountEditor();
    expect(track.vm.showParentType).toBe(true);
    expect(track.vm.data.editingParent).toBe('root');
    const autocomplete = track.wrapper.find('v-autocomplete');
    expect(autocomplete.exists()).toBe(true);
    expect(autocomplete.attributes('auto-select-first')).toBe('');
    expect(autocomplete.attributes('no-filter')).toBe('');
    expect(autocomplete.attributes('no-data-text')).toBe(
      'No matching type. Add it from Type Settings first.',
    );
    expect(track.wrapper.find('v-text-field').attributes('hide-details')).toBe('auto');

    const group = mountEditor({ filters: makeGroupFilters(), group: true });
    expect(group.vm.showParentType).toBe(false);
    expect(group.wrapper.find('v-autocomplete').exists()).toBe(false);

    const savedStyle = mountEditor({ filters: null, styleOnly: true });
    expect(savedStyle.vm.showParentType).toBe(false);
    expect(savedStyle.wrapper.find('v-autocomplete').exists()).toBe(false);
  });

  it('bounds empty-query choices with the selected parent first', () => {
    const names = [
      'leaf',
      'current',
      ...Array.from({ length: 100 }, (_, i) => `type${i.toString().padStart(3, '0')}`),
    ];
    const { vm } = mountEditor({
      filters: makeFilters({ allTypes: names, hierarchy: { leaf: 'current' } }),
    });
    expect(vm.parentOptions).toHaveLength(50);
    expect(vm.parentOptions[0]).toBe('current');
    expect(vm.parentOptions.slice(1)).toEqual([...vm.parentOptions.slice(1)].sort());
  });

  it('orders prefix matches before substring matches and excludes old and final names', async () => {
    const { vm } = mountEditor({
      filters: makeFilters({
        allTypes: ['leaf', 'fin', 'current', 'alpine', 'alpha', 'coral'],
        hierarchy: { leaf: 'current' },
      }),
    });
    vm.data.editingType = 'fin';
    vm.data.parentSearch = 'al';
    await nextTick();
    expect(vm.parentOptions).toEqual(['current', 'alpha', 'alpine', 'coral']);
    expect(vm.parentOptions).not.toContain('leaf');
    expect(vm.parentOptions).not.toContain('fin');
  });

  it('sorts parent choices by Unicode code point', () => {
    const privateUse = '\uE000';
    const astral = '\u{10000}';
    const { vm } = mountEditor({
      filters: makeFilters({
        allTypes: ['leaf', 'current', astral, privateUse],
        hierarchy: { leaf: 'current' },
      }),
    });
    expect(vm.parentOptions).toEqual(['current', privateUse, astral]);
  });

  it('does not save free text that was not selected', () => {
    const {
      filters, styleManager, vm, closeEvents,
    } = mountEditor();
    vm.data.parentSearch = 'not an existing type';
    vm.acceptChanges();
    expect(vm.parentSearchUnresolved).toBe(true);
    expect(filters.updateTypeDefinition).not.toHaveBeenCalled();
    expect(styleManager.updateTypeStyle).not.toHaveBeenCalled();
    expect(closeEvents).toHaveLength(0);
  });

  it('shows every known preflight restriction inline and disables Save', async () => {
    const parent = mountEditor();
    vi.mocked(parent.filters.validateTypeDefinition).mockReturnValue({
      field: 'parent',
      reason: 'cycle leaf -> branch -> leaf',
    });
    parent.vm.data.editingParent = 'branch';
    parent.vm.data.parentSearch = 'branch';
    await nextTick();
    expect(parent.vm.parentDefinitionError).toBe(
      'Type hierarchy is invalid: cycle leaf -> branch -> leaf.',
    );
    expect(parent.wrapper.find('v-autocomplete').attributes('error-messages')).toBe(
      'Type hierarchy is invalid: cycle leaf -> branch -> leaf.',
    );
    expect(parent.vm.saveDisabled).toBe(true);
    parent.vm.acceptChanges();
    expect(parent.filters.updateTypeDefinition).not.toHaveBeenCalled();

    const name = mountEditor();
    vi.mocked(name.filters.validateTypeDefinition).mockReturnValue({
      field: 'name',
      reason: 'track 4 already contains both "leaf" and "root"',
    });
    name.vm.data.editingType = 'root';
    await nextTick();
    expect(name.vm.nameDefinitionError).toBe(
      'Type hierarchy is invalid: track 4 already contains both "leaf" and "root".',
    );
    expect(name.wrapper.find('v-text-field').attributes('error-messages')).toBe(
      'Type hierarchy is invalid: track 4 already contains both "leaf" and "root".',
    );
    expect(name.vm.saveDisabled).toBe(true);

    const unresolved = mountEditor();
    unresolved.vm.data.parentSearch = 'missing';
    await nextTick();
    expect(unresolved.vm.parentDefinitionError).toBe(
      'Select an existing type from the list, or clear the field.',
    );
    expect(unresolved.vm.saveDisabled).toBe(true);
  });

  it('saves name and parent through one atomic operation', () => {
    const { filters, vm, closeEvents } = mountEditor();
    vm.data.editingType = 'fin';
    vm.data.editingParent = 'branch';
    vm.data.parentSearch = 'branch';
    vm.acceptChanges();
    expect(filters.updateTypeDefinition).toHaveBeenCalledTimes(1);
    expect(filters.updateTypeDefinition).toHaveBeenCalledWith({
      currentType: 'leaf', newType: 'fin', parent: 'branch',
    });
    expect(closeEvents).toHaveLength(1);
  });

  it('applies first-edge creation and final-edge clearing through the same operation', () => {
    const first = mountEditor({
      filters: makeFilters({ allTypes: ['leaf', 'root'], hierarchy: undefined }),
    });
    first.vm.data.editingParent = 'root';
    first.vm.data.parentSearch = 'root';
    first.vm.acceptChanges();
    expect(first.filters.updateTypeDefinition).toHaveBeenCalledWith({
      currentType: 'leaf', newType: 'leaf', parent: 'root',
    });

    const final = mountEditor();
    final.vm.data.editingParent = null;
    final.vm.data.parentSearch = null;
    final.vm.acceptChanges();
    expect(final.filters.updateTypeDefinition).toHaveBeenCalledWith({
      currentType: 'leaf', newType: 'leaf', parent: undefined,
    });
  });

  it('keeps all style changes staged when hierarchy preflight fails', () => {
    const {
      filters, styleManager, vm, closeEvents,
    } = mountEditor();
    vi.mocked(filters.updateTypeDefinition).mockImplementationOnce(() => {
      throw new TypeHierarchyError('self edge "root -> root"', 'conflict');
    });
    vm.data.editingType = 'root';
    vm.data.editingParent = 'root';
    vm.data.parentSearch = 'root';
    vm.data.editingColor = '#abcdef';
    vm.acceptChanges();
    expect(vm.data.definitionError).toBe(
      'Type hierarchy is invalid: self edge "root -> root". No type changes were applied.',
    );
    expect(filters.importTypes).not.toHaveBeenCalled();
    expect(styleManager.updateTypeStyle).not.toHaveBeenCalled();
    expect(closeEvents).toHaveLength(0);
  });

  it('preserves group and Saved Styles rename paths', () => {
    const groupFilters = makeGroupFilters();
    const group = mountEditor({ filters: groupFilters, group: true });
    group.vm.data.editingType = 'renamed-group';
    group.vm.acceptChanges();
    expect(groupFilters.updateTypeName).toHaveBeenCalledWith({
      currentType: 'leaf', newType: 'renamed-group',
    });

    const style = mountEditor({ filters: null, styleOnly: true });
    style.vm.data.editingType = 'renamed-style';
    style.vm.acceptChanges();
    expect(style.styleManager.renameTypeStyle).toHaveBeenCalledWith('leaf', 'renamed-style');
  });

  it('prompts truthfully when deleting hierarchy parents and leaves cancellation unchanged', async () => {
    const middle = mountEditor({
      selectedType: 'branch',
      filters: makeFilters({
        allTypes: ['root', 'branch', 'leaf'],
        hierarchy: { branch: 'root', leaf: 'branch' },
      }),
    });
    promptMock.mockResolvedValueOnce(false);
    await middle.vm.clickDeleteType('branch');
    expect(promptMock).toHaveBeenLastCalledWith({
      title: 'Confirm',
      text: 'Remove "branch" from the hierarchy? Its children will move under "root". Stored annotations will not be changed.',
      confirm: true,
    });
    expect(middle.filters.deleteType).not.toHaveBeenCalled();

    const root = mountEditor({
      selectedType: 'root',
      filters: makeFilters({
        allTypes: ['root', 'leaf'], hierarchy: { leaf: 'root' },
      }),
    });
    promptMock.mockResolvedValueOnce(true);
    await root.vm.clickDeleteType('root');
    expect(promptMock).toHaveBeenLastCalledWith({
      title: 'Confirm',
      text: 'Remove "root" from the hierarchy? Its children will become top-level types. Stored annotations will not be changed.',
      confirm: true,
    });
    expect(root.filters.deleteType).toHaveBeenCalledWith('root');

    const leaf = mountEditor();
    promptMock.mockResolvedValueOnce(true);
    await leaf.vm.clickDeleteType('leaf');
    expect(promptMock).toHaveBeenLastCalledWith({
      title: 'Confirm', text: 'Delete the unused type "leaf"?', confirm: true,
    });
  });

  it('does not finish an asynchronous deletion after the editor unmounts', async () => {
    let resolvePrompt: ((value: boolean) => void) | undefined;
    promptMock.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      resolvePrompt = resolve;
    }));
    const {
      filters, vm, wrapper, closeEvents,
    } = mountEditor();
    const deletion = vm.clickDeleteType('leaf');
    wrapper.destroy();
    if (!resolvePrompt) {
      throw new Error('Prompt resolver was not initialized');
    }
    resolvePrompt(true);
    await deletion;
    expect(filters.deleteType).not.toHaveBeenCalled();
    expect(closeEvents).toHaveLength(0);
  });

  it('blocks deletion for all-camera usage and disables both name fields in Read Only Mode', () => {
    provideMocks.readOnly = true;
    const filters = makeFilters();
    vi.mocked(filters.typeInUseOnAnyCamera).mockReturnValue(true);
    const { vm, wrapper } = mountEditor({ filters });
    expect(vm.deleteBlocked).toBe(true);
    expect(wrapper.text()).toContain('Only types without annotations can be deleted.');
    expect(wrapper.find('v-autocomplete').attributes('disabled')).toBe('true');
    expect(wrapper.find('v-text-field').attributes('disabled')).toBe('true');
  });

  it('reinitializes the complete draft when the selected type changes', async () => {
    const filters = makeFilters({
      allTypes: ['leaf', 'root', 'other', 'branch'],
      hierarchy: { leaf: 'root', other: 'branch' },
    });
    const { vm, setProps } = mountEditor({ filters });
    vm.data.editingParent = 'branch';
    vm.data.editingColor = '#abcdef';
    await setProps({ selectedType: 'other' });
    expect(vm.data.selectedType).toBe('other');
    expect(vm.data.editingType).toBe('other');
    expect(vm.data.editingParent).toBe('branch');
    expect(vm.data.parentSearch).toBe('branch');
    expect(vm.data.editingColor).toBe('color:other');
  });

  it('promotes a hierarchy-only heading only after a style value changes', () => {
    const unchanged = mountEditor();
    unchanged.vm.acceptChanges();
    expect(unchanged.filters.importTypes).not.toHaveBeenCalled();

    const changed = mountEditor();
    changed.vm.data.editingColor = '#abcdef';
    changed.vm.acceptChanges();
    expect(changed.filters.importTypes).toHaveBeenCalledWith(['leaf'], false);
  });
});
