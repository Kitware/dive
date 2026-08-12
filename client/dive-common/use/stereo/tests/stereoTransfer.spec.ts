import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ref } from 'vue';
// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  describe, it, expect, vi,
} from 'vitest';
import { rigFromNpz, StereoRig } from '../calibration';
import { project } from '../triangulate';
import useStereoOnnxTransfer, { STEREO_USER_LINE_ATTR } from '../useStereoOnnxTransfer';
import useStereoOnnxWeb, { fromViewer } from '../../../../platform/web-girder/useStereoOnnxWeb';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const loadRig = () => rigFromNpz(readFileSync(fixture('calibration.npz')));

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO = [0, 0, 0];

/**
 * Vue unwraps setup() refs on a component instance, so the Viewer exposes
 * `multiCamList` as a bare array. Reading `.value` off it yielded undefined,
 * which silently reduced every stereo op to a no-op.
 */
describe('fromViewer', () => {
  it('reads a value the Viewer instance already unwrapped', () => {
    expect(fromViewer<string[]>(['left', 'right'])).toEqual(['left', 'right']);
  });
  it('still reads a raw ref', () => {
    expect(fromViewer<string[]>(ref(['left', 'right']) as never)).toEqual(['left', 'right']);
  });
  it('passes undefined through', () => {
    expect(fromViewer<string[]>(undefined)).toBeUndefined();
  });
});

/**
 * ViewerLoader is reused across /viewer/:id while <Viewer :key="id"> remounts.
 * The web glue must not keep writing into the destroyed Viewer's cameraStore.
 */
describe('useStereoOnnxWeb viewer rebinding', () => {
  it('rebuilds transfer when the Viewer cameraStore identity changes', async () => {
    const forEachA = vi.fn();
    const forEachB = vi.fn();
    const storeA = {
      getPossibleTrack: vi.fn(),
      camMap: ref(new Map([
        ['left', { trackStore: { annotationMap: { forEach: forEachA } } }],
      ])),
    };
    const storeB = {
      getPossibleTrack: vi.fn(),
      camMap: ref(new Map([
        ['left', { trackStore: { annotationMap: { forEach: forEachB } } }],
      ])),
    };
    let viewer: { cameraStore: typeof storeA; multiCamList: string[] } = {
      cameraStore: storeA, multiCamList: ['left', 'right'],
    };
    const stereo = useStereoOnnxWeb({
      getViewer: () => viewer,
      getDatasetId: () => 'dataset-a',
    });

    await stereo.warpAllFromCamera('left');
    expect(forEachA).toHaveBeenCalled();
    expect(forEachB).not.toHaveBeenCalled();

    viewer = { cameraStore: storeB, multiCamList: ['left', 'right'] };
    await stereo.warpAllFromCamera('left');
    expect(forEachB).toHaveBeenCalled();
  });
});

interface FakeFeature {
  keyframe: boolean;
  attributes: Record<string, unknown>;
  geometry?: { features: GeoJSON.Feature[] };
  fishLength?: number;
}

/** Duck-typed stand-in for a Track, carrying just what the transfer touches. */
function makeTrack(id: number) {
  const features = new Map<number, FakeFeature>();
  const attributes: Record<string, unknown> = {};
  const track = {
    id,
    confidencePairs: [['fish', 1]],
    attributes,
    get featureIndex() { return [...features.keys()]; },
    get features() {
      return Object.fromEntries(features) as unknown as Record<number, FakeFeature>;
    },
    getFeature: (frame: number) => [features.get(frame) ?? null],
    setFeature: (f: { frame: number; fishLength?: number }, geometry?: GeoJSON.Feature[]) => {
      const existing = features.get(f.frame);
      features.set(f.frame, {
        keyframe: true,
        attributes: existing?.attributes ?? {},
        geometry: geometry ? { features: geometry } : existing?.geometry,
        fishLength: f.fishLength ?? existing?.fishLength,
      });
    },
    setFeatureAttribute: (frame: number, key: string, value: unknown) => {
      const f = features.get(frame);
      if (f) f.attributes[key] = value;
    },
    setAttribute: (key: string, value: unknown) => { attributes[key] = value; },
  };
  return track;
}

/** Give a track a head/tail line at a frame, as the line recipe would. */
function setLine(track: ReturnType<typeof makeTrack>, frame: number, line: [number, number][]) {
  track.setFeature({ frame }, [{
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: line },
    properties: { key: 'HeadTails' },
  }] as GeoJSON.Feature[]);
}

