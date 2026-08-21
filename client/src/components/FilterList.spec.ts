// @vitest-environment jsdom
/// <reference types="vitest" />
import {
  defineComponent, h, nextTick, ref, reactive,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import { clientSettings } from 'dive-common/store/settings';
import TrackFilterControls from '../TrackFilterControls';
import Track, { Feature } from '../track';
import BaseFilterControls from '../BaseFilterControls';
import Group from '../Group';
import CameraStore from '../CameraStore';
import FilterList from './FilterList.vue';

vi.mock('dive-common/vue-utilities/prompt-service', () => ({
  usePrompt: () => ({ prompt: vi.fn(), visible: () => false }),
}));

const provideMocks = vi.hoisted(() => ({
  seekFrame: vi.fn(),
  intervalSearch: vi.fn<(range: [number, number]) => string[]>(() => []),
  getPossible: vi.fn(),
  annotationMap: new Map<number, unknown>(),
  selectedCameraValue: 'singleCam',
  selectedCameraRef: undefined as { value: string } | undefined,
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
        annotationMap: provideMocks.annotationMap,
        intervalTree: { search: provideMocks.intervalSearch },
        getPossible: provideMocks.getPossible,
      },
    }]])),
  }),
  useHandler: () => ({ seekFrame: provideMocks.seekFrame }),
  useReadOnlyMode: () => ref(false),
  useSelectedCamera: () => {
    const selectedCamera = ref(provideMocks.selectedCameraValue);
    provideMocks.selectedCameraRef = selectedCamera;
    return selectedCamera;
  },
  useTime: () => ({ frame: ref(0) }),
  usePendingSaveCount: () => ref(0),
}));

function makeFilterListFixture({
  tracks,
  hierarchy = null,
  checkedTypes,
  confidenceFilters,
}: {
  tracks: Track[];
  hierarchy?: Record<string, string> | null;
  checkedTypes: string[];
  confidenceFilters?: Record<string, number>;
}) {
  const cameraStore = new CameraStore({ markChangesPending: vi.fn() });
  const trackStore = cameraStore.camMap.value.get('singleCam')?.trackStore;
  tracks.forEach((track) => trackStore?.insert(track));
  trackStore?.setEnableSorting();
  const filterControls = new TrackFilterControls({
    sorted: cameraStore.sortedTracks,
    remove: vi.fn(),
    markChangesPending: vi.fn(),
    removeTypes: vi.fn(() => []),
    lookupGroups: () => [],
    groupFilterControls: { enabledAnnotations: ref([]) } as unknown as BaseFilterControls<Group>,
    getTracks: (id) => tracks.filter((track) => track.id === id),
    renameTrackPair: vi.fn(() => []),
  });
  if (hierarchy) filterControls.setTypeHierarchy(hierarchy);
  filterControls.setConfidenceFilters(confidenceFilters);
  filterControls.updateCheckedTypes(checkedTypes);
  const updateCheckedTypes = vi.spyOn(filterControls, 'updateCheckedTypes');
  Object.freeze(filterControls);
  const styleManager = Object.freeze({
    customStyles: ref({}),
    typeStyling: ref({
      color: (type: string) => `color:${type}`,
      strokeWidth: () => 1,
      fill: () => false,
      opacity: () => 1,
    }),
  });
  return {
    checkedTypes: filterControls.checkedTypes,
    filterControls,
    styleManager,
    tracks,
    updateCheckedTypes,
  };
}

