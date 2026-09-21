import type { SegmentationPredictResponse } from 'dive-common/apispec';
import Track from 'vue-media-annotator/track';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import populateAnnotation from './autoPopulate';

function harness() {
  const track = new Track(1, { features: [{ frame: 0, keyframe: true, bounds: [0, 0, 10, 10] }] });
  const services = {
    getTrack: () => track,
    getMedia: vi.fn(async () => ({ imagePath: 'image.png', frameTime: 2 })),
    ensureReady: vi.fn(async (): Promise<void> => undefined),
    predict: vi.fn(async (): Promise<SegmentationPredictResponse> => ({
      success: true, polygon: [[0, 0], [10, 0], [10, 10]] as [number, number][],
    })),
    keypoints: vi.fn(async () => ({ success: true, head: [1, 1] as [number, number], tail: [9, 9] as [number, number] })),
  };
  const run = () => populateAnnotation({
    camera: 'singleCam', trackId: 1, frameNum: 0, source: 'box', bounds: [0, 0, 10, 10],
  }, { mask: true, points: true }, services);
  return { track, services, run };
}

it('reports an empty mask instead of silently completing', async () => {
  const h = harness();
  h.services.predict.mockResolvedValue({ success: true, polygon: [] });
  await expect(h.run()).rejects.toThrow('no mask');
  expect(h.services.keypoints).not.toHaveBeenCalled();
});

it('reports segmentation failures and does not mutate the annotation', async () => {
  const h = harness();
  h.services.predict.mockResolvedValue({ success: false, polygon: [] });
  await expect(h.run()).rejects.toThrow('Segmentation failed');
  expect(h.track.getFeature(0)[0]?.geometry).toBeUndefined();
});

it('keeps a successful mask when keypoint extraction throws', async () => {
  const h = harness();
  h.services.keypoints.mockRejectedValue(new Error('Model unavailable'));
  await expect(h.run()).rejects.toThrow('Mask added, but head/tail extraction failed: Model unavailable');
  expect(h.track.getPolygonFeatures(0)).toHaveLength(1);
  expect(h.track.getFeature(0)[0]?.bounds).toEqual([0, 0, 10, 10]);
});

it('reports an unsuccessful keypoint response while retaining the mask', async () => {
  const h = harness();
  h.services.keypoints.mockResolvedValue({ success: false, head: [0, 0], tail: [0, 0] });
  await expect(h.run()).rejects.toThrow('Mask added, but head/tail extraction failed');
  expect(h.track.getPolygonFeatures(0)).toHaveLength(1);
});

it('writes the mask before waiting for points and preserves edits made during that wait', async () => {
  const h = harness();
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  let started!: () => void;
  const startedPoints = new Promise<void>((resolve) => { started = resolve; });
  h.services.keypoints.mockImplementation(async () => {
    started();
    await waiting;
    return { success: true, head: [1, 1], tail: [9, 9] };
  });
  const job = h.run();
  await startedPoints;
  expect(h.track.getPolygonFeatures(0)).toHaveLength(1);
  h.track.setFeature({ frame: 0, bounds: [20, 20, 30, 30] }, headTailFeatures([[21, 21], [29, 29]]));
  finish();
  expect(await job).toBe('changed');
  expect(h.track.getFeature(0)[0]?.bounds).toEqual([20, 20, 30, 30]);
  expect(h.track.getFeature(0)[0]?.head).toEqual([21, 21]);
});

it('waits for media and initialization, then supplies the captured video time', async () => {
  const h = harness();
  let ready!: () => void;
  h.services.ensureReady.mockImplementation(() => new Promise<void>((resolve) => { ready = resolve; }));
  const job = h.run();
  await Promise.resolve();
  expect(h.services.predict).not.toHaveBeenCalled();
  ready();
  expect(await job).toBe('applied');
  expect(h.services.predict).toHaveBeenCalledWith(expect.objectContaining({ imagePath: 'image.png', frameTime: 2 }));
  expect(h.track.getPolygonFeatures(0)).toHaveLength(1);
  expect(h.track.getFeature(0)[0]?.head).toEqual([1, 1]);
});

it('can populate a later annotation after a prediction returns no mask', async () => {
  const h = harness();
  h.services.predict.mockResolvedValueOnce({ success: true, polygon: [] });
  await expect(h.run()).rejects.toThrow('no mask');
  expect(await h.run()).toBe('applied');
  expect(h.track.getPolygonFeatures(0)).toHaveLength(1);
});

const components = [
  { exterior: [[0, 0], [10, 0], [10, 10]] as [number, number][], holes: [[[2, 2], [4, 2], [4, 4]] as [number, number][]] },
  { exterior: [[20, 0], [30, 0], [30, 10]] as [number, number][], holes: [] },
];

it('preserves all components and holes on one fish and uses the full mask for points', async () => {
  const h = harness();
  h.services.predict.mockResolvedValue({ success: true, polygons: components });
  expect(await h.run()).toBe('applied');
  const polygons = h.track.getPolygonFeatures(0);
  expect(polygons).toHaveLength(2);
  expect(polygons[0].geometry.coordinates).toEqual([
    [...components[0].exterior, components[0].exterior[0]],
    [...components[0].holes[0], components[0].holes[0][0]],
  ]);
  expect(polygons[1].geometry.coordinates).toEqual([
    [...components[1].exterior, components[1].exterior[0]],
  ]);
  expect(polygons[0].key).not.toBe(polygons[1].key);
  expect(h.services.keypoints).toHaveBeenCalledWith(components[0].exterior, components);
  expect(h.track.getFeature(0)[0]?.head).toEqual([1, 1]);
});

