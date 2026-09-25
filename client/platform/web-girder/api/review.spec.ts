import { effectScope } from 'vue';
import type { DatasetConfig, SaveDetectionsArgs } from 'dive-common/apispec';
import type { TrackData } from 'vue-media-annotator/track';
import { createReviewService, ReviewService } from 'dive-common/use/useReview';
import { createFrameSource } from 'dive-common/review/frameSource';
import girderRest from 'platform/web-girder/plugins/girder';
import { loadDatasetConfig } from './dataset.service';
import { loadReviewTracks, saveDetections } from './annotation.service';
import { listReviewDatasets } from './scoring.service';
import { clearMultiCamMetaCache } from './multicamResolve';

vi.mock('platform/web-girder/plugins/girder', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('dive-common/review/frameSource', () => ({
  createFrameSource: vi.fn(() => ({ frameCount: 3, getFrame: vi.fn(), dispose: vi.fn() })),
}));

function track(frames: number[]): TrackData {
  return {
    id: 7,
    begin: 0,
    end: 2,
    attributes: {},
    confidencePairs: [['fish', 0.9], ['animal', 0.3]],
    features: frames.map((frame) => ({ frame, keyframe: true, bounds: [0, 0, 20, 20] })),
  };
}

const media = (camera: string) => ({
  imageData: [0, 1, 2].map((frame) => ({ url: `/api/v1/${camera}/${frame}.jpg`, filename: `${frame}.jpg` })),
});
const parentConfig = {
  typeHierarchy: { fish: 'animal', shark: 'animal' },
  customTypeStyling: { fish: { color: '#123456' } },
};

describe('web stereo review through the real platform adapters', () => {
  let review: ReviewService;
  let scope: ReturnType<typeof effectScope>;
  let tracks: Record<string, TrackData[]>;
  let failCamera = '';
  beforeEach(() => {
    vi.resetAllMocks();
    clearMultiCamMetaCache();
    tracks = { leftFolder: [track([0, 2])], rightFolder: [track([0, 1, 2])] };
    failCamera = '';
    vi.mocked(createFrameSource).mockImplementation(() => ({
      frameCount: 3, getFrame: vi.fn(), dispose: vi.fn(),
    }));
    vi.mocked(girderRest.get).mockImplementation(async (url, options) => {
      if (url === 'folder/rig') {
        return {
          data: {
            meta: {
              multiCam: {
                defaultDisplay: 'right', cameras: { left: { folderId: 'leftFolder' }, right: { folderId: 'rightFolder' } },
              },
            },
          },
        } as never;
      }
      if (url === 'dive_dataset/rig') {
        return {
          data: {
            id: 'rig',
            name: 'Stereo',
            type: 'multi',
            subType: 'stereo',
            fps: 10,
            multiCamMedia: {
              // Deliberately different from object-key order (as with sorted server JSON).
              cameraOrder: ['right', 'left'],
              defaultDisplay: 'right',
              cameras: {
                left: { type: 'image-sequence', ...media('left'), videoUrl: '' },
                right: { type: 'image-sequence', ...media('right'), videoUrl: '' },
              },
            },
            ...parentConfig,
          },
        } as never;
      }
      if (url === 'dive_dataset/rig/media') return { data: { imageData: [] } } as never;
      if (url === 'dive_dataset/rig/configuration') return { data: parentConfig } as never;
      if (url === 'dive_annotation/track') {
        const folder = options?.params.folderId;
        if (folder === failCamera) throw new Error('Camera access denied');
        return { data: JSON.parse(JSON.stringify(tracks[folder])) } as never;
      }
      const match = String(url).match(/^dive_dataset\/(leftFolder|rightFolder)(\/media)?$/);
      if (match) {
        return {
          data: match[2] ? media(match[1]) : {
            id: match[1],
            name: match[1],
            type: 'image-sequence',
            fps: 10,
            typeHierarchy: { fish: 'obsolete camera parent' },
          },
        } as never;
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    vi.mocked(girderRest.patch).mockImplementation(async (_url, body, options) => {
      const folder = options?.params.folderId;
      if (folder === failCamera) throw new Error('Write denied');
      const { upsert, delete: deleted } = (body as SaveDetectionsArgs).tracks;
      tracks[folder] = tracks[folder].filter((item) => !deleted.includes(item.id));
      upsert.forEach((item: TrackData) => {
        tracks[folder] = [...tracks[folder].filter((old) => old.id !== item.id), JSON.parse(JSON.stringify(item))];
      });
      return { data: {} } as never;
    });
    scope = effectScope();
    review = scope.run(() => createReviewService({
      api: {
        loadConfig: loadDatasetConfig,
        peekConfig: loadDatasetConfig,
        loadDetections: vi.fn(),
        loadReviewTracks,
        saveDetections,
      },
    }))!;
  });
  afterEach(() => { review.dispose(); scope.stop(); });

  it('loads both cameras in display order, aligns sparse frames, and uses their own media', async () => {
    await review.addDataset('rig');
    expect(review.datasets.value).toMatchObject([{ id: 'rig', status: 'ready', trackCount: 1 }]);
    const [entry] = review.entries.value;
    expect(entry.labels).toEqual(['right', 'left']);
    expect(entry.items.map((item) => item.datasetId)).toEqual(['rig/right', 'rig/left']);
    expect(entry.items.map((item) => item.frames.map((frame) => frame.frame))).toEqual([[0, 1, 2], [0, 1, 2]]);
    expect(entry.items[1].frames[1].missing).toBe(true);
    expect(review.parentOf('rig/right')).toBe('rig');
    expect(review.colorFor('fish')).toBe('#123456');
    const configs = vi.mocked(createFrameSource).mock.calls.map(([config]) => config);
    expect(configs).toHaveLength(2);
    configs.forEach((config) => {
      const folder = config.id.endsWith('/left') ? 'leftFolder' : 'rightFolder';
      expect(config.imageData[0].url).toBe(`/api/v1/${folder}/0.jpg`);
      expect(config.typeHierarchy).toEqual(parentConfig.typeHierarchy);
    });
  });

  it('keeps parent claims during type edits and persists edits/deletions to both camera folders', async () => {
    await review.addDataset('rig');
    const [entry] = review.entries.value;
    entry.items.forEach((item) => review.assignType(item, 'shark'));
    const left = entry.items[1];
    review.addKeyframe(left, 1, [1, 2, 11, 12]);
    review.updateGeometry(left, 0, { bounds: [2, 3, 12, 13] });
    await review.save();
    expect(review.pendingCount.value).toBe(0);
    expect(tracks.leftFolder[0].confidencePairs).toEqual([['shark', 1], ['animal', 0.3]]);
    expect(tracks.rightFolder[0].confidencePairs).toEqual(tracks.leftFolder[0].confidencePairs);
    expect(tracks.leftFolder[0].features[1].bounds).toEqual([1, 2, 11, 12]);
    expect(tracks.rightFolder[0].features[0].bounds).toEqual([0, 0, 20, 20]);
    await review.reloadDataset('rig');
    expect(review.entries.value).toHaveLength(1);
    review.entries.value[0].items.forEach((item) => review.deleteTrack(item));
    await review.save();
    expect(tracks).toEqual({ leftFolder: [], rightFolder: [] });
    expect(vi.mocked(girderRest.patch).mock.calls.every(([, , options]) => options?.params.folderId !== 'rig')).toBe(true);
  });

  it('loads each stereo video URL and frame rate without using the parent media', async () => {
    const original = vi.mocked(girderRest.get).getMockImplementation()!;
    vi.mocked(girderRest.get).mockImplementation(async (url, options) => {
      const response = await original(url, options) as { data: DatasetConfig };
      if (/dive_dataset\/(leftFolder|rightFolder)$/.test(String(url))) {
        return {
          data: {
            ...response.data, type: 'video', fps: 5, originalFps: 30,
          },
        } as never;
      }
      if (/dive_dataset\/(leftFolder|rightFolder)\/media$/.test(String(url))) {
        return { data: { imageData: [], video: { url: `${url}/movie.mp4` } } } as never;
      }
      return response;
    });
    await review.addDataset('rig');
    expect(review.entries.value[0].items).toHaveLength(2);
    const configs = vi.mocked(createFrameSource).mock.calls.map(([config]) => config);
    expect(configs.map((config) => config.videoUrl).sort()).toEqual([
      'dive_dataset/leftFolder/media/movie.mp4', 'dive_dataset/rightFolder/media/movie.mp4',
    ]);
    configs.forEach((config) => expect(config).toMatchObject({ type: 'video', fps: 5, originalFps: 30 }));
  });

  it('does not omit a camera when a legacy cameraOrder list is incomplete', async () => {
    const original = vi.mocked(girderRest.get).getMockImplementation()!;
    vi.mocked(girderRest.get).mockImplementation(async (url, options) => {
      const response = await original(url, options) as { data: DatasetConfig };
      if (url === 'dive_dataset/rig') {
        return { data: { ...response.data, multiCamMedia: { ...response.data.multiCamMedia, cameraOrder: ['right'] } } } as never;
      }
      return response;
    });
    await review.addDataset('rig');
    expect(review.entries.value[0].labels).toEqual(['right', 'left']);
  });

  it('removes stale camera hierarchy when the parent has no hierarchy', async () => {
    const original = vi.mocked(girderRest.get).getMockImplementation()!;
    vi.mocked(girderRest.get).mockImplementation((url, options) => (
      url === 'dive_dataset/rig/configuration'
        ? Promise.resolve({ data: {} } as never) : original(url, options)
    ));
    const config = await loadDatasetConfig('rig/left');
    expect(config.typeHierarchy).toBeUndefined();
    expect(config.imageData[0].url).toBe('/api/v1/leftFolder/0.jpg');
  });

  it('retains only failed camera edits for retry', async () => {
    await review.addDataset('rig');
    review.entries.value[0].items.forEach((item) => review.acceptType(item));
    failCamera = 'rightFolder';
    await review.save();
    expect(review.error.value).toBeTruthy();
    expect(review.pendingCount.value).toBe(1);
    failCamera = '';
    await review.save();
    expect(review.pendingCount.value).toBe(0);
  });

  it('reports a denied camera rather than marking the whole rig ready', async () => {
    failCamera = 'rightFolder';
    await review.addDataset('rig');
    expect(review.datasets.value[0].status).toBe('error');
    expect(review.datasets.value[0].error).toContain('Camera access denied');
    failCamera = '';
    await review.reloadDataset('rig');
    expect(review.datasets.value[0].status).toBe('ready');
    expect(review.entries.value[0].items).toHaveLength(2);
  });
});

it('lists stereo parents once for review without changing the scoring list', async () => {
  vi.mocked(girderRest.get).mockResolvedValue({
    data: [
      { _id: 'rig', name: 'Stereo', meta: { type: 'multi' } },
      {
        _id: 'leftFolder', parentId: 'rig', name: 'left', meta: { type: 'video' },
      },
      {
        _id: 'rightFolder', parentId: 'rig', name: 'right', meta: { type: 'video' },
      },
      { _id: 'single', name: 'Single', meta: { type: 'video' } },
    ],
  } as never);
  await expect(listReviewDatasets()).resolves.toEqual([
    { id: 'rig', name: 'Stereo', type: 'multi' }, { id: 'single', name: 'Single', type: 'video' },
  ]);
});
