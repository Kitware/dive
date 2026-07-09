import { cloneDeep } from 'lodash';
import type { CameraStore, Track } from 'vue-media-annotator/index';
import type { Matrix3 } from 'vue-media-annotator/homography';
import {
  cameraPairTransform, mapBounds, mapGeoJSONFeatures, mapRotatedBounds,
} from 'vue-media-annotator/alignedView';
import {
  RectBounds,
  ROTATION_ATTRIBUTE_NAME,
  getRotationFromAttributes,
  validateRotation,
} from 'vue-media-annotator/utils';

export interface WarpAnnotationsResult {
  /** Distinct source tracks copied onto at least one other camera. */
  tracks: number;
  /** Cameras (excluding the source) that received warped annotations. */
  cameras: number;
}

/**
 * Copy every track on `sourceCamera` onto every other calibrated camera,
 * warping geometry through the camera-to-camera homographies (composed via
 * the reference space, see {@link cameraPairTransform}). Used after a
 * single-camera annotation import into a calibrated multicam dataset so the
 * detections appear on all cameras.
 *
 * Copies land on the same local frame number: a batch import carries no
 * temporal-alignment information, and calibrated rigs (e.g. EO/IR) capture
 * in lockstep. Tracks keep their id across cameras — the same convention the
 * Align View continuous mirror uses — so a target camera's existing same-id
 * track has its keyframes overwritten at the copied frames. Mutations go
 * through the Track/TrackStore APIs so change-tracking fires; the caller is
 * responsible for persisting the result (e.g. handler.save()).
 *
 * @param cameraStore the multicam store holding per-camera tracks
 * @param toReference per-camera native->reference matrices
 *   (AlignedViewStore.toReference — present whenever the rig is calibrated,
 *   independent of the Align View display toggle)
 * @param sourceCamera camera whose tracks are copied out
 */
export default function warpAnnotationsAcrossCameras(
  cameraStore: CameraStore,
  toReference: Record<string, Matrix3>,
  sourceCamera: string,
): WarpAnnotationsResult {
  const result: WarpAnnotationsResult = { tracks: 0, cameras: 0 };
  const sourceStore = cameraStore.camMap.value.get(sourceCamera)?.trackStore;
  if (!sourceStore) {
    return result;
  }
  const copiedTracks = new Set<number>();
  cameraStore.camMap.value.forEach(({ trackStore }, cameraName) => {
    if (cameraName === sourceCamera) {
      return;
    }
    const matrix = cameraPairTransform(toReference, sourceCamera, cameraName);
    if (!matrix) {
      return;
    }
    let cameraReceived = false;
    sourceStore.annotationMap.forEach((annotation) => {
      const sourceTrack = annotation as Track;
      let targetTrack = trackStore.getPossible(sourceTrack.id) as Track | undefined;
      sourceTrack.featureIndex.forEach((frame) => {
        const feature = sourceTrack.features[frame];
        if (!feature || !feature.keyframe) {
          return;
        }
        const mappedGeometry = feature.geometry
          ? mapGeoJSONFeatures(matrix, feature.geometry.features)
          : [];
        let mappedBounds: RectBounds | undefined;
        let mappedRotation: number | undefined;
        const sourceRotation = getRotationFromAttributes(feature.attributes);
        if (feature.bounds) {
          if (sourceRotation !== undefined) {
            const mapped = mapRotatedBounds(matrix, feature.bounds, sourceRotation);
            mappedBounds = mapped.bounds;
            mappedRotation = validateRotation(mapped.rotation);
          } else {
            mappedBounds = mapBounds(matrix, feature.bounds);
          }
        }
        if (!targetTrack) {
          targetTrack = trackStore.add(
            frame,
            sourceTrack.getType()[0],
            undefined,
            sourceTrack.id,
          );
          targetTrack.confidencePairs = cloneDeep(sourceTrack.confidencePairs);
          Object.entries(sourceTrack.attributes).forEach(([key, value]) => {
            targetTrack?.setAttribute(key, cloneDeep(value));
          });
        }
        targetTrack.setFeature({
          frame,
          flick: feature.flick,
          bounds: mappedBounds,
          keyframe: true,
          interpolate: feature.interpolate,
        }, mappedGeometry);
        if (feature.attributes) {
          Object.entries(feature.attributes).forEach(([key, value]) => {
            if (key !== ROTATION_ATTRIBUTE_NAME) {
              targetTrack?.setFeatureAttribute(frame, key, cloneDeep(value));
            }
          });
        }
        if (mappedRotation !== undefined) {
          targetTrack.setFeatureAttribute(frame, ROTATION_ATTRIBUTE_NAME, mappedRotation);
        }
        copiedTracks.add(sourceTrack.id);
        cameraReceived = true;
      });
    });
    if (cameraReceived) {
      result.cameras += 1;
    }
  });
  result.tracks = copiedTracks.size;
  return result;
}
