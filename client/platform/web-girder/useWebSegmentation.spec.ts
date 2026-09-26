import Vue, { ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import Track from 'vue-media-annotator/track';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import { clientSettings } from 'dive-common/store/settings';
import { segmentationPolygonFeatures } from 'dive-common/recipes/segmentationPolygons';
import type { SegmentationPolygon, SegmentationPredictResponse } from 'dive-common/apispec';
import type useStereoOnnxWeb from './useStereoOnnxWeb';
import useWebSegmentation from './useWebSegmentation';

const mocks = vi.hoisted(() => ({ predict: vi.fn(), ready: vi.fn(async () => {}), dispose: vi.fn(async () => {}) }));
vi.mock('dive-common/use/segmentation/SamOnnx', () => ({
  default: class {
    predict = mocks.predict;

    ready = mocks.ready;

    dispose = mocks.dispose;

    setModel = vi.fn(async () => {});

    setDevice = vi.fn(async () => {});
  },
}));

const shape = (x: number): SegmentationPolygon => ({ exterior: [[x, 0], [x + 10, 0], [x + 10, 4], [x, 4]], holes: [] });
const result = (polygons = [shape(10)]): SegmentationPredictResponse => ({
  success: true, polygons, polygon: polygons[0].exterior, bounds: [10, 0, 20, 4],
});
const event = {
  type: 'segmentation' as const, camera: 'left', trackId: 1, frameNum: 0, points: [[25, 2]] as [number, number][], labels: [1],
};
const wrappers: ReturnType<typeof mount>[] = [];
beforeEach(() => {
  mocks.predict.mockReset();
  mocks.predict.mockImplementation(async () => result());
  clientSettings.trackSettings.newTrackSettings.autoPopulateMask = true;
  clientSettings.trackSettings.newTrackSettings.autoPopulatePoints = true;
  clientSettings.stereoSettings.autoComputeOtherCamera = true;
});
afterEach(() => wrappers.splice(0).forEach((w) => w.destroy()));

function harness() {
  const tracks = new Map<string, Track>();
  const source = new Track(1, { begin: 0, end: 0 });
  source.setFeature({ frame: 0, keyframe: true, bounds: [20, 0, 30, 4] }, segmentationPolygonFeatures([shape(20)], 'SegmentationPolygon'));
  tracks.set('left', source);
  const cameraStore = {
    getPossibleTrack: (_id: number, camera: string) => tracks.get(camera),
    camMap: ref(new Map(['left', 'right'].map((camera) => [camera, {
      trackStore: {
        add: () => { const track = new Track(1, { begin: 0, end: 0 }); tracks.set(camera, track); return track; },
        remove: () => tracks.delete(camera),
      },
    }]))),
  };
  const viewer = {
    id: 'dataset', cameraStore, multiCamList: ['left', 'right'], progress: { loaded: true },
  };
  const stereo = {
    getFrame: vi.fn(async () => ({ data: new Uint8ClampedArray(40 * 10 * 4), width: 40, height: 10 })),
    warpPoints: vi.fn(async (points: [number, number][]) => points.map(([x, y]) => [x - 10, y])),
    refreshMeasurement: vi.fn(async () => {
      tracks.forEach((track) => { if (track.getFeature(0)[0]?.head) track.setFeatureAttribute(0, 'length', 10); });
    }),
    handleStereoAnnotationComplete: vi.fn(async () => 'skipped'),
  };
  const error = vi.fn();
  let service!: ReturnType<typeof useWebSegmentation>;
  wrappers.push(mount(Vue.extend({
    setup() { service = useWebSegmentation(() => viewer, stereo as unknown as ReturnType<typeof useStereoOnnxWeb>, error); return {}; },
    render: (h) => h('div'),
  })));
  return {
    service, source, tracks, stereo, error,
  };
}

it('refreshes both lines and length after a second polygon arrives on the same detection', async () => {
  const {
    service, source, tracks, stereo, error,
  } = harness();
  service.handleNewAnnotationGeometry({ ...event, source: 'mask', polygons: [shape(20)] });
  await service.handleStereoAnnotationComplete(event);
  expect(tracks.get('right')!.getPolygonFeatures(0)).toHaveLength(1);
  const components = [shape(20), shape(35)];
  source.setFeature({ frame: 0 }, segmentationPolygonFeatures(components, 'SegmentationPolygon'));
  mocks.predict.mockResolvedValue(result([shape(10), shape(25)]));
  service.handleNewAnnotationGeometry({ ...event, source: 'mask', polygons: components });
  await service.handleStereoAnnotationComplete({ ...event, points: [[25, 2], [39, 2]], labels: [1, 1] });
  expect(error).not.toHaveBeenCalled();
  expect(tracks.get('right')!.getPolygonFeatures(0)).toHaveLength(2);
  expect(stereo.refreshMeasurement).toHaveBeenCalledTimes(2);
  tracks.forEach((track) => {
    expect(track.getFeature(0)[0]?.head).toBeDefined();
    expect(track.getFeature(0)[0]?.attributes?.length).toBe(10);
  });
});

it('does not overwrite a manually annotated counterpart', async () => {
  const { service, tracks } = harness();
  const other = new Track(1, { begin: 0, end: 0 });
  other.setFeature({ frame: 0, keyframe: true, bounds: [1, 1, 3, 3] });
  tracks.set('right', other);
  await service.handleStereoAnnotationComplete(event);
  expect(mocks.predict).not.toHaveBeenCalled();
  expect(other.getFeature(0)[0]?.bounds).toEqual([1, 1, 3, 3]);
});

it('stops replacing its generated counterpart once the user authors its line', async () => {
  const { service, tracks } = harness();
  await service.handleStereoAnnotationComplete(event);
  tracks.get('right')!.setFeatureAttribute(0, 'stereo_user_line', true);
  mocks.predict.mockClear();
  await service.handleStereoAnnotationComplete(event);
  expect(mocks.predict).not.toHaveBeenCalled();
});

it('removes its preview counterpart when segmentation is cancelled', async () => {
  const { service, tracks } = harness();
  await service.handleStereoAnnotationComplete(event);
  service.handleStereoAnnotationReset({ trackId: 1, frameNum: 0, sourceCamera: 'left' });
  expect(tracks.has('right')).toBe(false);
});

it.each(['cancel', 'source-edit', 'target-edit'])('rejects a late mask after %s', async (change) => {
  const { service, tracks, source } = harness();
  let finish!: (response: SegmentationPredictResponse) => void;
  mocks.predict.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const pending = service.handleStereoAnnotationComplete(event);
  await vi.waitFor(() => expect(finish).toBeDefined());
  if (change === 'cancel') service.handleStereoAnnotationReset({ trackId: 1, frameNum: 0, sourceCamera: 'left' });
  if (change === 'source-edit') source.setFeature({ frame: 0, bounds: [0, 0, 50, 50] });
  if (change === 'target-edit') {
    const manual = new Track(1, { begin: 0, end: 0 });
    manual.setFeature({ frame: 0, keyframe: true, bounds: [1, 1, 3, 3] }); tracks.set('right', manual);
  }
  finish(result()); await pending;
  expect(tracks.get('right')?.getPolygonFeatures(0) ?? []).toHaveLength(0);
});

it('falls back to labelled clicks when mask samples fail, and rejects a wholly unmatched transfer', async () => {
  const { service, stereo, error } = harness();
  stereo.warpPoints.mockResolvedValueOnce([]);
  await service.handleStereoAnnotationComplete({ ...event, points: [[25, 2], [22, 2]], labels: [1, 0] });
  expect(mocks.predict.mock.calls[0][2].pointLabels).toEqual([1, 0]);
  stereo.warpPoints.mockResolvedValue([null] as never);
  await service.handleStereoAnnotationComplete(event);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('No confident stereo match'));
});

