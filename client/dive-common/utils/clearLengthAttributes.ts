import type { CameraStore, Track } from 'vue-media-annotator/index';

export const LENGTH_ATTRIBUTE_KEY = 'length';
export const LENGTH_METHOD_ATTRIBUTE_KEY = 'length_method';

/**
 * Remove the per-track and per-detection 'length' attribute (and, by default,
 * the companion 'length_method' lock) across all cameras in the store. Used
 * when a new stereo camera/calibration file is loaded, because existing length
 * measurements were computed against the previous calibration and are no longer
 * valid.
 *
 * Mutations go through the Track API so change-tracking and reactivity fire; the
 * caller is responsible for persisting the result (e.g. handler.save()).
 *
 * @param cameraStore the camera store to clear
 * @param clearMethod also clear the 'length_method' attribute (default true)
 * @returns the number of attribute values cleared.
 */
export default function clearLengthAttributes(
  cameraStore: CameraStore,
  clearMethod = true,
): number {
  const keys = clearMethod
    ? [LENGTH_ATTRIBUTE_KEY, LENGTH_METHOD_ATTRIBUTE_KEY]
    : [LENGTH_ATTRIBUTE_KEY];
  let cleared = 0;
  cameraStore.camMap.value.forEach((camera) => {
    camera.trackStore.annotationMap.forEach((annotation) => {
      const track = annotation as Track;
      keys.forEach((key) => {
        if (track.attributes && track.attributes[key] !== undefined) {
          track.setAttribute(key, undefined);
          cleared += 1;
        }
        track.features.forEach((feature, frame) => {
          if (feature && feature.attributes && feature.attributes[key] !== undefined) {
            track.setFeatureAttribute(frame, key, undefined);
            cleared += 1;
          }
        });
      });
    });
  });
  return cleared;
}
