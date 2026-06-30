// @vitest-environment jsdom
// eslint-disable-next-line import/no-extraneous-dependencies -- Vue Test Utils is only used in tests
import { mount } from '@vue/test-utils';
import {
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
import FrameInfo from './FrameInfo.vue';

function flushPromises() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function apiWithFrameMetadata(
  loadFrameMetadata?: (datasetId: string, startFrame: number, endFrame: number) =>
    Promise<FrameMetadataResponse>,
): Parameters<typeof provideApi>[0] {
  return {
    getPipelineList: async () => ({}),
    runPipeline: async () => undefined,
    deleteTrainedPipeline: async () => undefined,
    exportTrainedPipeline: async () => undefined,
    getDatasetCalibration: async () => null,
    getTrainingConfigurations: async () => ({ training: { configs: [], default: '' }, models: {} }),
    runTraining: async () => undefined,
    loadMetadata: async () => ({} as DatasetMeta),
    loadDetections: async () => ({
      version: 2,
      tracks: [],
      groups: [],
      sets: [],
    }),
    loadFrameMetadata,
    saveDetections: async () => undefined,
    saveMetadata: async () => undefined,
    saveAttributes: async () => undefined,
    saveAttributeTrackFilters: async () => undefined,
    openFromDisk: async () => ({ canceled: true, filePaths: [] }),
    importAnnotationFile: async () => false,
  };
}

function mountFrameInfo({
  response,
  loadFrameMetadata,
  selectedCamera = 'port',
}: {
  response?: FrameMetadataResponse;
  loadFrameMetadata?: (datasetId: string, startFrame: number, endFrame: number) =>
    Promise<FrameMetadataResponse>;
  selectedCamera?: string;
} = {}) {
  const state = dummyState();
  state.datasetId = ref('dataset-id');
  state.selectedCamera = ref(selectedCamera);
  state.time = {
    ...state.time,
    frame: ref(10),
  };
  const loader = loadFrameMetadata ?? (
    response === undefined
      ? undefined
      : vi.fn(async () => response)
  );
  const api = apiWithFrameMetadata(loader);

  const Root = defineComponent({
    components: { FrameInfo },
    setup() {
      provideApi(api);
      provideAnnotator(
        state,
        dummyHandler(() => undefined),
        {} as Parameters<typeof provideAnnotator>[2],
      );
      return {};
    },
    template: '<FrameInfo />',
  });

  const wrapper = mount(Root);
  return { wrapper, state, loadFrameMetadata: loader };
}

describe('FrameInfo', () => {
  it('renders the active frame metadata fields in source order with raw values', async () => {
    const { wrapper } = mountFrameInfo({
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

    expect(wrapper.findAll('.frame-info-key').wrappers.map((item) => item.text()))
      .toEqual(['latitude', 'depth_m', 'note']);
    expect(wrapper.findAll('.frame-info-value').wrappers.map((item) => item.element.textContent))
      .toEqual(['58.10', '100', '  raw text  ']);
    expect(wrapper.text()).not.toContain('Frame 10');
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('shows the unsupported platform state when no load API is provided', async () => {
    const { wrapper } = mountFrameInfo();

    await nextTick();

    expect(wrapper.text()).toContain('Frame metadata is not supported on this platform.');
  });

  it('shows the no-source state after an empty cameras response', async () => {
    const { wrapper } = mountFrameInfo({ response: { cameras: {} } });

    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('No frame metadata source found.');
    expect(wrapper.text()).toContain('Place a .txt or .csv telemetry file next to the imagery.');
  });

  it('shows the no-current-frame state when the dataset has metadata but not this frame', async () => {
    const { wrapper } = mountFrameInfo({
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

    expect(wrapper.text()).toContain('No frame metadata for the current frame.');
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
    const { wrapper, state } = mountFrameInfo({ loadFrameMetadata });

    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('58.10');
    state.selectedCamera.value = 'starboard';
    await nextTick();

    expect(wrapper.text()).toContain('59.10');
    expect(wrapper.text()).not.toContain('58.10');
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
  });
});