it('keeps a finalized mask when a later session is cancelled', async () => {
  const { service, tracks } = harness();
  await service.handleStereoAnnotationComplete(event);
  service.handleStereoSegmentationFinalize({ trackId: 1, frameNums: [0] });
  service.handleStereoAnnotationReset({ trackId: 1, frameNum: 0, sourceCamera: 'left' });
  expect(tracks.get('right')?.getPolygonFeatures(0)).toHaveLength(1);
  await nextTick();
});

it('honors confirmation while other-camera inference is still running', async () => {
  const { service, tracks } = harness();
  let finish!: (response: SegmentationPredictResponse) => void;
  mocks.predict.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = service.handleStereoAnnotationComplete(event);
  await vi.waitFor(() => expect(finish).toBeDefined());
  service.handleStereoSegmentationFinalize({ trackId: 1, frameNums: [0] });
  finish(result());
  await pending;
  service.handleStereoAnnotationReset({ trackId: 1, frameNum: 0, sourceCamera: 'left' });
  expect(tracks.get('right')?.getPolygonFeatures(0)).toHaveLength(1);
});

it.each(['box', 'line'] as const)('populates a new %s on both cameras before measuring', async (sourceKind) => {
  const {
    service, tracks, source, error, stereo,
  } = harness();
  source.deleteFeature(0);
  const line: [number, number][] = [[30, 2], [20, 2]];
  source.setFeature({ frame: 0, keyframe: true, bounds: [20, 0, 30, 4] }, sourceKind === 'line' ? headTailFeatures(line) : []);
  mocks.predict.mockImplementation(async (key: string) => result([shape(key.includes(':left:') ? 20 : 10)]));
  const geometry = sourceKind === 'line'
    ? { source: 'line' as const, line }
    : { source: 'box' as const, bounds: [20, 0, 30, 4] as [number, number, number, number] };
  service.handleNewAnnotationGeometry({ ...event, ...geometry });
  await service.handleStereoAnnotationComplete(sourceKind === 'line'
    ? {
      ...event, type: 'line', line, key: 'HeadTails',
    }
    : { ...event, type: 'box', bounds: [20, 0, 30, 4] });
  expect(error).not.toHaveBeenCalled();
  expect(tracks.get('right')?.getFeature(0)[0]?.bounds).toEqual([10, 0, 20, 4]);
  tracks.forEach((track) => {
    expect(track.getPolygonFeatures(0)).toHaveLength(1);
    expect(track.getFeature(0)[0]?.head).toBeDefined();
    expect(track.getFeature(0)[0]?.attributes?.length).toBe(10);
  });
  if (sourceKind === 'line') expect(stereo.warpPoints).toHaveBeenCalledWith(line, 'left', 0, true);
  // The drawn box is the whole prompt: its two corners, no centre point
  if (sourceKind === 'box') expect(mocks.predict.mock.calls[0][2].pointLabels).toEqual([2, 3]);
});