it('prefers the full mask over the legacy polygon and retains it when points fail', async () => {
  const h = harness();
  h.services.predict.mockResolvedValue({
    success: true, polygon: components[0].exterior, polygons: components,
  });
  h.services.keypoints.mockRejectedValue(new Error('Unavailable'));
  await expect(h.run()).rejects.toThrow('Mask added');
  expect(h.track.getPolygonFeatures(0)).toHaveLength(2);
});

it('uses every component for line-derived bounds even if legacy bounds cover only one', async () => {
  const h = harness();
  h.services.predict.mockResolvedValue({
    success: true, polygons: components, bounds: [0, 0, 10, 10],
  });
  expect(await populateAnnotation({
    camera: 'singleCam',
    trackId: 1,
    frameNum: 0,
    source: 'line',
    line: [[0, 0], [30, 10]],
  }, { mask: true, points: true }, h.services)).toBe('applied');
  expect(h.track.getFeature(0)[0]?.bounds).toEqual([0, 0, 30, 10]);
  expect(h.track.getPolygonFeatures(0)).toHaveLength(2);
  expect(h.services.keypoints).not.toHaveBeenCalled();
});

it('refits a stereo-mapped box to a mask that landed elsewhere, but keeps one the mask agrees with', async () => {
  const far = harness();
  far.services.predict.mockResolvedValue({ success: true, polygon: [[30, 30], [50, 30], [50, 50], [30, 50]] });
  expect(await populateAnnotation({
    camera: 'right', trackId: 1, frameNum: 0, source: 'box', bounds: [0, 0, 10, 10],
  }, { mask: true, points: false, fitBoxToMask: true }, far.services)).toBe('applied');
  expect(far.track.getFeature(0)[0]?.bounds).toEqual([30, 30, 50, 50]);

  const near = harness();
  near.services.predict.mockResolvedValue({ success: true, polygon: [[1, 1], [9, 1], [9, 9], [1, 9]] });
  await populateAnnotation({
    camera: 'right', trackId: 1, frameNum: 0, source: 'box', bounds: [0, 0, 10, 10],
  }, { mask: true, points: false, fitBoxToMask: true }, near.services);
  expect(near.track.getFeature(0)[0]?.bounds).toEqual([0, 0, 10, 10]);

  const drawn = harness();
  drawn.services.predict.mockResolvedValue({ success: true, polygon: [[30, 30], [50, 30], [50, 50], [30, 50]] });
  await populateAnnotation({
    camera: 'left', trackId: 1, frameNum: 0, source: 'box', bounds: [0, 0, 10, 10],
  }, { mask: true, points: false }, drawn.services);
  expect(drawn.track.getFeature(0)[0]?.bounds).toEqual([0, 0, 10, 10]);
});

it('derives head/tail for a point-segmented mask without predicting again', async () => {
  const h = harness();
  h.track.setFeature({ frame: 0, keyframe: true }, [{
    type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] }, properties: { key: 'SegmentationPolygon' },
  }]);
  expect(await populateAnnotation({
    camera: 'singleCam', trackId: 1, frameNum: 0, source: 'mask', polygons: components,
  }, { mask: true, points: true }, h.services)).toBe('applied');
  expect(h.services.predict).not.toHaveBeenCalled();
  expect(h.services.getMedia).not.toHaveBeenCalled();
  expect(h.services.keypoints).toHaveBeenCalledWith(components[0].exterior, components);
  expect(h.track.getFeature(0)[0]?.head).toEqual([1, 1]);
  expect(h.track.getPolygonFeatures(0)).toHaveLength(1);

  const lined = harness();
  lined.track.setFeature({ frame: 0, keyframe: true }, headTailFeatures([[2, 2], [8, 8]]));
  await populateAnnotation({
    camera: 'singleCam', trackId: 1, frameNum: 0, source: 'mask', polygons: components,
  }, { mask: true, points: true }, lined.services);
  expect(lined.services.keypoints).not.toHaveBeenCalled();
  expect(lined.track.getFeature(0)[0]?.head).toEqual([2, 2]);
});

it('segments from given prompt points, boxes the mask, and reports it even when nothing is stored', async () => {
  const h = harness();
  const onMask = vi.fn();
  h.services.predict.mockResolvedValue({ success: true, polygons: components });
  expect(await populateAnnotation({
    camera: 'right', trackId: 1, frameNum: 0, source: 'points', points: [[3, 3], [25, 5]],
  }, { mask: false, points: false, onMask }, h.services)).toBe('applied');
  expect(h.services.predict).toHaveBeenCalledWith(expect.objectContaining({
    points: [[3, 3], [25, 5]], pointLabels: [1, 1], multimaskOutput: false,
  }));
  expect(onMask).toHaveBeenCalledWith(components);
  expect(h.track.getFeature(0)[0]?.bounds).toEqual([0, 0, 30, 10]);
  expect(h.track.getPolygonFeatures(0)).toHaveLength(0);
  expect(h.services.keypoints).not.toHaveBeenCalled();
});

it('extracts points from all components when storing the mask is disabled', async () => {
  const h = harness();
  h.services.predict.mockResolvedValue({ success: true, polygons: components });
  await populateAnnotation({
    camera: 'singleCam', trackId: 1, frameNum: 0, source: 'box', bounds: [0, 0, 30, 10],
  }, { mask: false, points: true }, h.services);
  expect(h.track.getPolygonFeatures(0)).toHaveLength(0);
  expect(h.services.keypoints).toHaveBeenCalledWith(components[0].exterior, components);
});
