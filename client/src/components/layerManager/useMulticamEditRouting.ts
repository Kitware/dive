import type { Ref } from 'vue';
import type { AnnotationId } from '../../BaseAnnotation';
import type CameraStore from '../../CameraStore';
import type { Handler } from '../../provides';
import type { EditAnnotationTypes } from '../../layers/EditAnnotationLayer';
import type TrackStore from '../../TrackStore';
import {
  cameraAwaitingGeometry,
  isCreatingNewDetection,
  isEmptyCameraTrack,
} from './multicamCreation';

/**
 * Ensure a draw/edit on a non-selected camera commits to THAT camera's track.
 * A new track that has never been drawn is moved onto the camera that receives
 * the first draw, rather than linked to an empty shell on the camera where N
 * was pressed. Extending a track that already has geometry keeps the shared id.
 * Returns true when the update should be dropped (e.g. a blocked camera switch).
 */
export default function routeMulticamEditToCamera(options: {
  camera: string;
  selectedCamera: Ref<string>;
  frameNumberRef: Ref<number>;
  selectedTrackIdRef: Ref<AnnotationId | null>;
  editingModeRef: Ref<false | EditAnnotationTypes>;
  selectedKeyRef: Ref<string>;
  cameraStore: CameraStore;
  trackStore: TrackStore;
  handler: Handler;
}): boolean {
  const {
    camera,
    selectedCamera,
    frameNumberRef,
    selectedTrackIdRef,
    editingModeRef,
    selectedKeyRef,
    cameraStore,
    trackStore,
    handler,
  } = options;

  if (camera !== selectedCamera.value
    && (cameraAwaitingGeometry(
      cameraStore,
      camera,
      frameNumberRef.value,
      selectedTrackIdRef.value,
      editingModeRef.value,
      selectedKeyRef.value,
    )
      || isCreatingNewDetection(
        cameraStore,
        camera,
        frameNumberRef.value,
        selectedTrackIdRef.value,
      ))) {
    const trackId = selectedTrackIdRef.value as number;
    const sourceCamera = selectedCamera.value;
    if (!cameraStore.getPossibleTrack(trackId, camera)) {
      const anyTrack = cameraStore.getAnyPossibleTrack(trackId);
      const trackType = anyTrack?.confidencePairs?.[0]?.[0] || 'unknown';
      trackStore.add(frameNumberRef.value, trackType, undefined, trackId);
      // First draw of a new track belongs to this camera only. Leave existing
      // geometry in place when the user is extending a linked track.
      if (isEmptyCameraTrack(cameraStore, sourceCamera, trackId)) {
        cameraStore.remove(trackId, sourceCamera);
      }
    }
    handler.selectCamera(camera, false, true);
    if (editingModeRef.value === 'Point' && selectedCamera.value !== camera) {
      return true;
    }
  } else if (camera !== selectedCamera.value
    && editingModeRef.value && selectedTrackIdRef.value !== null
    && cameraStore.getPossibleTrack(selectedTrackIdRef.value, camera)) {
    handler.selectCamera(camera, false);
    if (selectedCamera.value !== camera) {
      return true;
    }
  }
  return false;
}