it('uses mask interior positives and retains consistent seeds when some matches fail', async () => {
  const { service, stereo, error } = harness();
  stereo.warpPoints.mockImplementationOnce(async (points) => points.map(([x, y], i) => {
    if (i === 0) return null as never;
    return [x - (i === 1 ? 50 : 10), y];
  }));
  await service.handleStereoAnnotationComplete({ ...event, points: [[25, 2], [22, 2]], labels: [1, 0] });
  expect(error).not.toHaveBeenCalled();
  expect(stereo.warpPoints.mock.calls[0][0]).toHaveLength(5);
  expect(mocks.predict.mock.calls[0][2].pointLabels).toEqual([1, 1, 1]);
  expect(stereo.warpPoints).toHaveBeenCalledTimes(1);
});

it('rejects a target mask with over 2.5 times the source area before writing geometry', async () => {
  const { service, tracks, error } = harness();
  // Same maximum extent as the source, but area 100 instead of 40.
  mocks.predict.mockResolvedValue(result([{ exterior: [[10, 0], [21, 0], [21, 10], [10, 10]], holes: [] }]));
  await service.handleStereoAnnotationComplete(event);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('out of scale'));
  expect(tracks.has('right')).toBe(false);
});

it('exposes busy while auto-populate runs and cancel drops the in-flight job', async () => {
  const { service, error } = harness();
  let finish!: (response: SegmentationPredictResponse) => void;
  mocks.predict.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  expect(service.busy.value).toBe(false);
  service.handleNewAnnotationGeometry({
    camera: 'left', trackId: 1, frameNum: 0, source: 'box', bounds: [20, 0, 30, 4],
  });
  expect(service.busy.value).toBe(true);
  await vi.waitFor(() => expect(finish).toBeDefined());
  service.cancel();
  expect(service.busy.value).toBe(false);
  expect(mocks.dispose).toHaveBeenCalled();
  finish(result());
  await nextTick();
  expect(error).not.toHaveBeenCalled();
});
