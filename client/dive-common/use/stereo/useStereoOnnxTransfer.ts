/**
 * Client-side stereo transfer: when a detection is annotated on one camera,
 * warp it onto the other camera using the VIAME "match" ONNX model
 * ({@link StereoOnnxMatcher}) — no backend, so it works in both the web and
 * desktop DIVE builds.
 *
 * This mirrors the desktop backend stereo handler (ViewerLoader's
 * `handleStereoAnnotationComplete`) but runs the correspondence search and the
 * triangulation in the browser. Boxes, head/tail lines and polygons transfer;
 * segmentation seeds need SAM and so remain a backend-only feature.
 *
 * Pixel access and calibration/model loading are injected so this stays
 * platform-agnostic and unit-testable; the web ViewerLoader supplies the
 * concrete providers.
 */

import CameraStore from 'vue-media-annotator/CameraStore';
import Track from 'vue-media-annotator/track';
import { RectBounds } from 'vue-media-annotator/utils';
import { HeadPointKey, TailPointKey, HeadTailLineKey } from 'dive-common/recipes/headtail';
import type { StereoAnnotationCompleteParams } from '../useModeManager';
import { StereoOnnxMatcher, SearchRange } from './StereoOnnxMatcher';
import { StereoRig, invertRig } from './calibration';
import { rgbaToGray, RgbaImage } from './image';
import { measureLine, aggregateLengths, StereoMeasurement } from './triangulate';

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
  /** Full-resolution RGBA pixels for a camera at a frame, or null. */
  getFrame: (cameraName: string, frameNum: number) => Promise<RgbaImage | null>;
  /** Disparity- or depth-based search range for the correspondence search. */
  getRange: () => SearchRange;
  threshold?: number;
  uniquenessRatio?: number;
  /** Warp an annotation onto the camera that has no detection for it yet. */
  autoCompute?: () => boolean;
  /** Triangulate and store length attributes once both cameras have a line. */
  measureLengths?: () => boolean;
  /** Called after a feature is written so the host can persist the change. */
  onChange?: (cameraName: string, track: Track) => void;
  /** Progress message while a transfer runs; null clears it. */
  onStatus?: (message: string | null) => void;
  /** Surfaced failure, mirroring the desktop stereo error dialog. */
  onError?: (message: string) => void;
  /** Reports the latest computed measurement for a transient notification. */
  onMeasurement?: (measurement: StereoMeasurement) => void;
  /** Register the measurement attribute definitions before the first write. */
  ensureMeasurementAttributes?: () => void;
}

const BOX_PAD = 0.10;
const MAX_BOX_ASPECT_RATIO = 6;

/**
 * Per-feature marker: a human (not the stereo warp) authored this camera's line
 * at this frame. Once set, the warp never overwrites that side's geometry.
 */
export const STEREO_USER_LINE_ATTR = 'stereo_user_line';
/** 'stereo' = auto-computed from the warped lines, 'user_set' = locked by the user. */
export const STEREO_LENGTH_METHOD_ATTR = 'length_method';
export const STEREO_MEASUREMENT_ATTRS = [
  'length', 'midpoint_x', 'midpoint_y', 'midpoint_z', 'midpoint_range', 'stereo_rms',
] as const;

type Point = [number, number];
type Line = [Point, Point];

const round2 = (v: number) => Math.round(v * 100) / 100;

