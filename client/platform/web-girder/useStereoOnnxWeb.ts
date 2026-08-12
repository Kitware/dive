/**
 * Web wiring for client-side stereo transfer (warp a detection to the other
 * camera and triangulate its length) using the VIAME "match" ONNX model.
 * Assembles the platform providers that {@link useStereoOnnxTransfer} needs:
 *  - calibration, taken from the session's file stash when the user just
 *    imported one and otherwise downloaded from the dataset's Girder folder,
 *  - the ONNX matcher (lazily created from a served model asset),
 *  - per-camera frame pixels, read from the GeoJS viewer for the frame on
 *    screen and fetched from the frame's image URL for any other frame.
 *
 * The exported model must be served as a static asset (default
 * `/models/stereo_match.onnx`; produce it with
 * `plugins/onnx/export_stereo_mapping.py --model match`). If no calibration or
 * model is available the transfer reports the failure and no-ops.
 */

import { clientSettings } from 'dive-common/store/settings';
import useStereoOnnxTransfer from 'dive-common/use/stereo/useStereoOnnxTransfer';
import { StereoOnnxMatcher } from 'dive-common/use/stereo/StereoOnnxMatcher';
import type { SearchRange } from 'dive-common/use/stereo/StereoOnnxMatcher';
import {
  rigFromNpz, rigFromJson, StereoRig,
} from 'dive-common/use/stereo/calibration';
import { geoViewerToImageElement, imageElementToRgba } from 'dive-common/use/stereo/frameSource';
import type { RgbaImage } from 'dive-common/use/stereo/image';
import type { StereoMeasurement } from 'dive-common/use/stereo/triangulate';
import { getCalibrationFile, getLastCalibration } from './multicamFileRegistry';

const DEFAULT_MODEL_URL = '/models/stereo_match.onnx';
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

export default function useStereoOnnxWeb(opts: StereoOnnxWebOptions) {
  const modelUrl = opts.modelUrl ?? DEFAULT_MODEL_URL;
  let matcher: StereoOnnxMatcher | null = null;
  let matcherTried = false;
  let rig: StereoRig | null = null;
  let rigKey: string | null = null;

  async function getMatcher(): Promise<StereoOnnxMatcher | null> {
    if (!matcher && !matcherTried) {
      matcherTried = true;
      try {
        matcher = await StereoOnnxMatcher.create(modelUrl);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[StereoOnnx] failed to load model', modelUrl, err);
        matcher = null;
      }
    }
    return matcher;
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
      // eslint-disable-next-line no-console
      console.warn('[StereoOnnx] failed to parse the session calibration', err);
    }
    try {
      return await rigFromDataset();
    } catch (err) {
      // eslint-disable-next-line no-console
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

  return { handleStereoAnnotationComplete, handleStereoTrackLinked, warpAllFromCamera };
}
