/**
 * Web wiring for client-side stereo transfer (warp a detection to the other
 * camera and triangulate its length) using the selected correspondence model.
 * Assembles the platform providers that {@link useStereoOnnxTransfer} needs:
 *  - calibration, taken from the session's file stash when the user just
 *    imported one and otherwise downloaded from the dataset's Girder folder,
 *  - the matcher for the selected method (lazily created and cached),
 *  - per-camera frame pixels, read from the GeoJS viewer for the frame on
 *    screen and fetched from the frame's image URL for any other frame.
 *
 * The NCC model is a static asset (`/models/stereo_match.onnx`, produced with
 * `plugins/onnx/export_stereo_mapping.py --model match`). The foundation model
 * is the export VIAME publishes in its FAST-FDN-STEREO add-on: the girder
 * server resolves it from VIAME's add-on list and serves it, and the bytes are
 * kept in the browser's Cache API keyed by the add-on's md5 so a page reload
 * does not re-download ~100 MB. If no calibration or model is available the
 * transfer reports the failure and no-ops.
 *
 * Because the foundation method costs one network pass per frame rather than
 * per point, its disparity map is computed as soon as the viewer lands on a
 * frame, so the warp itself is quick when the user draws.
 */

import { watch } from 'vue';

import { clientSettings } from 'dive-common/store/settings';
import useStereoOnnxTransfer from 'dive-common/use/stereo/useStereoOnnxTransfer';
import { StereoOnnxMatcher } from 'dive-common/use/stereo/StereoOnnxMatcher';
import { StereoFoundationMatcher } from 'dive-common/use/stereo/StereoFoundationMatcher';
import type { FoundationModelSpec } from 'dive-common/use/stereo/StereoFoundationMatcher';
import { DEFAULT_STEREO_MATCH_METHOD } from 'dive-common/use/stereo/stereoMatcher';
import type { StereoMatcher, StereoMatchMethod } from 'dive-common/use/stereo/stereoMatcher';
import type { SearchRange } from 'dive-common/use/stereo/StereoOnnxMatcher';
import {
  rigFromNpz, rigFromJson, StereoRig,
} from 'dive-common/use/stereo/calibration';
import { geoViewerToImageElement, imageElementToRgba } from 'dive-common/use/stereo/frameSource';
import type { RgbaImage } from 'dive-common/use/stereo/image';
import type { StereoMeasurement } from 'dive-common/use/stereo/triangulate';
import { getCalibrationFile, getLastCalibration } from './multicamFileRegistry';

const DEFAULT_MODEL_URL = '/models/stereo_match.onnx';
/** Browser cache holding the foundation model bytes across page loads. */
const MODEL_CACHE_NAME = 'dive-stereo-models';
// Mirrors epipolar_min_disparity / epipolar_max_disparity in VIAME's
// configs/pipelines/interactive_stereo_template.conf, which is what the desktop
// interactive stereo service loads. Scene-dependent, and hidden config there
// too; override per rig via the `range` option.
const DEFAULT_RANGE: SearchRange = { minDisparity: 2, maxDisparity: 300 };

export interface StereoOnnxWebOptions {
  /** Returns the mounted Viewer instance (exposes cameraStore, multiCamList,
   * aggregateController, imageData). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getViewer: () => any;
  /** Dataset (folder) id used to look up the stored calibration. */
  getDatasetId: () => string;
  modelUrl?: string;
  /**
   * Serve the foundation model from a fixed URL instead of the girder
   * endpoint; `foundationModelSpec` (the export's sidecar `image_size`) is then
   * required.
   */
  foundationModelUrl?: string;
  foundationModelSpec?: FoundationModelSpec;
  /** Overrides the user's dropdown choice; mainly for tests. */
  getMatchMethod?: () => StereoMatchMethod;
  range?: SearchRange;
  onStatus?: (message: string | null) => void;
  onError?: (message: string) => void;
  onMeasurement?: (measurement: StereoMeasurement) => void;
  ensureMeasurementAttributes?: () => void;
  onChange?: (cameraName: string) => void;
}

/**
 * Read a value the Viewer exposed from `setup()`. Vue unwraps refs on the
 * component instance, so `viewer.multiCamList` is the array itself — the same
 * way the desktop ViewerLoader reads it. Tolerates a raw ref so this also works
 * against an unwrapped setup object (e.g. in tests).
 */
export function fromViewer<T>(value: T | { value: T } | undefined): T | undefined {
  if (value && typeof value === 'object' && 'value' in (value as object)) {
    return (value as { value: T }).value;
  }
  return value as T | undefined;
}

