// @vitest-environment jsdom
/* eslint-disable import/no-extraneous-dependencies */
import { mount } from '@vue/test-utils';
import Vue, {
  CreateElement, defineComponent, nextTick, ref,
} from 'vue';

import {
  beforeEach, describe, expect, it, vi,
} from 'vitest';

import {
  DatasetConfig,
  provideApi,
} from 'dive-common/apispec';
import type { FrameMetadataSourcesResponse } from 'dive-common/apispec';
import { resetFrameMetadataSessionCache } from 'dive-common/use/useFrameMetadata';
import {
  dummyHandler,
  dummyState,
  provideAnnotator,
} from 'vue-media-annotator/provides';
import { useMediaController } from 'vue-media-annotator/components';
import type { MediaControllerKind } from 'vue-media-annotator/components/annotators/mediaControllerType';
import DatasetInfo from './DatasetInfo.vue';

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

const defaultMetadata: DatasetConfig = {
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
}: {
  metadata: DatasetConfig;
  frameMetadata: FrameMetadataSourcesResponse;
}): Parameters<typeof provideApi>[0] {
  return {
    getPipelineList: async () => ({}),
    runPipeline: async () => undefined,
    deleteTrainedPipeline: async () => undefined,
    exportTrainedPipeline: async () => undefined,
    getDatasetCalibration: async () => null,
    getTrainingConfigurations: async () => ({ training: { configs: [], default: '' }, models: {} }),
    runTraining: async () => undefined,
    loadConfig: vi.fn(async () => metadata),
    loadDetections: async () => ({
      version: 2,
      tracks: [],
      groups: [],
      sets: [],
    }),
    loadFrameMetadata: vi.fn(async () => frameMetadata),
    saveDetections: async () => undefined,
    saveConfig: async () => undefined,
    saveAttributes: async () => undefined,
    saveAttributeTrackFilters: async () => undefined,
    openFromDisk: async () => ({ canceled: true, filePaths: [] }),
    importAnnotationFile: async () => false,
  };
}

