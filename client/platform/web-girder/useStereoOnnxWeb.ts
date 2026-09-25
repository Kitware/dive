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
 * is the bare `.onnx` VIAME publishes under the FAST-FDN-STEREO-WEB row of its
 * add-on list: the girder server resolves and serves it, and the bytes are
 * kept in the browser's Cache API keyed by the row's md5 so a page reload does
 * not re-download ~100 MB. If no calibration or model is available the
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
import type { ImagerySize, StereoFoundationModelSpec } from 'platform/web-girder/api/configuration.service';
import { DEFAULT_STEREO_MATCH_METHOD, fallBackStereoMethod } from 'dive-common/use/stereo/stereoMatcher';
import type { StereoMatcher, StereoMatchMethod } from 'dive-common/use/stereo/stereoMatcher';
import type { SearchRange } from 'dive-common/use/stereo/StereoOnnxMatcher';
import {
  rigFromNpz, rigFromJson, StereoRig,
} from 'dive-common/use/stereo/calibration';
import { imageElementToRgba } from 'dive-common/use/stereo/frameSource';
import { findQuadMediaSource } from 'vue-media-annotator/components/layerManager/quadMediaSource';
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

/** Bytes transferred of the model download, for a determinate progress bar. */
export interface StereoModelProgress {
  loaded: number;
  total: number;
}

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
   * endpoint. `foundationModelSpec` overrides the input size read from the
   * graph.
   */
  foundationModelUrl?: string;
  foundationModelSpec?: FoundationModelSpec;
  /** Overrides the user's dropdown choice; mainly for tests. */
  getMatchMethod?: () => StereoMatchMethod;
  range?: SearchRange;
  /**
   * Progress message; null clears it. `progress` accompanies the messages whose
   * work has a known size, and the host shows a bar for those.
   */
  onStatus?: (message: string | null, progress?: StereoModelProgress) => void;
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
 * The foundation model bytes for the export the server picks for imagery of
 * `imagery` size. The md5 comes from VIAME's ONNX list, so a re-published
 * export changes the cache key and the stale copy of that export is dropped;
 * exports of other sizes stay cached.
 */
