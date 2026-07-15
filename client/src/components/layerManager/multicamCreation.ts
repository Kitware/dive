import type { AnnotationId } from '../../BaseAnnotation';
import type CameraStore from '../../CameraStore';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';
import { featureHasSegmentationPolygon } from '../../utils';

/**
 * True when the selected track is a brand-new detection with no geometry yet
 * on `camera` at this frame (the user is mid-creation). Used to mirror the
 * creation cursor onto non-selected cameras so a new detection can be drawn
 * on any camera. Callers must pass the layer's OWN camera (same as
 * {@link cameraAwaitingGeometry}): `frame` is that layer's local frame, and
 * under an aligned timeline that diverges from the selected camera's local
 * frame.
 */
export function isCreatingNewDetection(
  cameraStore: CameraStore,
  camera: string,
  frame: number,
  trackId: AnnotationId | null,
): boolean {
  if (trackId === null) return false;
  const t = cameraStore.getPossibleTrack(trackId, camera);
  if (!t) return false;
  return t.getFeature(frame)[0] == null;
}

/**
 * True when, while editing, the selected track has no geometry on THIS
 * camera at this frame (the track may not exist on this camera at all).
 * For Point mode (point-click segmentation) and Polygon mode, "no geometry"
 * means no polygon at the selected key here yet, so a detection that only
 * has a box still accepts a draw.
 */
export function cameraAwaitingGeometry(
  cameraStore: CameraStore,
  camera: string,
  frame: number,
  trackId: AnnotationId | null,
  editingTrack: false | EditAnnotationTypes,
  selectedKey: string,
): boolean {
  if (trackId === null || !editingTrack) return false;
  if (!cameraStore.getAnyPossibleTrack(trackId)) return false;
  const t = cameraStore.getPossibleTrack(trackId, camera);
  if (!t) return true;
  const [feature] = t.getFeature(frame);
  if (feature == null) return true;
  if (editingTrack === 'Point' || editingTrack === 'Polygon') {
    return !featureHasSegmentationPolygon(feature, selectedKey);
  }
  return false;
}