function mountDatasetInfo({
  frameMetadata = { cameras: {} },
  mediaNames = { port: ['port001.png'], starboard: ['starboard001.png'] },
  mediaKinds = {},
  readyCameras = {},
  hasFrameCameras = {},
  maxFrames = {},
  selectedCamera = 'port',
  frame = 0,
  readOnlyMode = true,
  metadata = defaultMetadata,
}: {
  frameMetadata?: FrameMetadataSourcesResponse;
  mediaNames?: Record<string, string[] | undefined>;
  mediaKinds?: Record<string, MediaControllerKind | undefined>;
  readyCameras?: Record<string, boolean | undefined>;
  hasFrameCameras?: Record<string, boolean | undefined>;
  maxFrames?: Record<string, number | undefined>;
  selectedCamera?: string;
  frame?: number;
  readOnlyMode?: boolean;
  metadata?: DatasetConfig;
} = {}) {
  const state = dummyState();
  state.datasetId = ref('dataset-id');
  state.selectedCamera = ref(selectedCamera);
  state.time = {
    ...state.time,
    frame: ref(frame),
  };
  state.readOnlyMode = ref(readOnlyMode);

  const api = apiWithMetadata({ metadata, frameMetadata });

  const Root = defineComponent({
    components: { DatasetInfo },
    setup() {
      provideApi(api);
      const { initialize } = useMediaController();
      Object.entries(mediaNames).forEach(([camera, names]) => {
        if (names === undefined) {
          return;
        }
        const mediaKind = mediaKinds[camera] ?? 'image-sequence';
        const { state: cameraState } = initialize(camera, mediaKind, {
          seek: () => undefined,
          play: () => undefined,
          pause: () => undefined,
          setVolume: () => undefined,
          setSpeed: () => undefined,
        });
        cameraState.filenames = names;
        cameraState.maxFrame = maxFrames[camera] ?? Math.max(0, names.length - 1);
        cameraState.ready = readyCameras[camera] ?? true;
        cameraState.hasFrame = hasFrameCameras[camera] ?? true;
      });
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
  return wrapper.find('.frame-metadata-section').findAll('.info-row').wrappers.map((row) => ({
    key: row.find('.info-key').text(),
    value: row.find('.info-value').element.textContent,
  }));
}

describe('DatasetInfo', () => {
  beforeEach(() => {
    resetFrameMetadataSessionCache();
  });

  it('renders the useful frame, dataset, and custom dataset info in order', async () => {
    const { wrapper } = mountDatasetInfo({
      frameMetadata: {
        cameras: {
          port: {
            name: 'frame_metadata.csv',
            text: 'filename,latitude,depth_m,note\nport001.png,58.10,100,raw text\n',
          },
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
    expect(wrapper.find('.frame-metadata-section .info-source-icon').attributes('aria-label'))
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
          port: {
            name: 'frame_metadata.csv',
            text: 'filename,latitude\nport001.png,58.10\n',
          },
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
      name: 'no attachment',
      options: {},
      expected: 'No frame metadata source found. Add a TXT or CSV Metadata File when creating the dataset.',
    },
    {
      name: 'unsupported dataset type',
      options: {
        metadata: { ...defaultMetadata, type: 'large-image' },
        mediaKinds: { port: 'large-image' },
      },
      expected: 'Frame metadata is available for image-sequence and video datasets only.',
    },
    {
      name: 'unmatched attachment',
      options: {
        frameMetadata: {
          cameras: {
            port: {
              name: 'frame_metadata.csv',
              text: 'filename,depth\nother001.png,10\n',
            },
          },
        },
      },
      expected: 'A metadata attachment (frame_metadata.csv) is present, but none of its rows matched this dataset\'s frames by filename, DIVE frame number, or source image counter.',
    },
    {
      name: 'opaque JSON attachment',
      options: {
        frameMetadata: {
          shared: { name: 'pipeline-input.json' },
          cameras: {},
        },
      },
      expected: 'available to pipelines, but only TXT and CSV files can be read as frame metadata.',
    },
    {
      // The generic backend reason says no more than the panel's own sentence, so it is not
      // appended; the case below shows the reason that does carry information surviving.
      name: 'unreadable attachment',
      options: {
        frameMetadata: {
          shared: { name: 'missing.csv', error: 'Metadata attachment is unavailable.' },
          cameras: {},
        },
      },
      expected: 'The metadata attachment (missing.csv) could not be read.',
    },
    {
      // The backend cannot name a single attachment here, so it sends a placeholder name and puts
      // the whole story in the error: losing that text leaves the user with nothing to act on.
      name: 'competing reserved-name attachments',
      options: {
        frameMetadata: {
          shared: {
            name: 'Metadata File',
            error: 'More than one reserved-name metadata attachment is available.',
          },
          cameras: {},
        },
      },
      expected: 'could not be read: More than one reserved-name metadata attachment is available.',
    },
    {
      name: 'invalid CSV attachment',
      options: {
        frameMetadata: {
          shared: { name: 'broken.csv', text: '' },
          cameras: {},
        },
      },
      expected: 'could not be parsed as frame metadata.',
    },
    {
      name: 'no row for current frame',
      options: {
        frame: 1,
        frameMetadata: {
          cameras: {
            port: {
              name: 'frame_metadata.csv',
              text: 'filename,depth\nport001.png,10\n',
            },
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

  it('resolves literal DIVE frame rows for a ready video controller', async () => {
    const { wrapper, state } = mountDatasetInfo({
      metadata: { ...defaultMetadata, type: 'video' },
      mediaNames: { singleCam: [] },
      mediaKinds: { singleCam: 'video' },
      maxFrames: { singleCam: 2 },
      selectedCamera: 'singleCam',
      frameMetadata: {
        shared: {
          name: 'frame_metadata.csv',
          text: 'frame,depth\n2,30\n0,10\n3,out-of-range\n',
        },
        cameras: {},
      },
    });

    await settle();
    expect(frameMetadataRows(wrapper)).toEqual([
      { key: 'frame', value: '0' },
      { key: 'depth', value: '10' },
    ]);

    state.time.frame.value = 2;
    await settle();
    expect(frameMetadataRows(wrapper)).toEqual([
      { key: 'frame', value: '2' },
      { key: 'depth', value: '30' },
    ]);
  });

  it('waits for frame information before classifying readable rows', async () => {
    const { wrapper } = mountDatasetInfo({
      metadata: { ...defaultMetadata, type: 'video' },
      mediaNames: { singleCam: [] },
      mediaKinds: { singleCam: 'video' },
      readyCameras: { singleCam: false },
      selectedCamera: 'singleCam',
      frameMetadata: {
        shared: {
          name: 'frame_metadata.csv',
          text: 'frame,depth\n0,10\n',
        },
        cameras: {},
      },
    });

    await settle();
    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('Waiting for frame information.');
  });

  it('waits rather than blaming the file while an image sequence has no media list yet', async () => {
    const { wrapper } = mountDatasetInfo({
      mediaNames: { port: [] },
      frameMetadata: {
        cameras: {
          port: { name: 'frame_metadata.csv', text: 'filename,depth\nport001.png,10\n' },
        },
      },
    });

    await settle();
    const section = wrapper.find('.frame-metadata-section');
    expect(section.text()).toContain('Waiting for frame information.');
    expect(section.text()).not.toContain('none of its rows matched');
  });

  it('resolves an image sequence before its first image finishes decoding', async () => {
    // ImageAnnotator publishes filenames in setup() but only flips `ready` once the first image
    // has loaded: the panel must not sit in a waiting state for the whole download.
    const { wrapper } = mountDatasetInfo({
      readyCameras: { port: false },
      frameMetadata: {
        cameras: {
          port: { name: 'frame_metadata.csv', text: 'filename,depth\nport001.png,10\n' },
        },
      },
    });

    await settle();
    expect(frameMetadataRows(wrapper)).toEqual([
      { key: 'filename', value: 'port001.png' },
      { key: 'depth', value: '10' },
    ]);
  });

  it('shows no rows for a camera with no frame at the current aligned instant', async () => {
    // Under the aligned multicam timeline `time.frame` keeps its previous local value while the
    // camera's own pane renders "No frame at this instant"; that row is not this instant's.
    const { wrapper } = mountDatasetInfo({
      hasFrameCameras: { port: false },
      frameMetadata: {
        cameras: {
          port: { name: 'frame_metadata.csv', text: 'filename,depth\nport001.png,10\n' },
        },
      },
    });

    await settle();
    expect(frameMetadataRows(wrapper)).toEqual([]);
    expect(wrapper.find('.frame-metadata-section').text())
      .toContain('This camera has no frame at the current time.');
  });

  it('uses the video-specific unmatched message', async () => {
    const { wrapper } = mountDatasetInfo({
      metadata: { ...defaultMetadata, type: 'video' },
      mediaNames: { singleCam: [] },
      mediaKinds: { singleCam: 'video' },
      maxFrames: { singleCam: 0 },
      selectedCamera: 'singleCam',
      frameMetadata: {
        shared: {
          name: 'frame_metadata.csv',
          text: 'filename,depth\nmovie.mp4,10\n',
        },
        cameras: {},
      },
    });

    await settle();
    expect(wrapper.find('.frame-metadata-section').text()).toContain(
      'A metadata attachment (frame_metadata.csv) is present, but none of its rows contained a valid DIVE frame number for this video.',
    );
  });

  it('follows the selected camera', async () => {
    const { wrapper, state, loadFrameMetadata } = mountDatasetInfo({
      frameMetadata: {
        cameras: {
          port: {
            name: 'frame_metadata.csv',
            text: 'filename,latitude\nport001.png,58.10\n',
          },
          starboard: {
            name: 'frame-metadata.txt',
            text: 'filename,latitude\nstarboard001.png,59.10\n',
          },
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
    expect(wrapper.find('.frame-metadata-section .info-source-icon').attributes('aria-label'))
      .toBe('Source: frame-metadata.txt');
    expect(loadFrameMetadata).toHaveBeenCalledTimes(1);
  });
});
