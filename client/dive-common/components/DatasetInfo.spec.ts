// @vitest-environment jsdom
// eslint-disable-next-line import/no-extraneous-dependencies -- Vue Test Utils is only used in tests
import { mount } from '@vue/test-utils';
import Vue, {
  computed, CreateElement, defineComponent, nextTick, ref,
} from 'vue';

// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  describe, expect, it, vi,
} from 'vitest';

import {
  DatasetMeta,
  provideApi,
} from 'dive-common/apispec';
import {
  dummyHandler,
  dummyState,
  provideAnnotator,
} from 'vue-media-annotator/provides';
import DatasetInfo from './DatasetInfo.vue';

// DatasetInfo consumes the shared `useFrameMetadata` composable; the composable's own resolver /
// download / stale-token behaviour is covered by its dedicated spec. Here we mock it to drive the
// panel's rendering and empty states directly off the resolved contract (columns + per-frame rows).
const frameMetadataControl = vi.hoisted(() => ({
  impl: (() => ({})) as (opts: unknown) => unknown,
}));

vi.mock('dive-common/use', () => ({
  useFrameMetadata: (opts: unknown) => frameMetadataControl.impl(opts),
}));

Vue.config.ignoredElements = [/^v-/];

// v-tooltip only renders its activator slot when it is a real component; stub it so the
// frame-metadata source icon (behind the activator slot) renders for assertions.
const VTooltipStub = {
  render(this: Vue, h: CreateElement) {
    const activator = this.$scopedSlots.activator?.({ on: {}, attrs: {} });
    return h('div', [activator]);
  },
};

function flushPromises() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

interface FrameMetadataScenario {
  /** camera -> column names, in the order the panel must render them. */
  columns?: Record<string, string[]>;
  /** camera -> (frame number -> row of cell values aligned to `columns[camera]`). */
  cameras?: Record<string, Record<number, string[]>>;
  /** camera -> matched sidecar filenames (winner first). Presence => `hasMetadataSource`. */
  sources?: Record<string, string[]>;
  /** camera -> raw sidecar item filenames present, independent of whether any of them joined. */
  sidecarItems?: Record<string, string[]>;
}

interface FrameMetadataOptions {
  frame: { value: number };
  selectedCamera: { value: string };
}

/**
 * Faithful stand-in for `useFrameMetadata`: derives `currentEntries` from a single compact row in
 * `columns` order and tracks the active camera reactively, exactly as the real composable does.
 */
function fakeFrameMetadata(opts: FrameMetadataOptions, scenario: FrameMetadataScenario) {
  const columns = scenario.columns ?? {};
  const cameras = scenario.cameras ?? {};
  const sources = scenario.sources ?? {};
  const sidecarItems = scenario.sidecarItems ?? {};
  const currentEntries = computed<[string, string][]>(() => {
    const camera = opts.selectedCamera.value;
    const cols = columns[camera];
    const row = cameras[camera]?.[opts.frame.value];
    if (cols === undefined || row === undefined) {
      return [];
    }
    return cols.map((column, i): [string, string] => [column, row[i] ?? '']);
  });
  return {
    currentEntries,
    currentSources: computed(() => sources[opts.selectedCamera.value] ?? []),
    hasMetadataSource: computed(() => opts.selectedCamera.value in sources),
    hasSidecarItems: computed(() => (sidecarItems[opts.selectedCamera.value]?.length ?? 0) > 0),
    sidecarSourceNames: computed(() => sidecarItems[opts.selectedCamera.value] ?? []),
    loading: ref(false),
    error: ref<string | null>(null),
    ensure: async () => undefined,
  };
}

const defaultMetadata: DatasetMeta = {
  id: 'dataset-id',
  imageData: [],
  videoUrl: undefined,
  type: 'image-sequence',
  fps: 5,
  name: 'Mouss Set',
  createdAt: '2024-01-02T03:04:05.000Z',
  originalFps: 10,
  subType: null,
  multiCamMedia: null,
  datasetInfo: {
    cruise: '2403',
    station: 'TXN-012',
  },
};

