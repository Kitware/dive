import Track from 'vue-media-annotator/track';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import populateAnnotation from './autoPopulate';

function harness() {
  const track = new Track(1, { features: [{ frame: 0, keyframe: true, bounds: [0, 0, 10, 10] }] });
  const services = {
    getTrack: () => track,
    getMedia: vi.fn(async () => ({ imagePath: 'image.png', frameTime: 2 })),
    ensureReady: vi.fn(async () => undefined),
    predict: vi.fn(async () => ({
      id: 'request', success: true, polygon: [[0, 0], [10, 0], [10, 10]] as [number, number][],
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
  h.services.predict.mockResolvedValue({ id: 'request', success: true, polygon: [] });
  await expect(h.run()).rejects.toThrow('no mask');
  expect(h.services.keypoints).not.toHaveBeenCalled();
});

it('reports segmentation failures and does not mutate the annotation', async () => {
  const h = harness();
  h.services.predict.mockResolvedValue({ id: 'request', success: false, polygon: [] });
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
  h.services.predict.mockResolvedValueOnce({ id: 'request', success: true, polygon: [] });
  await expect(h.run()).rejects.toThrow('no mask');
  expect(await h.run()).toBe('applied');
  expect(h.track.getPolygonFeatures(0)).toHaveLength(1);
});
