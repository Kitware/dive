import { defineComponent, h, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import { TypeHierarchyError } from 'dive-common/typeHierarchy';
import TrackFilterControls from '../TrackFilterControls';
import TypeEditor from './TypeEditor.vue';

const promptMock = vi.hoisted(() => vi.fn());

vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: promptMock }),
}));

vi.mock('../provides', () => ({
  useReadOnlyMode: () => ref(false),
}));

function makeFilters() {
  const filters = Object.create(TrackFilterControls.prototype) as TrackFilterControls;
  filters.usedTypes = ref([]);
  filters.typeInUseOnAnyCamera = vi.fn(() => false);
  filters.updateTypeName = vi.fn();
  filters.importTypes = vi.fn();
  filters.deleteType = vi.fn(() => true);
  return filters;
}

function makeStyleManager() {
  return Object.freeze({
    typeStyling: ref({
      color: () => '#123456',
      strokeWidth: () => 3,
      fill: () => false,
      opacity: () => 0.8,
      labelSettings: () => ({ showLabel: true, showConfidence: true }),
    }),
    updateTypeStyle: vi.fn(),
  });
}

/**
 * `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
 * SFC is not, so the editor is rendered from a host that captures the real instance and its
 * emitted events. It is left unstubbed to keep shallow semantics for its own children.
 */
function mountEditor(filters = makeFilters(), styleManager = makeStyleManager()) {
  const closeEvents: unknown[] = [];
  let child: InstanceType<typeof TypeEditor> | undefined;
  const Host = defineComponent({
    setup: () => () => h(TypeEditor, {
      props: {
        selectedType: 'leaf',
        filterControls: filters,
        styleManager,
      },
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
  return {
    filters, styleManager, wrapper, vm: child, closeEvents,
  };
}

describe('TypeEditor hierarchy safety', () => {
  beforeEach(() => promptMock.mockReset());

  it('allows clearing settings for an unused hierarchy parent', async () => {
    const filters = makeFilters();
    promptMock.mockResolvedValue(true);
    const { vm } = mountEditor(filters);
    await vm.clickDeleteType('leaf');
    expect(promptMock).toHaveBeenCalled();
    expect(filters.deleteType).toHaveBeenCalledWith('leaf');
  });

  it('disables deletion for a type used only by a camera the merged view hides', () => {
    const filters = makeFilters();
    vi.mocked(filters.typeInUseOnAnyCamera).mockReturnValue(true);
    const { vm, wrapper } = mountEditor(filters);
    expect(vm.deleteBlocked).toBe(true);
    expect(wrapper.text()).toContain('Only types without any annotations can be deleted.');
  });

  it('leaves an unused leaf unchanged when deletion is canceled', async () => {
    promptMock.mockResolvedValue(false);
    const { filters, vm, closeEvents } = mountEditor();
    await vm.clickDeleteType('leaf');
    expect(promptMock).toHaveBeenCalledTimes(1);
    expect(filters.deleteType).not.toHaveBeenCalled();
    expect(closeEvents).toHaveLength(0);
  });

  it('keeps the editor open for a rejected rename and allows a corrected retry', () => {
    const {
      filters, styleManager, vm, closeEvents,
    } = mountEditor();
    vi.mocked(filters.updateTypeName).mockImplementationOnce(() => {
      throw new TypeHierarchyError('self edge "root -> root"', 'conflict');
    });
    vm.data.editingType = 'root';
    vm.acceptChanges();
    expect(vm.data.renameError).toBe(
      'Type hierarchy is invalid: self edge "root -> root". No types were changed.',
    );
    expect(styleManager.updateTypeStyle).not.toHaveBeenCalled();
    expect(closeEvents).toHaveLength(0);

    vm.data.editingType = 'fin';
    vm.acceptChanges();
    expect(vm.data.renameError).toBe('');
    expect(filters.updateTypeName).toHaveBeenLastCalledWith({
      currentType: 'leaf', newType: 'fin',
    });
    expect(closeEvents).toHaveLength(1);
  });

  it('promotes a hierarchy-only heading only after a style value changes', () => {
    const { filters, vm } = mountEditor();
    vm.acceptChanges();
    expect(filters.importTypes).not.toHaveBeenCalled();

    const changed = mountEditor();
    changed.vm.data.editingColor = '#abcdef';
    changed.vm.acceptChanges();
    expect(changed.filters.importTypes).toHaveBeenCalledWith(['leaf'], false);
  });
});