/** Decode an image URL into RGBA pixels, tolerating cross-origin-free same-site media. */
async function urlToRgba(url: string): Promise<RgbaImage | null> {
  try {
    const img = new Image();
    img.crossOrigin = 'use-credentials';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Could not load ${url}`));
      img.src = url;
    });
    return imageElementToRgba(img);
  } catch {
    return null;
  }
}

async function openModelCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  try {
    return await caches.open(MODEL_CACHE_NAME);
  } catch {
    return null;
  }
}

/**
 * The foundation model bytes for the export the server currently serves. The
 * md5 comes from VIAME's add-on list, so a re-published export changes the
 * cache key and the stale copy is dropped.
 */
async function fetchFoundationModel(): Promise<{ bytes: ArrayBuffer; spec: FoundationModelSpec }> {
  // Imported lazily: the girder client touches `window` at load time, which
  // breaks node-environment unit tests that import this file.
  const { getStereoFoundationModelSpec, getStereoFoundationModel } = await import(
    'platform/web-girder/api/configuration.service'
  );
  const { data: spec } = await getStereoFoundationModelSpec();
  const cacheUrl = `${window.location.origin}/dive-stereo-models/${spec.md5}/${spec.name}`;
  const cache = await openModelCache();
  if (cache) {
    const hit = await cache.match(cacheUrl);
    if (hit) return { bytes: await hit.arrayBuffer(), spec };
  }
  const { data: bytes } = await getStereoFoundationModel();
  if (cache) {
    try {
      const keys = await cache.keys();
      await Promise.all(keys.map((request) => cache.delete(request)));
      await cache.put(cacheUrl, new Response(bytes, {
        headers: { 'Content-Type': 'application/octet-stream' },
      }));
    } catch (err) {
      console.warn('[StereoOnnx] could not cache the foundation model', err);
    }
  }
  return { bytes, spec };
}

export default function useStereoOnnxWeb(opts: StereoOnnxWebOptions) {
  const modelUrl = opts.modelUrl ?? DEFAULT_MODEL_URL;
  // Cached per method: switching the dropdown must not reload the other model,
  // and a method that failed to load must not be retried on every warp.
  const matchers: Partial<Record<StereoMatchMethod, Promise<StereoMatcher | null>>> = {};
  let rig: StereoRig | null = null;
  let rigKey: string | null = null;

  function currentMethod(): StereoMatchMethod {
    if (opts.getMatchMethod) return opts.getMatchMethod();
    return clientSettings.stereoSettings.matchMethod ?? DEFAULT_STEREO_MATCH_METHOD;
  }

  async function createFoundationMatcher(): Promise<StereoMatcher> {
    if (opts.foundationModelUrl) {
      if (!opts.foundationModelSpec) {
        throw new Error('foundationModelSpec is required with foundationModelUrl');
      }
      return StereoFoundationMatcher.create(opts.foundationModelUrl, opts.foundationModelSpec);
    }
    opts.onStatus?.('Loading the stereo model (about 100 MB on first use)...');
    try {
      const { bytes, spec } = await fetchFoundationModel();
      return await StereoFoundationMatcher.create(new Uint8Array(bytes), {
        height: spec.height, width: spec.width,
      });
    } finally {
      opts.onStatus?.(null);
    }
  }

  function getMatcher(): Promise<StereoMatcher | null> {
    const method = currentMethod();
    const existing = matchers[method];
    if (existing) return existing;
    const created = (method === 'foundation'
      ? createFoundationMatcher()
      : StereoOnnxMatcher.create(modelUrl)
    ).catch((err) => {
      console.warn('[StereoOnnx] failed to load model', method, err);
      opts.onError?.(`The stereo matching model could not be loaded. ${(err as Error).message ?? err}`);
      return null;
    });
    matchers[method] = created;
    return created;
  }

  function parseRig(name: string, buffer: ArrayBuffer): Promise<StereoRig> {
    if (name.toLowerCase().endsWith('.json')) {
      return Promise.resolve(rigFromJson(JSON.parse(new TextDecoder().decode(buffer))));
    }
    return rigFromNpz(buffer);
  }

  /** The calibration file the user chose in this browser session, if any. */
  async function rigFromSession(): Promise<StereoRig | null> {
    const name = await getLastCalibration();
    if (!name) return null;
    const file = getCalibrationFile(name);
    if (!file) return null;
    if (rig && rigKey === `session:${name}`) return rig;
    rig = await parseRig(name, await file.arrayBuffer());
    rigKey = `session:${name}`;
    return rig;
  }

  /**
   * The calibration stored on the dataset. Downloading the source item keeps the
   * client on exactly the file the pipelines use, so a page reload no longer
   * loses the rig.
   */
  async function rigFromDataset(): Promise<StereoRig | null> {
    const datasetId = opts.getDatasetId();
    if (!datasetId) return null;
    // Imported lazily: these modules touch `window` at load time, which breaks
    // node-environment unit tests that import this file.
    const [{ getDatasetCalibration }, { default: girderRest }] = await Promise.all([
      import('platform/web-girder/api/dataset.service'),
      import('platform/web-girder/plugins/girder'),
    ]);
    const { data } = await getDatasetCalibration(datasetId);
    const itemId = data?.itemId ?? data?.jsonItemId;
    if (!itemId) return null;
    if (rig && rigKey === `item:${itemId}`) return rig;
    const name = (data.itemId ? data.originalName : data.jsonPath)
      ?? data.originalName ?? data.jsonPath ?? '';
    const response = await girderRest.get(`item/${itemId}/download`, { responseType: 'arraybuffer' });
    rig = await parseRig(name, response.data as ArrayBuffer);
    rigKey = `item:${itemId}`;
    return rig;
  }

  async function getRig(): Promise<StereoRig | null> {
    try {
      const fromSession = await rigFromSession();
      if (fromSession) return fromSession;
    } catch (err) {
      console.warn('[StereoOnnx] failed to parse the session calibration', err);
    }
    try {
      return await rigFromDataset();
    } catch (err) {
      console.warn('[StereoOnnx] failed to load the dataset calibration', err);
      return null;
    }
  }

  async function getFrame(cameraName: string, frameNum: number): Promise<RgbaImage | null> {
    const viewer = opts.getViewer();
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aggregate = fromViewer<any>(viewer?.aggregateController);
      const controller = aggregate?.getController(cameraName);
      // The viewer only holds pixels for the frame on screen.
      if (controller?.frame?.value === frameNum) {
        const geoViewer = controller?.geoViewerRef?.value;
        const img = geoViewer ? geoViewerToImageElement(geoViewer) : null;
        if (img) return imageElementToRgba(img);
      }
    } catch {
      // Fall through to the URL path.
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageData = fromViewer<any>(viewer?.imageData);
    const url = imageData?.[cameraName]?.[frameNum]?.url;
    return url ? urlToRgba(url) : null;
  }

  /** The frame the viewer is on, once its media has loaded. */
  function currentFrame(): number | undefined {
    const viewer = opts.getViewer();
    if (!viewer?.progress?.loaded) return undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return fromViewer<any>(viewer.aggregateController)?.frame?.value;
    } catch {
      return undefined;
    }
  }

  // ViewerLoader is reused across /viewer/:id navigations while <Viewer :key="id">
  // remounts, so never close over a specific Viewer — rebuild when cameraStore
  // identity changes, and resolve multiCamList via getViewer() each call.
  let transfer: ReturnType<typeof useStereoOnnxTransfer> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let transferCameraStore: any = null;

  function getTransfer() {
    const viewer = opts.getViewer();
    if (!viewer?.cameraStore) return null;
    if (!transfer || transferCameraStore !== viewer.cameraStore) {
      transferCameraStore = viewer.cameraStore;
      transfer = useStereoOnnxTransfer({
        cameraStore: viewer.cameraStore,
        getMultiCamList: () => fromViewer<string[]>(opts.getViewer()?.multiCamList) ?? [],
        getLeftCameraName: () => (fromViewer<string[]>(opts.getViewer()?.multiCamList) ?? [])[0],
        getRig,
        getMatcher,
        getFrame,
        getRange: () => opts.range ?? DEFAULT_RANGE,
        autoCompute: () => clientSettings.stereoSettings.autoComputeOtherCamera,
        measureLengths: () => clientSettings.stereoSettings.updateLengthsOnModify,
        onChange: (cameraName) => opts.onChange?.(cameraName),
        onStatus: opts.onStatus,
        onError: opts.onError,
        onMeasurement: opts.onMeasurement,
        ensureMeasurementAttributes: opts.ensureMeasurementAttributes,
      });
    }
    return transfer;
  }

  /**
   * Only the foundation method has per-frame work to do ahead of time, and only
   * when warps will actually happen (auto-compute on, two cameras).
   */
  function precomputeWanted(): boolean {
    return currentMethod() === 'foundation'
      && clientSettings.stereoSettings.autoComputeOtherCamera
      && (fromViewer<string[]>(opts.getViewer()?.multiCamList) ?? []).length >= 2;
  }

  // A precompute failure is the model failing on this browser/GPU, which the
  // user should hear about once rather than on every frame change.
  let precomputeErrorReported = false;

  /** Compute the current frame's disparity maps ahead of any warp there. */
  function precomputeCurrentFrame() {
    const frame = currentFrame();
    if (frame === undefined || !precomputeWanted()) return;
    getTransfer()?.precomputeFrame(frame, () => currentFrame() === frame && precomputeWanted())
      .catch((err) => {
        console.warn('[StereoOnnx] disparity precompute failed', err);
        if (!precomputeErrorReported) {
          precomputeErrorReported = true;
          opts.onError?.(`The higher-accuracy stereo model could not run in this browser. ${(err as Error).message ?? err}`);
        }
      });
  }

  watch(
    () => [currentFrame(), precomputeWanted()] as const,
    ([frame, wanted]) => {
      if (frame !== undefined && wanted) precomputeCurrentFrame();
    },
  );

  type Transfer = ReturnType<typeof useStereoOnnxTransfer>;

  async function handleStereoAnnotationComplete(
    params: Parameters<Transfer['handleStereoAnnotationComplete']>[0],
  ) {
    return getTransfer()?.handleStereoAnnotationComplete(params) ?? 'skipped';
  }

  async function handleStereoTrackLinked(trackId: number) {
    return getTransfer()?.handleStereoTrackLinked(trackId);
  }

  async function warpAllFromCamera(cameraName: string) {
    return getTransfer()?.warpAllFromCamera(cameraName);
  }

  return {
    handleStereoAnnotationComplete,
    handleStereoTrackLinked,
    warpAllFromCamera,
    precomputeCurrentFrame,
  };
}