export async function fetchFoundationModel(
  imagery?: ImagerySize,
  onProgress?: (progress: StereoModelProgress) => void,
): Promise<{ bytes: ArrayBuffer; spec: StereoFoundationModelSpec }> {
  // Imported lazily: the girder client touches `window` at load time, which
  // breaks node-environment unit tests that import this file.
  const { getStereoFoundationModelSpec, getStereoFoundationModel } = await import(
    'platform/web-girder/api/configuration.service'
  );
  const { data: spec } = await getStereoFoundationModelSpec(imagery);
  const cacheUrl = `${window.location.origin}/dive-stereo-models/${spec.md5}/${spec.name}`;
  const cache = await openModelCache();
  if (cache) {
    const hit = await cache.match(cacheUrl);
    if (hit) return { bytes: await hit.arrayBuffer(), spec };
  }
  const { data: bytes } = await getStereoFoundationModel(imagery, (loaded, total) => {
    // The spec carries the export's byte size, so progress stays determinate
    // even when the response length is not.
    onProgress?.({ loaded, total: total || spec.size });
  });
  if (cache) {
    try {
      const keys = await cache.keys();
      await Promise.all(keys
        .filter((request) => request.url.endsWith(`/${spec.name}`))
        .map((request) => cache.delete(request)));
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
  // Cached per method (and, for the foundation model, per imagery size, since
  // the server picks the export by it): switching the dropdown must not reload
  // the other model, and a method that failed to load must not be retried on
  // every warp.
  const matchers: Record<string, Promise<StereoMatcher | null>> = {};
  let rig: StereoRig | null = null;
  let rigKey: string | null = null;
  /**
   * Which item holds the dataset's calibration. Cached because every warp and
   * every measurement calls {@link getRig}, while `dive_dataset/calibration`
   * resolves the item and may read and parse the stored file server-side.
   * Only a resolved item is remembered, so a dataset that has no calibration
   * yet is still picked up once the user attaches one.
   */
  let calibrationLookup: { datasetId: string; itemId: string; name: string } | null = null;

  function currentMethod(): StereoMatchMethod {
    if (opts.getMatchMethod) return opts.getMatchMethod();
    return clientSettings.stereoSettings.matchMethod ?? DEFAULT_STEREO_MATCH_METHOD;
  }

  /**
   * The chosen model failed on this browser or GPU. Drop the setting to the
   * faster method so it matches what actually runs, and say so in the
   * message. Returns whether the setting changed.
   */
  function fallBack(message: string): boolean {
    if (opts.getMatchMethod) {
      opts.onError?.(message);
      return false;
    }
    const before = currentMethod();
    const next = fallBackStereoMethod(before, message);
    clientSettings.stereoSettings.matchMethod = next.method;
    opts.onError?.(next.message);
    return next.method !== before;
  }

  async function createFoundationMatcher(imagery?: ImagerySize): Promise<StereoMatcher> {
    if (opts.foundationModelUrl) {
      return StereoFoundationMatcher.create(opts.foundationModelUrl, opts.foundationModelSpec);
    }
    // No download at all when the bytes are already in the browser's cache, so
    // the message only promises one until the first progress event arrives.
    opts.onStatus?.('Loading the stereo model (about 100 MB on first use)...');
    try {
      const { bytes, spec } = await fetchFoundationModel(
        imagery,
        (progress) => opts.onStatus?.('Downloading the stereo model...', progress),
      );
      // Building the session compiles the graph for the GPU, which takes
      // seconds and reports no progress of its own.
      opts.onStatus?.('Preparing the stereo model...');
      // A bare .onnx has no sidecar; the matcher then reads the size from the graph.
      const size = spec.height && spec.width ? { height: spec.height, width: spec.width } : undefined;
      return await StereoFoundationMatcher.create(new Uint8Array(bytes), size);
    } finally {
      opts.onStatus?.(null);
    }
  }

  function getMatcher(imagery?: ImagerySize): Promise<StereoMatcher | null> {
    const method = currentMethod();
    const key = method === 'foundation' && imagery
      ? `${method}:${imagery.width}x${imagery.height}`
      : method;
    const existing = matchers[key];
    if (existing) return existing;
    const created = (method === 'foundation'
      ? createFoundationMatcher(imagery)
      : StereoOnnxMatcher.create(modelUrl)
    ).catch((err) => {
      console.warn('[StereoOnnx] failed to load model', method, err);
      const what = method === 'foundation' ? 'The higher quality stereo model' : 'The stereo matching model';
      const message = `${what} could not be loaded. ${(err as Error).message ?? err}`;
      if (fallBack(message)) {
        // Retried if the user picks this method again later.
        delete matchers[key];
        return getMatcher(imagery);
      }
      return null;
    });
    matchers[key] = created;
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

  /** The item holding the dataset's calibration, from the cache when known. */
  async function calibrationItem(datasetId: string) {
    if (calibrationLookup?.datasetId === datasetId) return calibrationLookup;
    // Imported lazily: this module touches `window` at load time, which breaks
    // node-environment unit tests that import this file.
    const { getDatasetCalibration } = await import('platform/web-girder/api/dataset.service');
    const { data } = await getDatasetCalibration(datasetId);
    const itemId = data?.itemId ?? data?.jsonItemId;
    if (!itemId) return null;
    const name = (data.itemId ? data.originalName : data.jsonPath)
      ?? data.originalName ?? data.jsonPath ?? '';
    calibrationLookup = { datasetId, itemId, name };
    return calibrationLookup;
  }

  /**
   * The calibration stored on the dataset. Downloading the source item keeps the
   * client on exactly the file the pipelines use, so a page reload no longer
   * loses the rig.
   */
  async function rigFromDataset(): Promise<StereoRig | null> {
    const datasetId = opts.getDatasetId();
    if (!datasetId) return null;
    const item = await calibrationItem(datasetId);
    if (!item) return null;
    if (rig && rigKey === `item:${item.itemId}`) return rig;
    const { default: girderRest } = await import('platform/web-girder/plugins/girder');
    const response = await girderRest.get(`item/${item.itemId}/download`, { responseType: 'arraybuffer' });
    rig = await parseRig(item.name, response.data as ArrayBuffer);
    rigKey = `item:${item.itemId}`;
    return rig;
  }

  /**
   * Forget the cached calibration, so the next warp resolves and downloads it
   * again. The host calls this when the dataset's calibration file is replaced
   * or removed.
   */
  function invalidateCalibration() {
    calibrationLookup = null;
    rig = null;
    rigKey = null;
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
    // URLs identify the requested frame even while the viewer is still
    // displaying the previous image during an asynchronous seek.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageData = fromViewer<any>(viewer?.imageData);
    const url = imageData?.[cameraName]?.[frameNum]?.url;
    if (url) return urlToRgba(url);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aggregate = fromViewer<any>(viewer?.aggregateController);
      const controller = aggregate?.getController(cameraName);
      // Read unscaled native pixels, including video, never an overlay screenshot.
      if (controller?.frame?.value === frameNum && controller?.hasFrame?.value !== false) {
        const media = findQuadMediaSource(controller?.geoViewerRef?.value);
        if (media && media.width && media.height) {
          if (media.kind === 'video' && ((media.source as HTMLVideoElement).seeking
            || (media.source as HTMLVideoElement).readyState < 2)) return null;
          const canvas = document.createElement('canvas');
          canvas.width = media.width; canvas.height = media.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(media.source, 0, 0, media.width, media.height);
            return ctx.getImageData(0, 0, media.width, media.height);
          }
        }
      }
    } catch {
      // Media is unavailable during teardown or while a frame is loading.
    }
    return null;
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
  watch(currentMethod, () => { precomputeErrorReported = false; });

  /** Compute the current frame's disparity maps ahead of any warp there. */
  function precomputeCurrentFrame() {
    const frame = currentFrame();
    if (frame === undefined || !precomputeWanted()) return;
    getTransfer()?.precomputeFrame(frame, () => currentFrame() === frame && precomputeWanted())
      .catch((err) => {
        console.warn('[StereoOnnx] disparity precompute failed', err);
        if (!precomputeErrorReported) {
          precomputeErrorReported = true;
          fallBack(`The higher quality stereo model could not run in this browser. ${(err as Error).message ?? err}`);
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
    const operation = async () => getTransfer()?.handleStereoAnnotationComplete(params) ?? 'skipped';
    return opts.getViewer()?.runAnnotationOperation?.(operation) ?? operation();
  }

  async function handleStereoTrackLinked(trackId: number) {
    const operation = async () => getTransfer()?.handleStereoTrackLinked(trackId);
    return opts.getViewer()?.runAnnotationOperation?.(operation) ?? operation();
  }

  async function warpAllFromCamera(cameraName: string) {
    return getTransfer()?.warpAllFromCamera(cameraName);
  }

  async function stereoViewLink(params: { camera: string; frameNum: number; point: [number, number] }) {
    if (!clientSettings.stereoSettings.autoComputeOtherCamera) return null;
    return (await getTransfer()?.warpPoint(params.point, params.camera, params.frameNum)) ?? null;
  }

  return {
    handleStereoAnnotationComplete,
    handleStereoTrackLinked,
    warpAllFromCamera,
    getFrame,
    warpPoints: async (points: [number, number][], camera: string, frame: number, line = false) => (
      getTransfer()?.warpPoints(points, camera, frame, line) ?? []
    ),
    refreshMeasurement: async (id: number, frame: number) => getTransfer()?.refreshMeasurement(id, frame),
    stereoViewLink,
    precomputeCurrentFrame,
    invalidateCalibration,
  };
}
