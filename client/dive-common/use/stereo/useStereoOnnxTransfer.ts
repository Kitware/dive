/**
 * Client-side stereo transfer: when a detection is annotated on one camera,
 * warp it onto the other camera using the VIAME "match" ONNX model
 * ({@link StereoOnnxMatcher}) — no backend, so it works in both the web and
 * desktop DIVE builds.
 *
 * This mirrors the desktop backend stereo handler (ViewerLoader's
 * `handleStereoAnnotationComplete`) but runs the correspondence search in the
 * browser. It transfers bounding boxes (via their corners) and head/tail lines
 * (keypoints); polygons and segmentation seeds are intentionally out of scope.
 *
 * Pixel access and calibration/model loading are injected so this stays
 * platform-agnostic and unit-testable; the web ViewerLoader supplies the
 * concrete providers.
 */

import CameraStore from 'vue-media-annotator/CameraStore';
import Track from 'vue-media-annotator/track';
import { RectBounds } from 'vue-media-annotator/utils';
import { HeadPointKey, TailPointKey } from 'dive-common/recipes/headtail';
import type { StereoAnnotationCompleteParams } from '../useModeManager';
import { StereoOnnxMatcher, SearchRange } from './StereoOnnxMatcher';
import { StereoRig, invertRig } from './calibration';
import { rgbaToGray, RgbaImage } from './image';

export interface StereoOnnxTransferConfig {
  cameraStore: CameraStore;
  /** Names of all cameras (transfer only runs when there are at least two). */
  getMultiCamList: () => string[];
  /** Which DIVE camera corresponds to the rig's left (calibration) camera. */
  getLeftCameraName: () => string;
  /** Stereo calibration, or null if unavailable (transfer is then skipped). */
  getRig: () => Promise<StereoRig | null>;
  /** The (lazily created / cached) ONNX matcher, or null if unavailable. */
  getMatcher: () => Promise<StereoOnnxMatcher | null>;
  /** Full-resolution RGBA pixels for a camera's current frame, or null. */
  getFrame: (cameraName: string) => Promise<RgbaImage | null>;
  /** Disparity- or depth-based search range for the correspondence search. */
  getRange: () => SearchRange;
  threshold?: number;
  uniquenessRatio?: number;
  /** Called after a feature is written so the host can persist the change. */
  onChange?: (cameraName: string, track: Track) => void;
}

const BOX_PAD = 0.10;

export default function useStereoOnnxTransfer(config: StereoOnnxTransferConfig) {
  const {
    cameraStore, getMultiCamList, getLeftCameraName,
    getRig, getMatcher, getFrame, getRange,
  } = config;

  function getOrCreateTrack(trackId: number, sourceCamera: string, targetCamera: string, frameNum: number): Track | undefined {
    let track = cameraStore.getPossibleTrack(trackId, targetCamera);
    if (!track) {
      const targetStore = cameraStore.camMap.value.get(targetCamera)?.trackStore;
      const sourceTrack = cameraStore.getPossibleTrack(trackId, sourceCamera);
      const trackType = sourceTrack?.confidencePairs?.[0]?.[0] || 'unknown';
      track = targetStore?.add(frameNum, trackType, undefined, trackId);
    }
    return track;
  }

  function boundsFromPoints(pts: [number, number][], pad = 0): RectBounds {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const padX = (maxX - minX) * pad || (maxY - minY) * pad;
    const padY = (maxY - minY) * pad || (maxX - minX) * pad;
    return [minX - padX, minY - padY, maxX + padX, maxY + padY];
  }

  /**
   * Warp the just-completed annotation onto the other camera. No-op unless
   * there are two cameras, calibration + model are available, and the target
   * camera does not already have this track's feature at this frame (so the
   * initial warp happens once and manual corrections are never overwritten).
   */
  async function handleStereoAnnotationComplete(
    params: StereoAnnotationCompleteParams,
  ): Promise<boolean> {
    if (params.type !== 'box' && params.type !== 'line') return false;

    const cams = getMultiCamList();
    if (cams.length < 2) return false;
    const otherCamera = cams.find((c) => c !== params.camera);
    if (!otherCamera) return false;

    const existing = cameraStore.getPossibleTrack(params.trackId, otherCamera);
    if (existing && existing.getFeature(params.frameNum)[0] !== null) return false;

    const [rig0, matcher] = await Promise.all([getRig(), getMatcher()]);
    if (!rig0 || !matcher) return false;
    // Warp from the annotated camera to the other; orient the rig so the
    // annotated camera is the source ("left").
    const rig = params.camera === getLeftCameraName() ? rig0 : invertRig(rig0);

    const [srcFrame, tgtFrame] = await Promise.all([
      getFrame(params.camera), getFrame(otherCamera),
    ]);
    if (!srcFrame || !tgtFrame) return false;
    const srcGray = rgbaToGray(srcFrame);
    const tgtGray = rgbaToGray(tgtFrame);

    const warpOpts = {
      range: getRange(),
      threshold: config.threshold,
      uniquenessRatio: config.uniquenessRatio,
    };

    if (params.type === 'box') {
      const [x1, y1, x2, y2] = params.bounds;
      const corners: [number, number][] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
      const res = await matcher.warpPoints(corners, srcGray, tgtGray, rig, warpOpts);
      const ok = res.filter((r) => r.accepted).map((r) => [r.x, r.y] as [number, number]);
      if (ok.length < 2) return false; // need enough confident corners for a box
      const track = getOrCreateTrack(params.trackId, params.camera, otherCamera, params.frameNum);
      if (!track) return false;
      track.setFeature({
        frame: params.frameNum,
        flick: 0,
        keyframe: true,
        interpolate: false,
        bounds: boundsFromPoints(ok),
      });
      config.onChange?.(otherCamera, track);
      return true;
    }

    // params.type === 'line' (head/tail keypoints)
    const res = await matcher.warpPoints(params.line, srcGray, tgtGray, rig, warpOpts);
    if (!res[0].accepted || !res[1].accepted) return false;
    const p1: [number, number] = [res[0].x, res[0].y];
    const p2: [number, number] = [res[1].x, res[1].y];
    const geometry: GeoJSON.Feature[] = [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [p1, p2] },
        properties: { key: params.key },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p1 },
        properties: { key: HeadPointKey },
      },
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: p2 },
        properties: { key: TailPointKey },
      },
    ];
    const track = getOrCreateTrack(params.trackId, params.camera, otherCamera, params.frameNum);
    if (!track) return false;
    track.setFeature({
      frame: params.frameNum,
      flick: 0,
      keyframe: true,
      interpolate: false,
      bounds: boundsFromPoints([p1, p2], BOX_PAD),
    }, geometry as GeoJSON.Feature<GeoJSON.Geometry>[] as never);
    config.onChange?.(otherCamera, track);
    return true;
  }

  return { handleStereoAnnotationComplete };
}
