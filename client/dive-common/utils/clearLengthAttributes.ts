import type { CameraStore, Track } from 'vue-media-annotator/index';

export const LENGTH_ATTRIBUTE_KEY = 'length';

/**
 * Remove every per-track and per-detection attribute named 'length' across all
 * cameras in the store. Used when a new stereo camera/calibration file is loaded,
 * because existing length measurements were computed against the previous
 * calibration and are no longer valid.
 *
 * Mutations go through the Track API so change-tracking and reactivity fire; the
 * caller is responsible for persisting the result (e.g. handler.save()).
 *
 * @returns the number of attribute values cleared.
 */
export default function clearLengthAttributes(cameraStore: CameraStore): number {
  let cleared = 0;
  cameraStore.camMap.value.forEach((camera) => {
    camera.trackStore.annotationMap.forEach((annotation) => {
      const track = annotation as Track;
      if (track.attributes && track.attributes[LENGTH_ATTRIBUTE_KEY] !== undefined) {
        track.setAttribute(LENGTH_ATTRIBUTE_KEY, undefined);
        cleared += 1;
      }
      track.features.forEach((feature, frame) => {
        if (feature && feature.attributes
          && feature.attributes[LENGTH_ATTRIBUTE_KEY] !== undefined) {
          track.setFeatureAttribute(frame, LENGTH_ATTRIBUTE_KEY, undefined);
          cleared += 1;
        }
      });
    });
  });
  return cleared;
}