function makeHarness(rig: StereoRig) {
  const tracks: Record<string, Map<number, ReturnType<typeof makeTrack>>> = {
    left: new Map(), right: new Map(),
  };
  const cameraStore = {
    getPossibleTrack: (id: number, camera: string) => tracks[camera]?.get(id),
    camMap: ref(new Map([
      ['left', { trackStore: { annotationMap: tracks.left, add: () => makeTrack(1) } }],
      ['right', { trackStore: { annotationMap: tracks.right, add: () => makeTrack(1) } }],
    ])),
  };
  const onMeasurement = vi.fn();
  const onError = vi.fn();
  const transfer = useStereoOnnxTransfer({
    cameraStore: cameraStore as never,
    getMultiCamList: () => ['left', 'right'],
    getLeftCameraName: () => 'left',
    getRig: async () => rig,
    // Both cameras already carry a human line, so no warp runs in these cases.
    getMatcher: async () => null,
    getFrame: async () => null,
    getRange: () => ({ minDisparity: 2, maxDisparity: 300 }),
    autoCompute: () => false,
    measureLengths: () => true,
    onMeasurement,
    onError,
  });
  return {
    transfer, tracks, onMeasurement, onError,
  };
}

describe('useStereoOnnxTransfer measurement', () => {
  it('writes length attributes once both cameras have a line', async () => {
    const rig = await loadRig();
    const { transfer, tracks, onMeasurement } = makeHarness(rig);

    // A 200-unit segment 2 m out, as each camera actually sees it.
    const head: [number, number, number] = [-100, 0, 2000];
    const tail: [number, number, number] = [100, 0, 2000];
    const leftLine = [head, tail].map((p) => project(p, rig.Kl, rig.distl, IDENTITY, ZERO));
    const rightLine = [head, tail].map((p) => project(p, rig.Kr, rig.distr, rig.R, rig.T));

    const leftTrack = makeTrack(1);
    const rightTrack = makeTrack(1);
    tracks.left.set(1, leftTrack);
    tracks.right.set(1, rightTrack);
    setLine(leftTrack, 0, leftLine);

    // Drawing on the left alone measures nothing: only one camera has a line.
    await transfer.handleStereoAnnotationComplete({
      type: 'line', camera: 'left', trackId: 1, frameNum: 0, line: leftLine as never, key: 'HeadTails',
    });
    expect(leftTrack.getFeature(0)[0]?.attributes.length).toBeUndefined();

    // Now the right camera gets its line, completing the pair.
    setLine(rightTrack, 0, rightLine);
    await transfer.handleStereoAnnotationComplete({
      type: 'line', camera: 'right', trackId: 1, frameNum: 0, line: rightLine as never, key: 'HeadTails',
    });

    [leftTrack, rightTrack].forEach((track) => {
      const attrs = track.getFeature(0)[0]?.attributes as Record<string, number>;
      expect(attrs.length).toBeCloseTo(200, 1);
      expect(attrs.midpoint_range).toBeCloseTo(2000, 0);
      expect(attrs.stereo_rms).toBeLessThan(0.01);
      expect(track.getFeature(0)[0]?.fishLength).toBeCloseTo(200, 1);
      expect(track.attributes.avg_length).toBeCloseTo(200, 1);
    });
    expect(onMeasurement).toHaveBeenCalled();
  });

  it('marks a human-drawn line so the warp cannot overwrite it', async () => {
    const rig = await loadRig();
    const { transfer, tracks } = makeHarness(rig);
    const leftTrack = makeTrack(1);
    tracks.left.set(1, leftTrack);
    setLine(leftTrack, 0, [[10, 10], [20, 20]]);
    await transfer.handleStereoAnnotationComplete({
      type: 'line', camera: 'left', trackId: 1, frameNum: 0, line: [[10, 10], [20, 20]] as never, key: 'HeadTails',
    });
    expect(leftTrack.getFeature(0)[0]?.attributes[STEREO_USER_LINE_ATTR]).toBe(true);
  });

  it('reports a missing calibration instead of silently doing nothing', async () => {
    const rig = await loadRig();
    const { tracks, onError } = makeHarness(rig);
    const noRig = useStereoOnnxTransfer({
      cameraStore: {
        getPossibleTrack: (id: number, camera: string) => tracks[camera]?.get(id),
        camMap: ref(new Map()),
      } as never,
      getMultiCamList: () => ['left', 'right'],
      getLeftCameraName: () => 'left',
      getRig: async () => null,
      getMatcher: async () => null,
      getFrame: async () => null,
      getRange: () => ({ minDisparity: 2, maxDisparity: 300 }),
      autoCompute: () => false,
      measureLengths: () => true,
      onError,
    });
    const leftTrack = makeTrack(1);
    const rightTrack = makeTrack(1);
    tracks.left.set(1, leftTrack);
    tracks.right.set(1, rightTrack);
    setLine(leftTrack, 0, [[10, 10], [20, 20]]);
    setLine(rightTrack, 0, [[12, 10], [22, 20]]);

    await noRig.handleStereoAnnotationComplete({
      type: 'line', camera: 'right', trackId: 1, frameNum: 0, line: [[12, 10], [22, 20]] as never, key: 'HeadTails',
    });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('calibration'));
  });
});
