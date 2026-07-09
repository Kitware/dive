// @vitest-environment jsdom
/* eslint-disable import/no-extraneous-dependencies */
import { mount } from '@vue/test-utils';
import Vue, {
  CreateElement, defineComponent, nextTick, provide, ref,
} from 'vue';

import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import {
  DatasetMeta,
  provideApi,
} from 'dive-common/apispec';
import type { FrameMetadataSourcesResponse } from 'dive-common/apispec';
import {
  __resetFrameMetadataSessionCache,
} from 'dive-common/use/useFrameMetadata';
import {
  dummyHandler,
  dummyState,
  provideAnnotator,
} from 'vue-media-annotator/provides';
import DatasetInfo, { CameraMediaNamesSymbol } from './DatasetInfo.vue';

Vue.config.ignoredElements = [/^v-/];

const VTooltipStub = {
  render(this: Vue, h: CreateElement) {
    return h('div', [this.$scopedSlots.activator?.({ on: {}, attrs: {} })]);
  },
};

async function settleOnce() {
  await nextTick();
  await new Promise((resolve) => { window.setTimeout(resolve, 0); });
}

async function settle() {
  await settleOnce();
  await settleOnce();
  await settleOnce();
  await settleOnce();
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
  metadata,
  frameMetadata,
  frameMetadataSupported,
  saveMetadata,
}: {
  metadata: DatasetMeta;
  frameMetadata: FrameMetadataSourcesResponse;
  frameMetadataSupported: boolean;
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
    loadMetadata: vi.fn(async () => metadata),
    loadDetections: async () => ({
      version: 2,
      tracks: [],
      groups: [],
      sets: [],
    }),
    ...(frameMetadataSupported ? {
      loadFrameMetadata: vi.fn(async () => frameMetadata),
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
  frameMetadata = { cameras: {} },
  mediaNames = { port: ['port001.png'], starboard: ['starboard001.png'] },
  selectedCamera = 'port',
  frame = 0,
  readOnlyMode = true,
  metadata = defaultMetadata,
  frameMetadataSupported = true,
}: {
  frameMetadata?: FrameMetadataSourcesResponse;
  mediaNames?: Record<string, string[] | undefined>;
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

  const saveMetadata = vi.fn(async () => undefined);
  const api = apiWithMetadata({
    metadata,
    frameMetadata,
    frameMetadataSupported,
    saveMetadata,
  });

  const Root = defineComponent({
    components: { DatasetInfo },
    setup() {
      provideApi(api);
      provide(CameraMediaNamesSymbol, (camera: string) => mediaNames[camera]);
      provideAnnotator(
        state,
        dummyHandler(() => undefined),
        {} as Parameters<typeof provideAnnotator>[2],
      );
      return {};
    },
    template: '<DatasetInfo />',
  });

  return {
    wrapper: mount(Root, {
      stubs: {
        DatasetInfoFieldDialog: true,
        'v-tooltip': VTooltipStub,
      },
    }),
    state,
    loadFrameMetadata: api.loadFrameMetadata,
  };
}

function frameMetadataRows(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('.frame-metadata-row').wrappers.map((row) => ({
    key: row.find('.frame-metadata-key').text(),
    value: row.find('.frame-metadata-value').element.textContent,
  }));
}

describe('DatasetInfo', () => {
  beforeEach(() => {
    __resetFrameMetadataSessionCache();
  });

  it('renders the useful frame, dataset, and custom dataset info in order', async () => {
    const { wrapper } = mountDatasetInfo({
      frameMetadata: {
        cameras: {
          port: [{
            name: 'frame_metadata.csv',
            text: 'filename,latitude,depth_m,note\nport001.png,58.10,100,raw text\n',
          }],
        },
      },
    });

    await settle();

    const headers = wrapper.findAll('.dataset-info-panel-header').wrappers;
    expect(headers.map((header) => header.text())).toEqual([
      expect.stringContaining('Frame Metadata'),
      expect.stringContaining('Dataset Info'),
      expect.stringContaining('Custom Dataset Info'),
    ]);
    expect(frameMetadataRows(wrapper)).toEqual([
      { key: 'filename', value: 'port001.png' },
      { key: 'latitude', value: '58.10' },
      { key: 'depth_m', value: '100' },
      { key: 'note', value: 'raw text' },
    ]);

    const text = wrapper.text();
    expect(text.indexOf('Frame Metadata')).toBeLessThan(text.indexOf('Dataset Info'));
    expect(text.indexOf('Dataset Info')).toBeLessThan(text.indexOf('Custom Dataset Info'));
    expect(wrapper.find('.frame-metadata-source-icon').attributes('aria-label'))
      .toBe('Source: frame_metadata.csv');
    expect(wrapper.find('.dataset-info-section').text()).toContain('Mouss Set');
    expect(wrapper.find('.dataset-info-section').text()).toContain('image-sequence');
    expect(wrapper.find('.custom-dataset-info-section').text()).toContain('cruise');
    expect(wrapper.find('.custom-dataset-info-section').text()).toContain('2403');
  });

  it('keeps frame metadata read-only when custom dataset info is editable', async () => {
    const { wrapper } = mountDatasetInfo({
      readOnlyMode: false,
      frameMetadata: {
        cameras: {
          port: [{
            name: 'frame_metadata.csv',
            text: 'filename,latitude\nport001.png,58.10\n',
          }],
        },
      },
    });

    await settle();

    expect(wrapper.find('.frame-metadata-section').find('v-text-field').exists()).toBe(false);
    expect(wrapper.find('.frame-metadata-section').find('v-btn').exists()).toBe(false);
    expect(wrapper.find('.custom-dataset-info-section').find('v-text-field').exists()).toBe(true);
    expect(wrapper.find('.custom-dataset-info-section').find('v-btn').exists()).toBe(true);
  });

  it.each([
    {
      name: 'no sidecar',
      options: {},
      expected: 'No frame metadata source found.',
    },
    {
      name: 'unsupported dataset type',
      options: { metadata: { ...defaultMetadata, type: 'video' } },
      expected: 'Frame metadata is available for image-sequence datasets only.',
    },
    {
      name: 'unsupported platform',
      options: { frameMetadataSupported: false },
      expected: 'Frame metadata is available for image-sequence datasets only.',
    },
    {
      name: 'unmatched sidecar',
      options: {
        frameMetadata: {
          cameras: {
            port: [{
              name: 'frame_metadata.csv',
              text: 'filename,depth\nother001.png,10\n',
            }],
          },
        },
      },
      expected: 'A frame metadata file (frame_metadata.csv) is present but none of its rows matched',
    },
    {
      name: 'no row for current frame',
      options: {
        frame: 1,
        frameMetadata: {
          cameras: {
            port: [{
              name: 'frame_metadata.csv',
              text: 'filename,depth\nport001.png,10\n',
            }],
          },
        },
      },
      expected: 'No frame metadata for the current frame.',
    },
  ])('shows the $name empty state', async ({ options, expected }) => {
    const { wrapper } = mountDatasetInfo(options);

    await settle();

    expect(wrapper.find('.frame-metadata-section').text()).toContain(expected);
  });

  it('follows the selected camera', async () => {
    const { wrapper, state, loadFrameMetadata } = mountDatasetInfo({
      frameMetadata: {
        cameras: {
          port: [{
            name: 'frame_metadata.csv',
            text: 'filename,latitude\nport001.png,58.10\n',
          }],
          starboard: [{
            name: 'frame-metadata.txt',
            text: 'filename,latitude\nstarboard001.png,59.10\n',
          }],
        },
      },
    });

    await settle();
    expect(wrapper.find('.frame-metadata-section').text()).toContain('58.10');

    state.selectedCamera.value = 'starboard';
    await settle();

    const section = wrapper.find('.frame-metadata-section');
    expect(section.text()).toContain('59.10');
    expect(section.text()).not.toContain('58.10');
    expect(wrapper.find('.frame-metadata-source-icon').attributes('aria-label'))
      .toBe('Source: frame-metadata.txt');
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
  });
});