function apiWithMetadata({
  loadMetadata,
  saveMetadata,
  frameMetadataSupported = true,
}: {
  loadMetadata: (datasetId: string) => Promise<DatasetMeta>;
  saveMetadata: Parameters<typeof provideApi>[0]['saveMetadata'];
  /** False mimics a platform with neither web nor desktop frame-metadata read path wired up. */
  frameMetadataSupported?: boolean;
}): Parameters<typeof provideApi>[0] {
  return {
    getPipelineList: async () => ({}),
    runPipeline: async () => undefined,
    deleteTrainedPipeline: async () => undefined,
    exportTrainedPipeline: async () => undefined,
    getDatasetCalibration: async () => null,
    getTrainingConfigurations: async () => ({ training: { configs: [], default: '' }, models: {} }),
    runTraining: async () => undefined,
    loadMetadata,
    loadDetections: async () => ({
      version: 2,
      tracks: [],
      groups: [],
      sets: [],
    }),
    ...(frameMetadataSupported ? {
      loadFrameMetadata: async () => ({ cameras: {} }),
    } : {}),
    saveDetections: async () => undefined,
    saveMetadata,
    saveAttributes: async () => undefined,
    saveAttributeTrackFilters: async () => undefined,
    openFromDisk: async () => ({ canceled: true, filePaths: [] }),
    importAnnotationFile: async () => false,
  };
}

function mountDatasetInfo({
  scenario = {},
  selectedCamera = 'port',
  frame = 10,
  readOnlyMode = true,
  metadata = defaultMetadata,
  frameMetadataSupported = true,
}: {
  scenario?: FrameMetadataScenario;
  selectedCamera?: string;
  frame?: number;
  readOnlyMode?: boolean;
  metadata?: DatasetMeta;
  frameMetadataSupported?: boolean;
} = {}) {
  const state = dummyState();
  state.datasetId = ref('dataset-id');
  state.selectedCamera = ref(selectedCamera);
  state.time = {
    ...state.time,
    frame: ref(frame),
  };
  state.readOnlyMode = ref(readOnlyMode);

  const useFrameMetadataSpy = vi.fn(
    (opts: FrameMetadataOptions) => fakeFrameMetadata(opts, scenario),
  );
  frameMetadataControl.impl = useFrameMetadataSpy as (opts: unknown) => unknown;

  const loadMetadata = vi.fn(async () => metadata);
  const saveMetadata = vi.fn(async () => undefined);
  const api = apiWithMetadata({ loadMetadata, saveMetadata, frameMetadataSupported });

  const Root = defineComponent({
    components: { DatasetInfo },
    setup() {
      provideApi(api);
      provideAnnotator(
        state,
        dummyHandler(() => undefined),
        {} as Parameters<typeof provideAnnotator>[2],
      );
      return {};
    },
    template: '<DatasetInfo />',
  });

  const wrapper = mount(Root, {
    stubs: {
      DatasetMetaEditorDialog: true,
      'v-tooltip': VTooltipStub,
    },
  });
  return {
    wrapper,
    state,
    useFrameMetadataSpy,
    loadMetadata,
    saveMetadata,
  };
}

