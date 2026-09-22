/* eslint-disable vue/one-component-per-file -- harness components for shallow mounting */
import {
  defineComponent, h, reactive, ref,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import { clientSettings } from 'dive-common/store/settings';
import FilterList from 'vue-media-annotator/components/FilterList.vue';
import GroupSidebar from './GroupSidebar.vue';

const provideMocks = vi.hoisted(() => ({
  groupFilterControls: undefined as unknown,
  groupStyleManager: undefined as unknown,
}));

vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: vi.fn(), visible: () => false }),
}));

vi.mock('vue-media-annotator/provides', () => ({
  useCameraStore: () => ({ camMap: ref(new Map()) }),
  useGroupFilterControls: () => provideMocks.groupFilterControls,
  useGroupStyleManager: () => provideMocks.groupStyleManager,
  useHandler: () => ({ seekFrame: vi.fn() }),
  usePendingSaveCount: () => ref(0),
  useReadOnlyMode: () => ref(false),
  useSelectedCamera: () => ref(''),
  useTime: () => ({ frame: ref(0) }),
}));

describe('GroupSidebar type filter', () => {
  it('wires the group FilterList to flat show-empty behavior', () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = '';
    const checkedTypes = ref(['school', 'pod']);
    provideMocks.groupFilterControls = Object.freeze({
      allTypes: ref(['school', 'pod']),
      usedTypes: ref(['school']),
      configuredTypes: ref(['pod']),
      checkedTypes,
      filteredAnnotations: ref([]),
      confidenceFilters: ref({ default: 0 }),
      disableAnnotationFilters: ref(false),
      updateCheckedTypes: (types: string[]) => { checkedTypes.value = types; },
      removeTypeAnnotations: vi.fn(),
    });
    provideMocks.groupStyleManager = Object.freeze({
      typeStyling: ref({
        color: () => '#fff',
        strokeWidth: () => 1,
        fill: () => false,
        opacity: () => 1,
      }),
    });

    const ContainerStub = defineComponent({
      setup: (_props, { slots }) => () => h(
        'div',
        slots.default?.({ topHeight: 240, bottomHeight: 120 }),
      ),
    });
    const props = reactive({ width: 320 });
    const Host = defineComponent({
      setup: () => () => h(GroupSidebar, { props }),
    });
    const wrapper = shallowMount(Host, {
      stubs: {
        GroupSidebar: false,
        FilterList: false,
        StackedVirtualSidebarContainer: ContainerStub,
        'v-divider': true,
      },
    });
    const filterList = wrapper.findComponent(FilterList);

    expect(filterList.exists()).toBe(true);
    expect(filterList.props()).toEqual(expect.objectContaining({
      filterControls: provideMocks.groupFilterControls,
      group: true,
      showEmptyTypes: true,
      width: 320,
    }));
  });
});
