import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { ref } from 'vue';
import {
  afterEach, beforeEach, describe, it, expect, vi,
} from 'vitest';
import { clientSettings } from 'dive-common/store/settings';
import { rigFromNpz, StereoRig } from '../calibration';
import { project } from '../triangulate';
import useStereoOnnxTransfer, { STEREO_USER_LINE_ATTR } from '../useStereoOnnxTransfer';
import useStereoOnnxWeb, { fetchFoundationModel, fromViewer } from '../../../../platform/web-girder/useStereoOnnxWeb';

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const loadRig = () => rigFromNpz(readFileSync(fixture('calibration.npz')));

const girderMocks = vi.hoisted(() => ({
  getDatasetCalibration: vi.fn(),
  girderGet: vi.fn(),
  getStereoFoundationModelSpec: vi.fn(),
  getStereoFoundationModel: vi.fn(),
}));

vi.mock('platform/web-girder/api/dataset.service', () => ({
  getDatasetCalibration: girderMocks.getDatasetCalibration,
}));
vi.mock('platform/web-girder/plugins/girder', () => ({
  default: { get: girderMocks.girderGet },
}));
vi.mock('platform/web-girder/api/configuration.service', () => ({
  getStereoFoundationModelSpec: girderMocks.getStereoFoundationModelSpec,
  getStereoFoundationModel: girderMocks.getStereoFoundationModel,
}));

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

/**
 * Every warp and every measurement calls getRig, and `dive_dataset/calibration`
 * resolves the item and can read the stored file server-side, so resolving it
 * once per dataset rather than once per annotation matters.
 */
describe('useStereoOnnxWeb calibration caching', () => {
  function makeStereo() {
    const viewer = {
      cameraStore: { getPossibleTrack: () => undefined, camMap: ref(new Map()) },
      multiCamList: ['left', 'right'],
    };
    return useStereoOnnxWeb({
      getViewer: () => viewer,
      getDatasetId: () => 'dataset-a',
    });
  }

  /** A box completion is the shortest path that reaches getRig. */
  const boxDrawn = {
    type: 'box' as const,
    camera: 'left',
    trackId: 1,
    frameNum: 0,
    bounds: [0, 0, 10, 10] as [number, number, number, number],
  };

  it('resolves the calibration item once per dataset, and again after invalidation', async () => {
    girderMocks.getDatasetCalibration.mockReset();
    girderMocks.girderGet.mockReset();
    girderMocks.getDatasetCalibration.mockResolvedValue({
      data: { itemId: 'item-1', originalName: 'calibration.npz' },
    });
    girderMocks.girderGet.mockResolvedValue({ data: readFileSync(fixture('calibration.npz')) });
    const autoCompute = clientSettings.stereoSettings.autoComputeOtherCamera;
    clientSettings.stereoSettings.autoComputeOtherCamera = true;
    try {
      const stereo = makeStereo();
      // The matcher cannot load in Node, so each warp fails after the rig is
      // read — which is exactly the part under test.
      await stereo.handleStereoAnnotationComplete(boxDrawn);
      await stereo.handleStereoAnnotationComplete(boxDrawn);
      expect(girderMocks.getDatasetCalibration).toHaveBeenCalledTimes(1);
      expect(girderMocks.girderGet).toHaveBeenCalledTimes(1);

      stereo.invalidateCalibration();
      await stereo.handleStereoAnnotationComplete(boxDrawn);
      expect(girderMocks.getDatasetCalibration).toHaveBeenCalledTimes(2);
      expect(girderMocks.girderGet).toHaveBeenCalledTimes(2);
    } finally {
      clientSettings.stereoSettings.autoComputeOtherCamera = autoCompute;
    }
  });

  it('keeps looking for a calibration the dataset does not have yet', async () => {
    girderMocks.getDatasetCalibration.mockReset();
    girderMocks.girderGet.mockReset();
    girderMocks.getDatasetCalibration.mockResolvedValue({ data: null });
    const autoCompute = clientSettings.stereoSettings.autoComputeOtherCamera;
    clientSettings.stereoSettings.autoComputeOtherCamera = true;
    try {
      const stereo = makeStereo();
      await stereo.handleStereoAnnotationComplete(boxDrawn);
      await stereo.handleStereoAnnotationComplete(boxDrawn);
      expect(girderMocks.getDatasetCalibration).toHaveBeenCalledTimes(2);
    } finally {
      clientSettings.stereoSettings.autoComputeOtherCamera = autoCompute;
    }
  });
});

/**
 * The foundation export is around 100 MB, so it is kept in the browser's Cache
 * API across page loads and its download drives a determinate bar rather than a
 * spinner that reads as a hang.
 */
