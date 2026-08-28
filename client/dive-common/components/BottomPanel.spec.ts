import { defineComponent, h, ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track from 'vue-media-annotator/track';
import BottomPanel from './BottomPanel.vue';

const state = vi.hoisted(() => ({ acceptTrackType: vi.fn() }));

vi.mock('vue-media-annotator/provides', () => ({
  useCameraStore: () => ({ acceptTrackType: state.acceptTrackType }),
  useTrackFilters: () => ({ hierarchyIndex: ref(undefined) }),
}));

describe('BottomPanel track details classification editing', () => {
  beforeEach(() => state.acceptTrackType.mockClear());

  it('routes Accept Correct Type through the logical-track command', () => {
    const track = new Track(1, {
      confidencePairs: [['root', 0.9], ['leaf', 0.7]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    });
    // `@vue/test-utils` types a mount target as a Vue 2 constructor, which a
    // `defineComponent` SFC is not, so the panel renders from a host that captures the real
    // instance. It stays unstubbed to keep shallow semantics for its own children.
    let child: InstanceType<typeof BottomPanel> | undefined;
    const Host = defineComponent({
      setup: () => () => h(BottomPanel, {
        ref: (instance) => {
          if (instance && !(instance instanceof Element)) {
            child = instance as InstanceType<typeof BottomPanel>;
          }
        },
        props: {
          sidebarMode: 'bottom',
          controlsRef: null,
          controlsCollapsed: false,
          lineChartData: [],
          eventChartData: {},
          groupChartData: {},
          datasetType: 'video',
          isDefaultImage: false,
          clientSettings: {
            trackSettings: { newTrackSettings: { mode: 'Track', type: 'unknown' } },
            typeSettings: { lockTypes: false, showEmptyTypes: false },
          },
          trackFilters: {
            allTypes: ref(['root', 'leaf']),
            hierarchyActive: ref(true),
            importTypes: vi.fn(),
          },
          attributes: [],
          frameRate: 30,
          readonlyState: false,
          disableAnnotationFilters: false,
          promptVisible: () => false,
          confidenceFilters: { default: 0.1 },
          aggregateSeek: vi.fn(),
          trackStyleManager: {},
          bottomRightPanelView: 'details',
          toggleBottomRightPanel: vi.fn(),
          selectedTrackForDetails: track,
          showConfidenceFirst: true,
          showTrackAttributesFirst: true,
          editIndividual: null,
          setEditIndividual: vi.fn(),
          resetEditIndividual: vi.fn(),
          addAttribute: vi.fn(),
          editAttribute: vi.fn(),
          saveThreshold: vi.fn(),
        },
      }),
    });
    shallowMount(Host, { stubs: { BottomPanel: false } });
    if (!child) {
      throw new Error('BottomPanel did not mount');
    }
    child.acceptTrackType('leaf');

    expect(state.acceptTrackType).toHaveBeenCalledWith(1, 'leaf', undefined);
  });
});
