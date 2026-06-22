/**
 * Web wiring for client-side stereo transfer (warp a detection from one camera
 * to the other) using the VIAME "match" ONNX model. Assembles the platform
 * providers that {@link useStereoOnnxTransfer} needs:
 *  - calibration from the session's loaded stereo calibration file,
 *  - the ONNX matcher (lazily created from a served model asset),
 *  - per-camera frame pixels read from the GeoJS viewers.
 *
 * The exported model must be served as a static asset (default
 * `/models/stereo_match.onnx`; produce it with
 * `plugins/onnx/export_stereo_mapping.py --model match`). If no calibration or
 * model is available the transfer simply no-ops.
 *
 * NOTE: exercised by unit tests at the core layer (the matcher / calibration /
 * image modules); this DOM- and Girder-coupled glue needs live testing in a
 * running web viewer with a real stereo dataset.
 */

import useStereoOnnxTransfer from 'dive-common/use/stereo/useStereoOnnxTransfer';
import { StereoOnnxMatcher } from 'dive-common/use/stereo/StereoOnnxMatcher';
import type { SearchRange } from 'dive-common/use/stereo/StereoOnnxMatcher';
import {
  rigFromNpz, rigFromJson, StereoRig,
} from 'dive-common/use/stereo/calibration';
import { geoViewerToImageElement, imageElementToRgba } from 'dive-common/use/stereo/frameSource';
import type { RgbaImage } from 'dive-common/use/stereo/image';
import { getCalibrationFile, getLastCalibration } from './multicamFileRegistry';

const DEFAULT_MODEL_URL = '/models/stereo_match.onnx';
// Scene-dependent; should be surfaced as a user setting. These are permissive
// defaults that cover a wide disparity range.
const DEFAULT_RANGE: SearchRange = { minDisparity: 2, maxDisparity: 512 };

export interface StereoOnnxWebOptions {
  /** Returns the mounted Viewer instance (exposes cameraStore, multiCamList,
   * aggregateController). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getViewer: () => any;
  modelUrl?: string;
  range?: SearchRange;
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

  async function getRig(): Promise<StereoRig | null> {
    const name = await getLastCalibration();
    if (!name) return null;
    if (rig && rigKey === name) return rig;
    const file = getCalibrationFile(name);
    if (!file) return null;
    try {
      if (name.toLowerCase().endsWith('.json')) {
        rig = rigFromJson(JSON.parse(await file.text()));
      } else {
        rig = await rigFromNpz(await file.arrayBuffer());
      }
      rigKey = name;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[StereoOnnx] failed to parse calibration', name, err);
      rig = null;
    }
    return rig;
  }

  async function getFrame(cameraName: string): Promise<RgbaImage | null> {
    try {
      const viewer = opts.getViewer();
      const controller = viewer?.aggregateController?.value?.getController(cameraName);
      const geoViewer = controller?.geoViewerRef?.value;
      const img = geoViewer ? geoViewerToImageElement(geoViewer) : null;
      return img ? imageElementToRgba(img) : null;
    } catch {
      return null;
    }
  }

  // The Viewer mounts after this composable runs, so build the transfer lazily
  // on the first event, once cameraStore is available.
  let transfer: ReturnType<typeof useStereoOnnxTransfer> | null = null;

  async function handleStereoAnnotationComplete(
    params: Parameters<ReturnType<typeof useStereoOnnxTransfer>['handleStereoAnnotationComplete']>[0],
  ): Promise<boolean> {
    if (!transfer) {
      const viewer = opts.getViewer();
      if (!viewer?.cameraStore) return false;
      transfer = useStereoOnnxTransfer({
        cameraStore: viewer.cameraStore,
        getMultiCamList: () => viewer.multiCamList?.value ?? [],
        getLeftCameraName: () => viewer.multiCamList?.value?.[0],
        getRig,
        getMatcher,
        getFrame,
        getRange: () => opts.range ?? DEFAULT_RANGE,
      });
    }
    return transfer.handleStereoAnnotationComplete(params);
  }

  return { handleStereoAnnotationComplete };
}