describe('fetchFoundationModel', () => {
  const SPEC = {
    name: 'fast-fdn-stereo.onnx',
    url: 'https://viame.example/onnx/fast-fdn-stereo.onnx',
    md5: 'd41d8cd98f00b204e9800998ecf8427e',
    height: 480,
    width: 640,
    size: 100 * 1024 * 1024,
  };
  const ORIGIN = 'https://dive.example';
  const cacheUrl = (md5: string, name = SPEC.name) => `${ORIGIN}/dive-stereo-models/${md5}/${name}`;

  /** Stands in for the Cache API, which Node does not provide. */
  function stubCaches() {
    const store = new Map<string, Response>();
    const cache = {
      match: async (url: string) => store.get(url),
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (request: { url: string }) => store.delete(request.url),
      put: async (url: string, response: Response) => { store.set(url, response); },
    };
    vi.stubGlobal('caches', { open: async () => cache });
    return store;
  }

  beforeEach(() => {
    // The cache key is built from the page origin.
    vi.stubGlobal('window', { location: { origin: ORIGIN } });
    girderMocks.getStereoFoundationModelSpec.mockReset();
    girderMocks.getStereoFoundationModelSpec.mockResolvedValue({ data: SPEC });
    girderMocks.getStereoFoundationModel.mockReset();
    girderMocks.getStereoFoundationModel.mockResolvedValue({ data: new ArrayBuffer(8) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports transferred bytes against the response length', async () => {
    girderMocks.getStereoFoundationModel.mockImplementation(async (_imagery, onProgress) => {
      onProgress(2_000_000, 8_000_000);
      onProgress(8_000_000, 8_000_000);
      return { data: new ArrayBuffer(8) };
    });
    const onProgress = vi.fn();

    await fetchFoundationModel(undefined, onProgress);

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { loaded: 2_000_000, total: 8_000_000 },
      { loaded: 8_000_000, total: 8_000_000 },
    ]);
  });

  it('falls back to the spec size when the response length is not computable', async () => {
    // A proxy that re-encodes the stream drops Content-Length, so axios reports
    // no total and the percentage would otherwise be uncomputable.
    girderMocks.getStereoFoundationModel.mockImplementation(async (_imagery, onProgress) => {
      onProgress(2_000_000, undefined);
      return { data: new ArrayBuffer(8) };
    });
    const onProgress = vi.fn();

    await fetchFoundationModel(undefined, onProgress);

    expect(onProgress).toHaveBeenCalledWith({ loaded: 2_000_000, total: SPEC.size });
  });

  it('serves a cached export without downloading it again', async () => {
    const store = stubCaches();
    store.set(cacheUrl(SPEC.md5), new Response(new Uint8Array([1, 2, 3, 4])));
    const onProgress = vi.fn();

    const { bytes, spec } = await fetchFoundationModel(undefined, onProgress);

    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(spec).toEqual(SPEC);
    expect(girderMocks.getStereoFoundationModel).not.toHaveBeenCalled();
    // Nothing was transferred, so the host keeps showing the spinner.
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('drops the stale copy of a re-published export but keeps other sizes', async () => {
    const store = stubCaches();
    store.set(cacheUrl('0000000000000000000000000000dead'), new Response(new ArrayBuffer(2)));
    const otherSize = cacheUrl('1111111111111111111111111111beef', 'fast-fdn-stereo-1280.onnx');
    store.set(otherSize, new Response(new ArrayBuffer(2)));

    await fetchFoundationModel();

    expect([...store.keys()].sort()).toEqual([otherSize, cacheUrl(SPEC.md5)].sort());
  });

  it('still returns the bytes when the export cannot be cached', async () => {
    const store = stubCaches();
    // Quota is the realistic failure for a 100 MB entry, and it must not cost
    // the user the download they already paid for.
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async () => undefined,
        keys: async () => [...store.keys()].map((url) => ({ url })),
        delete: async () => true,
        put: async () => { throw new Error('QuotaExceededError'); },
      }),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      const { bytes } = await fetchFoundationModel();
      expect(bytes.byteLength).toBe(8);
    } finally {
      warn.mockRestore();
    }
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
    invalidateMeasurement: (frame: number) => {
      const f = features.get(frame);
      if (f) {
        delete f.fishLength;
        delete f.attributes.length;
        f.attributes.measurement_stale = true;
      }
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

function makeHarness(rig: StereoRig, matcher: unknown = null) {
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
    getMatcher: async () => matcher as never,
    getFrame: async () => (matcher ? { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4) } : null),
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

it('remeasures a curved line without pairing vertex indices across views', async () => {
  const k = Float32Array.from([100, 0, 100, 0, 100, 100, 0, 0, 1]);
  const rig: StereoRig = {
    Kl: k,
    Kr: k,
    distl: new Float32Array(8),
    distr: new Float32Array(8),
    R: Float32Array.from(IDENTITY),
    T: Float32Array.from([-1, 0, 0]),
  };
  const matcher = { warpPoints: vi.fn(async (points: [number, number][]) => points.map(([x, y]) => ({ x: x - 10, y, accepted: true }))) };
  const { tracks, transfer, onMeasurement } = makeHarness(rig, matcher);
  const left = makeTrack(1); const right = makeTrack(1);
  tracks.left.set(1, left); tracks.right.set(1, right);
  const line: [number, number][] = [[80, 80], [110, 110], [140, 80]];
  setLine(left, 0, line);
  setLine(right, 0, [[70, 80], [85, 95], [100, 110], [130, 80]]);
  await transfer.handleStereoAnnotationComplete({
    type: 'line', camera: 'left', trackId: 1, frameNum: 0, line, key: 'HeadTails',
  });
  const result = onMeasurement.mock.calls[0][0];
  expect(result.curved_length).toBeCloseTo(6 * Math.sqrt(2), 4);
  expect(result.straight_length).toBeCloseTo(6, 4);
  expect(left.features[0].attributes.measurement_stale).toBe(false);
  expect(matcher.warpPoints.mock.calls[0][0].length).toBeGreaterThan(line.length);
});