function makeHierarchyFixture(hierarchy: Record<string, string> = {
  leaf: 'branch', branch: 'root', sibling: 'root',
}) {
  return makeFilterListFixture({
    tracks: [new Track(1, {
      confidencePairs: [['leaf', 1]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    })],
    hierarchy,
    checkedTypes: ['leaf'],
    confidenceFilters: { root: 0.6, default: 0.1 },
  });
}

function featuresAt(frames: number[], suppressedFrames: readonly number[] = []) {
  const features: Feature[] = [];
  frames.forEach((frame) => {
    features[frame] = {
      frame,
      bounds: [0, 0, 1, 1],
      keyframe: true,
      attributes: suppressedFrames.includes(frame) ? { Suppressed: true } : undefined,
    };
  });
  return features;
}

function makeCountHierarchyFixture({
  tracks = [
    new Track(1, {
      confidencePairs: [['leaf', 1]],
      features: featuresAt([0, 5]),
    }),
    new Track(2, {
      confidencePairs: [['branch', 1]],
      features: featuresAt([5]),
    }),
    new Track(3, {
      confidencePairs: [['sibling', 1]],
      features: featuresAt([5]),
    }),
  ],
  hierarchy = { leaf: 'branch', branch: 'root', sibling: 'root' },
  checkedTypes = ['root', 'branch', 'leaf', 'sibling'],
}: {
  tracks?: Track[];
  hierarchy?: Record<string, string> | null;
  checkedTypes?: string[];
} = {}) {
  return makeFilterListFixture({ tracks, hierarchy, checkedTypes });
}

describe('FilterList hierarchy members', () => {
  beforeEach(() => {
    provideMocks.seekFrame.mockReset();
    provideMocks.intervalSearch.mockReset().mockReturnValue([]);
    provideMocks.getPossible.mockReset();
    provideMocks.annotationMap.clear();
    provideMocks.selectedCameraValue = 'singleCam';
    provideMocks.selectedCameraRef = undefined;
  });

  it('keeps members as ordinary, independently checked flat rows', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = '';
    const checkedTypes = ref(['leaf', 'heading']);
    const filterControls = Object.freeze({
      allTypes: ref(['leaf', 'heading']),
      usedTypes: ref(['leaf']),
      configuredTypes: ref(['heading']),
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
      group: false,
    });
    expect(vm.visibleTypes).toEqual(['leaf']);
    expect(vm.virtualHeight).toBe(160);

    await setProps({ showEmptyTypes: true });
    expect(vm.visibleTypes).toEqual(['heading', 'leaf']);
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['heading', 'leaf']);
    vm.updateCheckedType('heading');
    expect(checkedTypes.value).toEqual(['leaf']);
    expect(vm.virtualTypes.find(({ type }) => type === 'heading')?.checked).toBe(false);
    vm.updateCheckedType('heading');
    expect(checkedTypes.value).toEqual(['leaf', 'heading']);
  });

  it('counts the type selected by each filtered annotation context', () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = '';
    const confidencePairs: [string, number][] = [['root', 0.9], ['leaf', 0.7]];
    const filterControls = Object.freeze({
      allTypes: ref(['root', 'leaf']),
      usedTypes: ref(['root', 'leaf']),
      configuredTypes: ref([]),
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

  it('renders an expanded hierarchy with depth, tri-state, and structural parents', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = 'root';
    clientSettings.typeSettings.suppressionThreshold = 80;
    const { filterControls, styleManager } = makeHierarchyFixture();
    const { wrapper, vm, setProps } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
      group: false,
    });

    expect(vm.hierarchyActive).toBe(true);
    expect(vm.hierarchyHelpText).toBe(
      'Hierarchical types: DIVE displays the deepest checked stored type above its threshold. A parent that is not stored on a track is not used as a fallback. Parent counts include displayed descendants.',
    );
    expect(wrapper.find('v-virtual-scroll').attributes()).toEqual(expect.objectContaining({
      role: 'list',
      'aria-label': 'Track type hierarchy',
    }));
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root', 'branch', 'leaf']);
    expect(vm.virtualTypes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'root', depth: 0, hasChildren: true, expanded: true, indeterminate: true,
      }),
      expect.objectContaining({
        type: 'branch', depth: 1, hasChildren: true, expanded: true, indeterminate: true,
      }),
      expect.objectContaining({
        type: 'leaf', depth: 2, hasChildren: false, checked: true,
      }),
    ]));
    expect(vm.virtualTypes.find(({ type }) => type === 'root')).toEqual(expect.objectContaining({
      confidenceFilterNum: 0.6,
      color: 'color:root',
      isSuppressionType: true,
      suppressionThreshold: 80,
    }));

    await setProps({ showEmptyTypes: true });
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual([
      'root', 'branch', 'leaf', 'sibling',
    ]);

    await setProps({ group: true });
    expect(vm.hierarchyActive).toBe(false);
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual([
      'branch', 'leaf', 'root', 'sibling',
    ]);
    expect(vm.virtualTypes.every(({ tree }) => !tree)).toBe(true);
  });

  it('shows and recompacts a shared lineage without changing branch collapse state', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    const { filterControls, styleManager } = makeHierarchyFixture({
      leaf: 'branch',
      sibling: 'branch',
      branch: 'class',
      class: 'phylum',
      phylum: 'kingdom',
      kingdom: 'domain',
    });
    const { wrapper, vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    expect(vm.sharedLineage).toEqual(['domain', 'kingdom', 'phylum', 'class']);
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['branch', 'leaf']);
    expect(vm.virtualTypes[0].depth).toBe(0);
    expect(vm.virtualHeight).toBe(130);
    expect(wrapper.find('.shared-lineage-text').text()).toBe(
      'domain › kingdom › phylum › class',
    );
    expect(wrapper.find('.shared-lineage-text').classes()).toEqual(expect.arrayContaining([
      'text-body-2', 'grey--text', 'text--lighten-1',
    ]));
    expect(wrapper.find('.shared-lineage-action').text()).toBe('Expand Parents');

    await wrapper.find('.shared-lineage-action').trigger('click');
    expect(vm.compactSharedLineage).toBe(false);
    expect(wrapper.find('.shared-lineage-text').exists()).toBe(false);
    expect(wrapper.find('.shared-lineage-action').text()).toBe('Compact Parents');
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual([
      'domain', 'kingdom', 'phylum', 'class', 'branch', 'leaf',
    ]);

    vm.toggleExpanded('branch');
    vm.toggleSharedLineage();
    await nextTick();
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['branch']);

    vm.toggleSharedLineage();
    await nextTick();
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual([
      'domain', 'kingdom', 'phylum', 'class', 'branch',
    ]);
  });

  it('restores collapse after search and keeps parent updates complete and atomic', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = '';
    const {
      checkedTypes, filterControls, styleManager, updateCheckedTypes,
    } = makeHierarchyFixture();
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    vm.toggleExpanded('root');
    await nextTick();
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root']);

    vm.data.filterText = 'leaf';
    await nextTick();
    expect(vm.visibleTypes).toEqual(['leaf']);
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root', 'branch', 'leaf']);

    vm.data.filterText = '';
    await nextTick();
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root']);

    vm.updateCheckedType('root');
    expect(updateCheckedTypes).toHaveBeenCalledTimes(1);
    expect(checkedTypes.value).toEqual(['leaf', 'root', 'branch', 'sibling']);

    vm.updateCheckedType('root');
    expect(updateCheckedTypes).toHaveBeenCalledTimes(2);
    expect(checkedTypes.value).toEqual([]);
  });

  it('ignores hidden disclosure actions while search forces a path open', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    const { filterControls, styleManager } = makeHierarchyFixture();
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    vm.data.filterText = 'leaf';
    await nextTick();
    vm.toggleExpanded('root');
    vm.data.filterText = '';
    await nextTick();

    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root', 'branch', 'leaf']);
  });

  it('resets collapsed branches when a dataset hierarchy is loaded', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    const { filterControls, styleManager } = makeHierarchyFixture();
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    vm.toggleExpanded('root');
    await nextTick();
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root']);

    filterControls.typeHierarchy.value = {
      leaf: 'branch', branch: 'root', sibling: 'root',
    };
    await nextTick();

    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root', 'branch', 'leaf']);
  });

  it('keeps the header query-scoped while a context parent owns its full subtree', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    const {
      checkedTypes, filterControls, styleManager, updateCheckedTypes,
    } = makeHierarchyFixture();
    checkedTypes.value = [];
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: true,
      height: 240,
      headerHeight: 80,
    });

    vm.data.filterText = 'leaf';
    await nextTick();
    expect(vm.visibleTypes).toEqual(['leaf']);
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root', 'branch', 'leaf']);

    vm.headCheckClicked();
    expect(checkedTypes.value).toEqual(['leaf']);
    expect(updateCheckedTypes).toHaveBeenCalledTimes(1);

    vm.updateCheckedType('root');
    expect(checkedTypes.value).toEqual(['leaf', 'root', 'branch', 'sibling']);
    expect(updateCheckedTypes).toHaveBeenCalledTimes(2);
  });

  it('rolls total and frame counts into ancestors and keeps frame filtering header-independent', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = true;
    clientSettings.typeSettings.suppressionType = '';
    provideMocks.intervalSearch.mockImplementation(([frame]: [number, number]) => (
      frame === 0 ? ['1'] : ['1', '2', '3']
    ));
    const { filterControls, styleManager, tracks } = makeCountHierarchyFixture();
    provideMocks.getPossible.mockImplementation((id: number) => (
      tracks.find((track) => track.id === id)
    ));
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    expect(vm.typeCounts).toEqual(new Map([
      ['leaf', 1], ['branch', 2], ['root', 3], ['sibling', 1],
    ]));
    expect(vm.virtualTypes.map(({ type }) => type)).toEqual(['root', 'branch', 'leaf']);
    expect(vm.virtualTypes.map(({ displayText }) => displayText)).toEqual([
      '3 : 1\u00A0 root',
      '2 : 1\u00A0 branch',
      '1 : 1\u00A0 leaf',
    ]);
    expect(vm.visibleTypes).toEqual(['root', 'branch', 'leaf', 'sibling']);

    provideMocks.seekFrame.mockClear();
    vm.goToPeakTrackFrame('branch');
    expect(provideMocks.seekFrame).toHaveBeenLastCalledWith(5);
    vm.goToPeakTrackFrame('root');
    expect(provideMocks.seekFrame).toHaveBeenLastCalledWith(5);
  });

  it.each([
    ['flat type', null, 'leaf'],
    ['hierarchy parent', { leaf: 'root' }, 'root'],
  ] as const)('jumps to the suppression-aware peak for a %s', (
    _view,
    hierarchy,
    targetType,
  ) => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = 'Suppressed';
    provideMocks.intervalSearch.mockImplementation(([frame]: [number, number]) => (
      frame === 0 ? ['1', '2', '3'] : ['1', '2']
    ));
    const tracks = [
      new Track(1, {
        confidencePairs: [['leaf', 1]], features: featuresAt([0, 5], [0]),
      }),
      new Track(2, {
        confidencePairs: [['leaf', 1]], features: featuresAt([0, 5], [0]),
      }),
      new Track(3, {
        confidencePairs: [['leaf', 1]], features: featuresAt([0]),
      }),
    ];
    const { filterControls, styleManager } = makeCountHierarchyFixture({
      tracks,
      hierarchy,
      checkedTypes: hierarchy ? ['root', 'leaf'] : ['leaf'],
    });
    provideMocks.getPossible.mockImplementation((id: number) => (
      tracks.find((track) => track.id === id)
    ));
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    expect(vm.virtualTypes.find(({ type }) => type === targetType)?.displayText)
      .toBe(`3 : 1\u00A0 ${targetType}`);
    const intervalSearchCalls = provideMocks.intervalSearch.mock.calls.length;

    vm.goToPeakTrackFrame(targetType);

    expect(provideMocks.seekFrame).toHaveBeenCalledWith(5);
    expect(provideMocks.intervalSearch).toHaveBeenCalledTimes(intervalSearchCalls);
  });

  it('finds a region-suppression-aware peak without rescanning each frame', () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = 'Suppressed';
    clientSettings.typeSettings.suppressionThreshold = 99;
    provideMocks.intervalSearch.mockImplementation(([frame]: [number, number]) => (
      frame === 0 ? ['1', '2', '3', '4'] : ['1', '2']
    ));
    const tracks = [
      new Track(1, {
        confidencePairs: [['leaf', 1]], features: featuresAt([0, 5]),
      }),
      new Track(2, {
        confidencePairs: [['leaf', 1]], features: featuresAt([0, 5]),
      }),
      new Track(3, {
        confidencePairs: [['leaf', 1]], features: featuresAt([0]),
      }),
      new Track(4, {
        confidencePairs: [['Suppressed', 1]], features: featuresAt([0]),
      }),
    ];
    tracks.forEach((track) => provideMocks.annotationMap.set(track.id, track));
    const { filterControls, styleManager } = makeCountHierarchyFixture({
      tracks,
      hierarchy: null,
      checkedTypes: ['leaf', 'Suppressed'],
    });
    provideMocks.getPossible.mockImplementation((id: number) => (
      tracks.find((track) => track.id === id)
    ));
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    expect(vm.virtualTypes.find(({ type }) => type === 'leaf')?.displayText)
      .toBe('3 : 0\u00A0 leaf');
    const intervalSearchCalls = provideMocks.intervalSearch.mock.calls.length;

    vm.goToPeakTrackFrame('leaf');

    expect(provideMocks.seekFrame).toHaveBeenCalledWith(5);
    expect(provideMocks.intervalSearch).toHaveBeenCalledTimes(intervalSearchCalls);
  });

  it('starts current-frame counts when an asynchronous camera selection becomes available', async () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = '';
    provideMocks.selectedCameraValue = '';
    provideMocks.intervalSearch.mockReturnValue(['1']);
    const { filterControls, styleManager, tracks } = makeCountHierarchyFixture();
    provideMocks.getPossible.mockImplementation((id: number) => (
      tracks.find((track) => track.id === id)
    ));
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    expect(vm.virtualTypes.find(({ type }) => type === 'root')?.displayText)
      .toBe('3 : 0\u00A0 root');

    if (!provideMocks.selectedCameraRef) {
      throw new Error('selected camera ref was not captured');
    }
    provideMocks.selectedCameraRef.value = 'singleCam';
    await nextTick();

    expect(vm.virtualTypes.find(({ type }) => type === 'root')?.displayText)
      .toBe('3 : 1\u00A0 root');
  });

  it('does not restore attribute-suppressed descendants through ancestor roll-up', () => {
    clientSettings.typeSettings.trackSortDir = 'a-z';
    clientSettings.typeSettings.filterTypesByFrame = false;
    clientSettings.typeSettings.suppressionType = 'Suppressed';
    const { filterControls, styleManager, tracks } = makeCountHierarchyFixture();
    tracks[0].attributes.Suppressed = true;
    tracks.forEach((track) => provideMocks.annotationMap.set(track.id, track));
    const { vm } = mountFilterList({
      filterControls,
      styleManager,
      showEmptyTypes: false,
      height: 240,
      headerHeight: 80,
    });

    expect(vm.typeCounts).toEqual(new Map([
      ['branch', 1], ['root', 2], ['sibling', 1],
    ]));
    expect(vm.virtualTypes.map(({ displayText }) => displayText)).toEqual([
      '2 : 0\u00A0 root',
      '1 : 0\u00A0 branch',
      '0 : 0\u00A0 leaf',
      '1 : 0\u00A0 sibling',
    ]);
  });
});