export default function useStereoOnnxTransfer(config: StereoOnnxTransferConfig) {
  const {
    cameraStore, getMultiCamList, getLeftCameraName,
    getRig, getMatcher, getFrame, getRange,
  } = config;

  const autoCompute = () => config.autoCompute?.() ?? true;
  const measureLengths = () => config.measureLengths?.() ?? false;

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

  /**
   * Bounds around a point set. `pad` expands by a fraction of the extent and
   * `capAspect` grows the short side so a near-axis-aligned line does not become
   * a razor-thin box (matching headtail.ts).
   */
  function boundsFromPoints(pts: Point[], pad = 0, capAspect = false): RectBounds {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    const padX = (maxX - minX) * pad || (maxY - minY) * pad;
    const padY = (maxY - minY) * pad || (maxX - minX) * pad;
    let [x0, y0, x1, y1] = [minX - padX, minY - padY, maxX + padX, maxY + padY];
    if (capAspect) {
      const w = x1 - x0;
      const h = y1 - y0;
      if (w > 0 && h > 0) {
        if (w / h > MAX_BOX_ASPECT_RATIO) {
          const grow = (w / MAX_BOX_ASPECT_RATIO - h) / 2;
          y0 -= grow;
          y1 += grow;
        } else if (h / w > MAX_BOX_ASPECT_RATIO) {
          const grow = (h / MAX_BOX_ASPECT_RATIO - w) / 2;
          x0 -= grow;
          x1 += grow;
        }
      }
    }
    return [x0, y0, x1, y1];
  }

  function lineEndpoints(track: Track | undefined, frameNum: number): Line | null {
    if (!track) return null;
    const [feature] = track.getFeature(frameNum);
    const features = feature?.geometry?.features;
    if (!features) return null;
    const lineFeat = features.find(
      (f) => f.geometry.type === 'LineString'
        && (f.geometry.coordinates as Point[]).length === 2,
    );
    if (!lineFeat) return null;
    const c = lineFeat.geometry.coordinates as unknown as Point[];
    return [c[0], c[1]];
  }

  /** Replace a track feature's head/tail line, preserving any other geometry. */
  function applyLine(track: Track | undefined, frameNum: number, line: Line, key?: string) {
    if (!track) return;
    const [feature] = track.getFeature(frameNum);
    const [p1, p2] = line;
    const preserved = (feature?.geometry?.features ?? []).filter((f) => {
      if (f.geometry.type === 'LineString') return false;
      const k = f.properties?.key;
      return k !== HeadPointKey && k !== TailPointKey;
    });
    const geometry: GeoJSON.Feature[] = [
      ...preserved,
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: line },
        properties: { key: key ?? HeadTailLineKey },
      },
      { type: 'Feature', geometry: { type: 'Point', coordinates: p1 }, properties: { key: HeadPointKey } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: p2 }, properties: { key: TailPointKey } },
    ];
    track.setFeature({
      frame: frameNum,
      flick: 0,
      keyframe: true,
      interpolate: false,
      bounds: boundsFromPoints([p1, p2], BOX_PAD, true),
    }, geometry as GeoJSON.Feature<GeoJSON.Geometry>[] as never);
  }

  /**
   * Store a measurement on a feature: length goes to the canonical fishLength
   * (the VIAME CSV length column) plus a 'length' attribute; the rest become
   * detection attributes. A length the user locked is never overwritten.
   */
  function applyMeasurement(track: Track | undefined, frameNum: number, m: StereoMeasurement) {
    if (!track) return;
    const [feature] = track.getFeature(frameNum);
    const lengthLocked = feature?.attributes?.[STEREO_LENGTH_METHOD_ATTR] === 'user_set';
    if (!lengthLocked && Number.isFinite(m.length) && feature?.keyframe) {
      track.setFeature({ frame: frameNum, fishLength: round2(m.length) });
      track.setFeatureAttribute(frameNum, STEREO_LENGTH_METHOD_ATTR, 'stereo');
    }
    STEREO_MEASUREMENT_ATTRS.forEach((name) => {
      if (name === 'length' && lengthLocked) return;
      const v = m[name as keyof StereoMeasurement];
      if (Number.isFinite(v)) track.setFeatureAttribute(frameNum, name, round2(v));
    });
  }

  function updateTrackAverage(track: Track | undefined) {
    if (!track) return;
    const lengths: number[] = [];
    track.featureIndex.forEach((frame) => {
      const feature = track.features[frame];
      const attr = feature?.attributes?.length;
      const fromAttr = attr !== undefined && attr !== null ? Number(attr) : NaN;
      const length = Number.isFinite(fromAttr) ? fromAttr : feature?.fishLength;
      if (Number.isFinite(length)) lengths.push(length as number);
    });
    const avg = aggregateLengths(lengths);
    if (avg !== null) track.setAttribute('avg_length', round2(avg));
  }

  function updateTrackAverages(trackId: number) {
    getMultiCamList().forEach((camera) => {
      updateTrackAverage(cameraStore.getPossibleTrack(trackId, camera));
    });
  }

  /**
   * Triangulate the head/tail lines both cameras hold at this frame and write
   * the measurement to each. The rig is always oriented with the calibration's
   * left camera first, independent of which camera the user drew on.
   */
  async function measureAtFrame(trackId: number, frameNum: number): Promise<StereoMeasurement | null> {
    const cams = getMultiCamList();
    if (cams.length < 2) return null;
    const leftCamera = getLeftCameraName();
    const rightCamera = cams.find((c) => c !== leftCamera);
    if (!rightCamera) return null;

    const leftTrack = cameraStore.getPossibleTrack(trackId, leftCamera);
    const rightTrack = cameraStore.getPossibleTrack(trackId, rightCamera);
    const leftLine = lineEndpoints(leftTrack, frameNum);
    const rightLine = lineEndpoints(rightTrack, frameNum);
    // Only one camera has a line yet: a normal in-progress state, not a failure.
    if (!leftLine || !rightLine) return null;

    // Past this point the user has done everything needed, so anything missing
    // is a real problem worth surfacing rather than a silent no-op.
    const rig = await getRig();
    if (!rig) throw new Error('No stereo calibration is available for this dataset.');

    const measurement = measureLine(rig, leftLine, rightLine);
    if (!measurement) {
      throw new Error('The two lines could not be triangulated; check that the calibration matches these cameras.');
    }
    config.ensureMeasurementAttributes?.();
    applyMeasurement(leftTrack, frameNum, measurement);
    applyMeasurement(rightTrack, frameNum, measurement);
    if (leftTrack) config.onChange?.(leftCamera, leftTrack);
    if (rightTrack) config.onChange?.(rightCamera, rightTrack);
    return measurement;
  }

  async function measureAndReport(trackId: number, frameNum: number) {
    const measurement = await measureAtFrame(trackId, frameNum);
    if (measurement) {
      config.onMeasurement?.(measurement);
      updateTrackAverages(trackId);
    }
    return measurement;
  }

  /** Run the correspondence search for one set of points, source camera -> other. */
  async function warp(points: Point[], sourceCamera: string, otherCamera: string, frameNum: number) {
    const [rig0, matcher] = await Promise.all([getRig(), getMatcher()]);
    if (!rig0) throw new Error('No stereo calibration is available for this dataset.');
    if (!matcher) throw new Error('The stereo matching model could not be loaded.');
    // Orient the rig so the annotated camera is the source ("left").
    const rig = sourceCamera === getLeftCameraName() ? rig0 : invertRig(rig0);

    const [srcFrame, tgtFrame] = await Promise.all([
      getFrame(sourceCamera, frameNum), getFrame(otherCamera, frameNum),
    ]);
    if (!srcFrame || !tgtFrame) throw new Error('Could not read the frame pixels for both cameras.');

    return matcher.warpPoints(points, rgbaToGray(srcFrame), rgbaToGray(tgtFrame), rig, {
      range: getRange(),
      threshold: config.threshold,
      uniquenessRatio: config.uniquenessRatio,
    });
  }

  /**
   * Warp the just-completed annotation onto the other camera.
   *
   * Line annotations re-warp whenever the source is edited, so an auto-generated
   * line keeps tracking its source — unless the other side was drawn by a human,
   * which is never overwritten. Boxes and polygons warp once.
   *
   * `quiet` aggregates failures for the bulk path instead of surfacing each one.
   */
  async function handleStereoAnnotationComplete(
    params: StereoAnnotationCompleteParams,
    forceAutoCompute = false,
    quiet = false,
  ): Promise<'transferred' | 'skipped' | 'failed'> {
    if (params.type === 'segmentation') return 'skipped';

    // The warp writes geometry directly rather than re-emitting this event, so
    // reaching here means the user authored this camera's line.
    if (params.type === 'line') {
      cameraStore.getPossibleTrack(params.trackId, params.camera)
        ?.setFeatureAttribute(params.frameNum, STEREO_USER_LINE_ATTR, true);
    }

    const cams = getMultiCamList();
    if (cams.length < 2) return 'skipped';
    const otherCamera = cams.find((c) => c !== params.camera);
    if (!otherCamera) return 'skipped';

    const otherTrack = cameraStore.getPossibleTrack(params.trackId, otherCamera);
    const [otherFeature] = otherTrack ? otherTrack.getFeature(params.frameNum) : [null];
    const otherHasFeature = otherFeature !== null;
    const shouldWarp = forceAutoCompute || autoCompute();

    if (params.type === 'line') {
      const otherIsHuman = otherHasFeature
        && otherFeature?.attributes?.[STEREO_USER_LINE_ATTR] === true;
      if (otherIsHuman || !shouldWarp) {
        // Leave the other side as-is, but refresh the measurement if both sides
        // now have a line.
        if (measureLengths() && otherHasFeature) {
          try {
            await measureAndReport(params.trackId, params.frameNum);
          } catch (err) {
            config.onError?.(`Stereo measurement failed. ${(err as Error).message}`);
          }
        }
        return 'skipped';
      }
    } else if (otherHasFeature || !shouldWarp) {
      return 'skipped';
    }

    if (!quiet) config.onStatus?.('Computing stereo correspondence...');
    try {
      if (params.type === 'box') {
        const [x1, y1, x2, y2] = params.bounds;
        const corners: Point[] = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
        const res = await warp(corners, params.camera, otherCamera, params.frameNum);
        if (!res.every((r) => r.accepted)) {
          throw new Error('No confident stereo match for the box corners.');
        }
        const track = getOrCreateTrack(params.trackId, params.camera, otherCamera, params.frameNum);
        if (!track) throw new Error('Could not create the track on the other camera.');
        track.setFeature({
          frame: params.frameNum,
          flick: 0,
          keyframe: true,
          interpolate: false,
          bounds: boundsFromPoints(res.map((r) => [r.x, r.y] as Point)),
        });
        config.onChange?.(otherCamera, track);
      } else if (params.type === 'polygon') {
        const res = await warp(params.polygon, params.camera, otherCamera, params.frameNum);
        if (!res.every((r) => r.accepted)) {
          throw new Error('No confident stereo match for the polygon vertices.');
        }
        const ring = res.map((r) => [r.x, r.y] as Point);
        const [first] = ring;
        const last = ring[ring.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first] as Point);
        const track = getOrCreateTrack(params.trackId, params.camera, otherCamera, params.frameNum);
        if (!track) throw new Error('Could not create the track on the other camera.');
        track.setFeature({
          frame: params.frameNum,
          flick: 0,
          keyframe: true,
          interpolate: false,
          bounds: boundsFromPoints(ring),
        }, [{
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [ring] },
          properties: { key: params.key },
        }] as GeoJSON.Feature<GeoJSON.Geometry>[] as never);
        config.onChange?.(otherCamera, track);
      } else {
        const res = await warp(params.line, params.camera, otherCamera, params.frameNum);
        if (!res[0].accepted || !res[1].accepted) {
          throw new Error('No confident stereo match for the line endpoints.');
        }
        const track = getOrCreateTrack(params.trackId, params.camera, otherCamera, params.frameNum);
        if (!track) throw new Error('Could not create the track on the other camera.');
        applyLine(track, params.frameNum, [[res[0].x, res[0].y], [res[1].x, res[1].y]], params.key);
        config.onChange?.(otherCamera, track);
        if (measureLengths()) await measureAndReport(params.trackId, params.frameNum);
      }
      if (!quiet) config.onStatus?.(null);
      return 'transferred';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!quiet) {
        config.onStatus?.(null);
        config.onError?.(`Failed to transfer annotation to the other camera. ${message}`);
      }
      return 'failed';
    }
  }

  /**
   * Recompute the measurement for every frame where a freshly linked pair now
   * has a line on both cameras.
   */
  async function handleStereoTrackLinked(trackId: number): Promise<void> {
    if (!measureLengths()) return;
    const cams = getMultiCamList();
    if (cams.length < 2) return;
    const frames = new Set<number>();
    cams.forEach((camera) => {
      cameraStore.getPossibleTrack(trackId, camera)?.featureIndex
        .forEach((frame) => frames.add(frame));
    });
    let last: StereoMeasurement | null = null;
    // Sequential: each measurement writes to both tracks.
    // eslint-disable-next-line no-restricted-syntax
    for (const frame of [...frames].sort((a, b) => a - b)) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const m = await measureAtFrame(trackId, frame);
        if (m) last = m;
      } catch {
        // A frame that cannot be measured should not abort the rest.
      }
    }
    if (last) {
      config.onMeasurement?.(last);
      updateTrackAverages(trackId);
    }
  }

  /**
   * Warp every detection the source camera holds onto the other camera, for the
   * frames given. Frames the other camera already has are left untouched.
   * Returns per-outcome counts so the caller can report a single summary.
   */
  async function warpAllFromCamera(sourceCamera: string, frameNums?: number[]): Promise<{ transferred: number; skipped: number; failed: number }> {
    const counts = { transferred: 0, skipped: 0, failed: 0 };
    const store = cameraStore.camMap.value.get(sourceCamera)?.trackStore;
    if (!store) return counts;

    const jobs: StereoAnnotationCompleteParams[] = [];
    store.annotationMap.forEach((track: Track) => {
      track.featureIndex.forEach((frame: number) => {
        if (frameNums && !frameNums.includes(frame)) return;
        const [feature] = track.getFeature(frame);
        if (!feature) return;
        const line = lineEndpoints(track, frame);
        const base = { camera: sourceCamera, trackId: track.id, frameNum: frame };
        if (line) {
          jobs.push({
            ...base, type: 'line', line, key: HeadTailLineKey,
          });
          return;
        }
        const polyFeat = feature.geometry?.features
          ?.find((f: GeoJSON.Feature) => f.geometry.type === 'Polygon');
        if (polyFeat) {
          const ring = (polyFeat.geometry.coordinates as unknown as Point[][])[0];
          if (ring?.length >= 3) {
            jobs.push({
              ...base, type: 'polygon', polygon: ring, key: polyFeat.properties?.key ?? '',
            });
            return;
          }
        }
        if (feature.bounds) {
          jobs.push({ ...base, type: 'box', bounds: feature.bounds as [number, number, number, number] });
        }
      });
    });

    // Sequential: each job runs a wasm inference and reads frame pixels.
    // eslint-disable-next-line no-restricted-syntax
    for (let i = 0; i < jobs.length; i += 1) {
      config.onStatus?.(`Warping detection ${i + 1} of ${jobs.length}...`);
      // eslint-disable-next-line no-await-in-loop
      const result = await handleStereoAnnotationComplete(jobs[i], true, true);
      counts[result] += 1;
    }
    config.onStatus?.(null);
    if (counts.failed) {
      config.onError?.(
        `${counts.failed} of ${jobs.length} detections could not be warped to the other camera.`,
      );
    }
    return counts;
  }

  return {
    handleStereoAnnotationComplete,
    handleStereoTrackLinked,
    warpAllFromCamera,
    measureAtFrame,
  };
}
