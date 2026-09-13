import {
  it, expect, vi,
} from 'vitest';
import { ref } from 'vue';
import Track from 'vue-media-annotator/track';
import { headTailFeatures } from 'vue-media-annotator/headTail';
import {
  applyMappedPoint, namedPoint, canMapPoint, linePointEdit,
} from '../keypointTransfer';
import useStereoOnnxTransfer from '../useStereoOnnxTransfer';
import { StereoRig } from '../calibration';

const pointFeature = (key: string, point: [number, number]): GeoJSON.Feature<GeoJSON.Point> => ({
  type: 'Feature', properties: { key }, geometry: { type: 'Point', coordinates: point },
});
function makeTrack() {
  const track = new Track(1, { begin: 0, end: 0, meta: {} });
  track.setFeature({
    frame: 0, keyframe: true, bounds: [10, 10, 100, 100], attributes: { species: 'fish' },
  });
  return track;
}
function harness(enabled = true) {
  const tracks = new Map([['left', makeTrack()], ['right', makeTrack()]]);
  const k = Float32Array.from([100, 0, 100, 0, 100, 100, 0, 0, 1]);
  const rig: StereoRig = {
    Kl: k,
    Kr: k,
    distl: new Float32Array(8),
    distr: new Float32Array(8),
    R: Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    T: Float32Array.from([-1, 0, 0]),
  };
  const warpPoints = vi.fn(async (points: [number, number][], _a: unknown, _b: unknown, r: StereoRig) => points.map(([x, y]) => ({ x: x + (r.T[0] < 0 ? -10 : 10), y, accepted: true })));
  const onChange = vi.fn();
  const onError = vi.fn();
  const cameraStore = {
    getPossibleTrack: (_id: number, camera: string) => tracks.get(camera),
    camMap: ref(new Map(['left', 'right'].map((camera) => [camera, {
      trackStore: {
        add: () => {
          const t = makeTrack(); tracks.set(camera, t); return t;
        },
      },
    }]))),
  };
  const transfer = useStereoOnnxTransfer({
    cameraStore: cameraStore as never,
    getMultiCamList: () => ['left', 'right'],
    getLeftCameraName: () => 'left',
    getRig: async () => rig,
    getMatcher: async () => ({ warpPoints }) as never,
    getFrame: async () => ({ width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4) }),
    getRange: () => ({ minDisparity: 1, maxDisparity: 100 }),
    autoCompute: () => enabled,
    onChange,
    onError,
  });
  return {
    tracks, transfer, warpPoints, onChange, onError,
  };
}
const request = (camera = 'left', key = 'eye', point: [number, number] = [50.5, 60.25]) => ({
  type: 'point' as const, camera, key, point, trackId: 1, frameNum: 0,
});

it.each(['left', 'right'])('maps a named point from %s into an existing detection', async (camera) => {
  const h = harness();
  const other = camera === 'left' ? 'right' : 'left';
  h.tracks.get(camera)!.setFeature({ frame: 0 }, [pointFeature('eye', [50.5, 60.25])]);
  h.tracks.get(other)!.setFeature({ frame: 0 }, [pointFeature('fin', [40, 30])]);
  expect(await h.transfer.handleStereoAnnotationComplete(request(camera))).toBe('transferred');
  const mapped = namedPoint(h.tracks.get(other), 0, 'eye');
  expect(mapped?.geometry.coordinates).toEqual([camera === 'left' ? 40.5 : 60.5, 60.25]);
  expect(namedPoint(h.tracks.get(other), 0, 'fin')?.geometry.coordinates).toEqual([40, 30]);
  expect(h.tracks.get(other)!.features[0].bounds).toEqual([10, 10, 100, 100]);
  expect(h.tracks.get(other)!.features[0].attributes?.species).toBe('fish');
});
it('obeys the auto-map option', async () => {
  const h = harness(false);
  expect(await h.transfer.handleStereoAnnotationComplete(request())).toBe('skipped');
  expect(h.warpPoints).not.toHaveBeenCalled();
});
it('creates a target detection when necessary', async () => {
  const h = harness(); h.tracks.delete('right');
  h.tracks.get('left')!.setFeature({ frame: 0 }, [pointFeature('eye', [50.5, 60.25])]);
  expect(await h.transfer.handleStereoAnnotationComplete(request())).toBe('transferred');
  expect(namedPoint(h.tracks.get('right'), 0, 'eye')).toBeDefined();
});
it('preserves a manually edited target point', async () => {
  const h = harness();
  h.tracks.get('right')!.setFeature({ frame: 0 }, [pointFeature('eye', [20, 30])]);
  expect(await h.transfer.handleStereoAnnotationComplete(request())).toBe('skipped');
  expect(h.warpPoints).not.toHaveBeenCalled();
});
it('updates a previously generated point', async () => {
  const h = harness();
  applyMappedPoint(h.tracks.get('right')!, 0, 'eye', [20, 30], 'left');
  h.tracks.get('left')!.setFeature({ frame: 0 }, [pointFeature('eye', [50.5, 60.25])]);
  expect(await h.transfer.handleStereoAnnotationComplete(request())).toBe('transferred');
  expect(namedPoint(h.tracks.get('right'), 0, 'eye')?.geometry.coordinates).toEqual([40.5, 60.25]);
});
it('rejects an unmatched point without changing the target', async () => {
  const h = harness();
  h.warpPoints.mockResolvedValue([{ x: 0, y: 0, accepted: false }]);
  expect(await h.transfer.handleStereoAnnotationComplete(request())).toBe('failed');
  expect(namedPoint(h.tracks.get('right'), 0, 'eye')).toBeUndefined();
});
it.each(['source', 'target'])('discards a reply after the %s point changes', async (side) => {
  const h = harness();
  h.tracks.get('left')!.setFeature({ frame: 0 }, [pointFeature('eye', [50.5, 60.25])]);
  h.warpPoints.mockImplementation(async () => {
    h.tracks.get(side === 'source' ? 'left' : 'right')!.setFeature({ frame: 0 }, [pointFeature('eye', [75, 75])]);
    return [{ x: 40.5, y: 60.25, accepted: true }];
  });
  expect(await h.transfer.handleStereoAnnotationComplete(request())).toBe('skipped');
});
it('keeps generated spine points synchronized and editable', () => {
  const track = makeTrack();
  track.setFeature({ frame: 0 }, headTailFeatures([[20, 30], [40, 50], [80, 30]]));
  applyMappedPoint(track, 0, 'spine_001', [45, 55], 'left');
  expect(canMapPoint(track, 0, 'spine_001', 'left')).toBe(true);
  expect(track.getFeatureGeometry(0, { key: 'HeadTails' })[0].geometry.coordinates).toEqual([[20, 30], [45, 55], [80, 30]]);
  track.setFeature({ frame: 0 }, headTailFeatures([[20, 30], [46, 56], [80, 30]]));
  expect(canMapPoint(track, 0, 'spine_001', 'left')).toBe(false);
});

