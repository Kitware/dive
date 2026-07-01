// @vitest-environment jsdom
// eslint-disable-next-line import/no-extraneous-dependencies -- Vue Test Utils is only used in tests
import { mount } from '@vue/test-utils';
import Vue, {
  defineComponent, nextTick, ref,
} from 'vue';

// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  describe, expect, it, vi,
} from 'vitest';

import {
  DatasetMeta,
  FrameMetadataResponse,
  provideApi,
} from 'dive-common/apispec';
import {
  dummyHandler,
  dummyState,
  provideAnnotator,
} from 'vue-media-annotator/provides';
import MediaMetadata from './MediaMetadata.vue';

Vue.config.ignoredElements = [/^v-/];

function flushPromises() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
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
  loadFrameMetadata,
  saveMetadata,
}: {
  loadMetadata: (datasetId: string) => Promise<DatasetMeta>;
  loadFrameMetadata?: (datasetId: string, startFrame: number, endFrame: number) =>
    Promise<FrameMetadataResponse>;
  saveMetadata: Parameters<typeof provideApi>[0]['saveMetadata'];
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
    loadFrameMetadata,
    saveDetections: async () => undefined,
    saveMetadata,
    saveAttributes: async () => undefined,
    saveAttributeTrackFilters: async () => undefined,
    openFromDisk: async () => ({ canceled: true, filePaths: [] }),
    importAnnotationFile: async () => false,
  };
}

function mountMediaMetadata({
  response,
  loadFrameMetadata,
  selectedCamera = 'port',
  readOnlyMode = true,
  metadata = defaultMetadata,
}: {
  response?: FrameMetadataResponse;
  loadFrameMetadata?: (datasetId: string, startFrame: number, endFrame: number) =>
    Promise<FrameMetadataResponse>;
  selectedCamera?: string;
  readOnlyMode?: boolean;
  metadata?: DatasetMeta;
} = {}) {
  const state = dummyState();
  state.datasetId = ref('dataset-id');
  state.selectedCamera = ref(selectedCamera);
  state.time = {
    ...state.time,
    frame: ref(10),
  };
  state.readOnlyMode = ref(readOnlyMode);

  const loader = loadFrameMetadata ?? (
    response === undefined
      ? undefined
      : vi.fn(async () => response)
  );
  const loadMetadata = vi.fn(async () => metadata);
  const saveMetadata = vi.fn(async () => undefined);
  const api = apiWithMetadata({ loadMetadata, loadFrameMetadata: loader, saveMetadata });

  const Root = defineComponent({
    components: { MediaMetadata },
    setup() {
      provideApi(api);
      provideAnnotator(
        state,
        dummyHandler(() => undefined),
        {} as Parameters<typeof provideAnnotator>[2],
      );
      return {};
    },
    template: '<MediaMetadata />',
  });

  const wrapper = mount(Root, {
    stubs: {
      DatasetMetaEditorDialog: true,
    },
  });
  return {
    wrapper,
    state,
    loadFrameMetadata: loader,
    loadMetadata,
    saveMetadata,
  };
}

describe('MediaMetadata', () => {
  it('renders frame metadata above dataset info rows in source order', async () => {
    const { wrapper } = mountMediaMetadata({
      response: {
        cameras: {
          port: {
            10: {
              latitude: '58.10',
              depth_m: '100',
              note: '  raw text  ',
            },
          },
        },
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
    expect(wrapper.find('.dataset-info-section').text()).toContain('Mouss Set');
    expect(wrapper.find('.dataset-info-section').text()).toContain('image-sequence');
    expect(wrapper.find('.custom-metadata-section').text()).toContain('cruise');
    expect(wrapper.find('.custom-metadata-section').text()).toContain('2403');
  });

  it('keeps frame metadata read-only without edit controls', async () => {
    const { wrapper } = mountMediaMetadata({
      readOnlyMode: false,
      response: {
        cameras: {
          port: {
            10: {
              latitude: '58.10',
            },
          },
        },
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

  it('shows the unsupported platform state when no load API is provided', async () => {
    const { wrapper } = mountMediaMetadata();

    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('Frame metadata is not supported on this platform.');
  });

  it('shows the no-source state after an empty cameras response', async () => {
    const { wrapper } = mountMediaMetadata({ response: { cameras: {} } });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text()).toContain('No frame metadata source found.');
    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('Place a .txt or .csv telemetry file next to the imagery.');
  });

  it('shows the no-current-frame state when the dataset has metadata but not this frame', async () => {
    const { wrapper } = mountMediaMetadata({
      response: {
        cameras: {
          port: {
            11: { latitude: '58.11' },
          },
        },
      },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('No frame metadata for the current frame.');
  });

  it('follows the active multicam camera from the cached frame window', async () => {
    const loadFrameMetadata = vi.fn(async () => ({
      cameras: {
        port: {
          10: { latitude: '58.10' },
        },
        starboard: {
          10: { latitude: '59.10' },
        },
      },
    }));
    const { wrapper, state } = mountMediaMetadata({ loadFrameMetadata });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text()).toContain('58.10');
    state.selectedCamera.value = 'starboard';
    await nextTick();

    expect(wrapper.find('.frame-metadata-section').text()).toContain('59.10');
    expect(wrapper.find('.frame-metadata-section').text()).not.toContain('58.10');
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
  });
});