describe('DatasetInfo', () => {
  it('renders metadata sections as collapsible panels', async () => {
    const { wrapper } = mountDatasetInfo({
      scenario: {
        columns: { port: ['latitude'] },
        cameras: { port: { 10: ['58.10'] } },
        sources: { port: ['frame_metadata.csv'] },
      },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.dataset-info-panels').exists()).toBe(true);
    const headers = wrapper.findAll('.dataset-info-panel-header').wrappers;
    expect(headers).toHaveLength(3);
    expect(headers[0].text()).toContain('Frame Metadata');
    expect(headers[1].text()).toContain('Dataset Info');
    expect(headers[2].text()).toContain('Custom Metadata');
  });

  it('renders frame metadata above dataset info rows in source order', async () => {
    const { wrapper } = mountDatasetInfo({
      scenario: {
        columns: { port: ['latitude', 'depth_m', 'note'] },
        cameras: { port: { 10: ['58.10', '100', '  raw text  '] } },
        sources: { port: ['frame_metadata.csv'] },
      },
    });

    await flushPromises();
    await nextTick();

    const frameRows = wrapper.findAll('.frame-metadata-row').wrappers;
    expect(frameRows.map((item) => item.find('.frame-metadata-key').text()))
      .toEqual(['latitude', 'depth_m', 'note']);
    expect(frameRows.map((item) => item.find('.frame-metadata-value').element.textContent))
      .toEqual(['58.10', '100', '  raw text  ']);

    const text = wrapper.text();
    expect(text.indexOf('Frame Metadata')).toBeLessThan(text.indexOf('Dataset Info'));
    expect(text.indexOf('Dataset Info')).toBeLessThan(text.indexOf('Custom Metadata'));
    expect(wrapper.find('.frame-metadata-source-icon').attributes('aria-label'))
      .toBe('Source: frame_metadata.csv');
    expect(wrapper.find('.dataset-info-section').text()).toContain('Mouss Set');
    expect(wrapper.find('.dataset-info-section').text()).toContain('image-sequence');
    expect(wrapper.find('.custom-metadata-section').text()).toContain('cruise');
    expect(wrapper.find('.custom-metadata-section').text()).toContain('2403');
  });

  it('keeps frame metadata read-only without edit controls', async () => {
    const { wrapper } = mountDatasetInfo({
      readOnlyMode: false,
      scenario: {
        columns: { port: ['latitude'] },
        cameras: { port: { 10: ['58.10'] } },
        sources: { port: ['frame_metadata.csv'] },
      },
    });

    await flushPromises();
    await nextTick();

    const frameSection = wrapper.find('.frame-metadata-section');
    expect(frameSection.find('v-text-field').exists()).toBe(false);
    expect(frameSection.find('v-btn').exists()).toBe(false);
    expect(wrapper.find('.custom-metadata-section').find('v-text-field').exists()).toBe(true);
    expect(wrapper.find('.custom-metadata-section').find('v-btn').exists()).toBe(true);
  });

  it('shows the no-source state when the dataset has no sidecar', async () => {
    const { wrapper } = mountDatasetInfo({ scenario: {} });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('No frame metadata source found.');
    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('Add frame-metadata.csv or frame-metadata.txt beside the imagery.');
  });

  it('shows the unsupported-media state for a non-image-sequence dataset type', async () => {
    const { wrapper } = mountDatasetInfo({
      scenario: {},
      metadata: { ...defaultMetadata, type: 'video' },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('Frame metadata is available for image-sequence datasets only.');
    expect(wrapper.find('.frame-metadata-section').text())
      .not.toContain('No frame metadata source found.');
  });

  it('shows the unsupported-media state when the platform has no frame-metadata read path', async () => {
    const { wrapper } = mountDatasetInfo({
      scenario: {},
      frameMetadataSupported: false,
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('Frame metadata is available for image-sequence datasets only.');
  });

  it('shows the present-but-unmatched state when a sidecar exists but joined no frames', async () => {
    const { wrapper } = mountDatasetInfo({
      scenario: {
        sidecarItems: { port: ['frame_metadata.csv'] },
      },
    });

    await flushPromises();
    await nextTick();

    const text = wrapper.find('.frame-metadata-section').text();
    expect(text).toContain('A frame metadata file (frame_metadata.csv) is present but none of its rows matched');
    expect(text).toContain('check its filename column.');
    expect(text).not.toContain('No frame metadata source found.');
  });

  it('shows the no-current-frame state when the dataset has metadata but not this frame', async () => {
    const { wrapper } = mountDatasetInfo({
      scenario: {
        columns: { port: ['latitude'] },
        cameras: { port: { 11: ['58.11'] } },
        sources: { port: ['frame_metadata.csv'] },
      },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('No frame metadata for the current frame.');
  });

  it('follows the active multicam camera without re-creating the composable', async () => {
    const { wrapper, state, useFrameMetadataSpy } = mountDatasetInfo({
      scenario: {
        columns: { port: ['latitude'], starboard: ['latitude'] },
        cameras: { port: { 10: ['58.10'] }, starboard: { 10: ['59.10'] } },
        sources: { port: ['frame_metadata.csv'], starboard: ['frame-metadata.txt'] },
      },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text()).toContain('58.10');
    state.selectedCamera.value = 'starboard';
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text()).toContain('59.10');
    expect(wrapper.find('.frame-metadata-section').text()).not.toContain('58.10');
    expect(useFrameMetadataSpy).toHaveBeenCalledTimes(1);
  });
});
