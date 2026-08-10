// @vitest-environment jsdom
/// <reference types="vitest" />
import {
  defineComponent, h, nextTick, ref, reactive,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import { clientSettings } from 'dive-common/store/settings';
import FilterList from './FilterList.vue';

vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: vi.fn(), visible: () => false }),
}));

/**
 * `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
 * SFC is not, so the list is rendered from a host that captures the real instance. It is left
 * unstubbed to keep shallow semantics for its own children, and the host stands in for
 * `setProps`.
 */
function mountFilterList(props: Record<string, unknown>) {
  const state = reactive(props);
  let child: InstanceType<typeof FilterList> | undefined;
  const Host = defineComponent({
    setup: () => () => h(FilterList, {
      props: state,
      ref: (instance) => {
        if (instance && !(instance instanceof Element)) {
          child = instance as InstanceType<typeof FilterList>;
        }
      },
    }),
  });
  const wrapper = shallowMount(Host, { stubs: { FilterList: false } });
  if (!child) {
    throw new Error('FilterList did not mount');
  }
  const setProps = async (next: Record<string, unknown>) => {
    Object.assign(state, next);
    await nextTick();
  };
  return { wrapper, vm: child, setProps };
}

vi.mock('../provides', () => ({
  useCameraStore: () => ({
    camMap: ref(new Map([['singleCam', {
      trackStore: {
        annotationMap: new Map(),
        intervalTree: { search: () => [] },
        getPossible: () => undefined,
      },
    }]])),
    getAnyPossibleTrack: () => undefined,
  }),
  useHandler: () => ({ seekFrame: vi.fn() }),
  useReadOnlyMode: () => ref(false),
  useSelectedCamera: () => ref('singleCam'),
  useTime: () => ({ frame: ref(0) }),
  usePendingSaveCount: () => ref(0),
}));

describe('FilterList hierarchy members', () => {
  it('keeps members as ordinary, independently checked flat rows', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = '';
    const checkedTypes = ref(['leaf', 'heading']);
    const filterControls = Object.freeze({
      allTypes: ref(['leaf', 'heading']),
      usedTypes: ref(['leaf']),
      checkedTypes,
      filteredAnnotations: ref([]),
      confidenceFilters: ref({ default: 0.1 }),
      disableAnnotationFilters: ref(false),
      updateCheckedTypes: (types: string[]) => { checkedTypes.value = types; },
      removeTypeAnnotations: vi.fn(),
    });
    const styleManager = Object.freeze({
      typeStyling: ref({
        color: () => '#fff',
        strokeWidth: () => 1,
        fill: () => false,
        opacity: () => 1,
      }),
    });
    const { vm, setProps } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });
    expect(vm.visibleTypes).toEqual(['leaf']);
    expect(vm.virtualHeight).toBe(160);

    await setProps({ showEmptyTypes: true });
    expect(vm.visibleTypes).toEqual(['heading', 'leaf']);
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['heading', 'leaf']);
    vm.updateCheckedType(false, 'heading');
    expect(checkedTypes.value).toEqual(['leaf']);
    expect(vm.virtualTypes.find(({ type }) => type === 'heading')?.checked).toBe(false);
  });

  it('counts the type selected by each filtered annotation context', () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = '';
    const confidencePairs: [string, number][] = [['root', 0.9], ['leaf', 0.7]];
    const filterControls = Object.freeze({
      allTypes: ref(['root', 'leaf']),
      usedTypes: ref(['root', 'leaf']),
      checkedTypes: ref(['root', 'leaf']),
      filteredAnnotations: ref([{
        annotation: {
          id: 1,
          begin: 0,
          end: 1,
          confidencePairs,
          getType: (index = 0) => confidencePairs[index][0],
        },
        context: { confidencePairIndex: 1 },
      }]),
      confidenceFilters: ref({ default: 0.1 }),
      disableAnnotationFilters: ref(false),
      updateCheckedTypes: vi.fn(),
      removeTypeAnnotations: vi.fn(),
    });
    const styleManager = Object.freeze({
      typeStyling: ref({
        color: (type: string) => `color:${type}`,
        strokeWidth: () => 1,
        fill: () => false,
        opacity: () => 1,
      }),
    });
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: true,
      height: 240,
      headerHeight: 80,
    });

    expect(vm.virtualTypes.find(({ type }) => type === 'leaf')).toEqual(expect.objectContaining({
      displayText: '1 : 0\u00A0 leaf',
      color: 'color:leaf',
    }));
    expect(vm.virtualTypes.find(({ type }) => type === 'root')?.displayText)
      .toBe('0 : 0\u00A0 root');
  });
});