it('detects a new interior vertex as one point transfer', () => {
  expect(linePointEdit([[10, 20], [80, 20]], [[10, 20], [40, 35], [80, 20]])).toEqual({
    key: 'spine_001', point: [40, 35], insert: true,
  });
  expect(linePointEdit([[10, 20], [40, 35], [80, 20]], [[10, 20], [45, 40], [80, 20]])).toEqual({
    key: 'spine_001', point: [45, 40], insert: false,
  });
});
it('inserts a matched vertex into the nearest target segment, retaining its existing vertices', async () => {
  const h = harness();
  h.tracks.get('left')!.setFeature({ frame: 0 }, headTailFeatures([[10, 20], [70, 40], [100, 20]]));
  h.tracks.get('right')!.setFeature({ frame: 0 }, headTailFeatures([[0, 20], [30, 40], [90, 20]]));
  const outcome = await h.transfer.handleStereoAnnotationComplete({ ...request('left', 'spine_001', [70, 40]), insert: true });
  expect(outcome).toBe('transferred');
  expect(h.tracks.get('right')!.getFeatureGeometry(0, { key: 'HeadTails' })[0].geometry.coordinates).toEqual([[0, 20], [30, 40], [60, 40], [90, 20]]);
  // The two views have different vertex counts: remember the mapped marker's
  // origin instead of treating equal spine indices as matched physical points.
  h.tracks.get('left')!.setFeature({ frame: 0 }, headTailFeatures([[10, 20], [75, 45], [100, 20]]));
  expect(await h.transfer.handleStereoAnnotationComplete(request('left', 'spine_001', [75, 45]))).toBe('transferred');
  expect(h.tracks.get('right')!.getFeatureGeometry(0, { key: 'HeadTails' })[0].geometry.coordinates).toEqual([[0, 20], [30, 40], [65, 45], [90, 20]]);
});

it('keeps mapped vertices updateable after inserting an earlier vertex', async () => {
  const h = harness();
  const line: [number, number][] = [[20, 20], [70, 35], [100, 20]];
  h.tracks.get('left')!.setFeature({ frame: 0 }, headTailFeatures(line));
  expect(await h.transfer.handleStereoAnnotationComplete({
    type: 'line', camera: 'left', trackId: 1, frameNum: 0, key: 'HeadTails', line,
  })).toBe('transferred');
  expect(canMapPoint(h.tracks.get('right'), 0, 'spine_001', 'left')).toBe(true);
  h.tracks.get('left')!.setFeature({ frame: 0 }, headTailFeatures([[20, 20], [40, 30], [70, 35], [100, 20]]));
  expect(await h.transfer.handleStereoAnnotationComplete({ ...request('left', 'spine_001', [40, 30]), insert: true })).toBe('transferred');
  expect(canMapPoint(h.tracks.get('right'), 0, 'spine_002', 'left')).toBe(true);
  h.tracks.get('left')!.setFeature({ frame: 0 }, headTailFeatures([[20, 20], [40, 30], [75, 40], [100, 20]]));
  expect(await h.transfer.handleStereoAnnotationComplete(request('left', 'spine_002', [75, 40]))).toBe('transferred');
  expect(h.tracks.get('right')!.getFeatureGeometry(0, { key: 'HeadTails' })[0].geometry.coordinates).toEqual([[10, 20], [30, 30], [65, 40], [90, 20]]);
});
