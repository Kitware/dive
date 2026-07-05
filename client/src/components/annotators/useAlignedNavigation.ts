import geo from 'geojs';
import {
  Ref, onBeforeUnmount, watch,
} from 'vue';
import type { AggregateMediaController } from './mediaControllerType';
import type AlignedViewStore from '../../AlignedViewStore';
import type CameraCalibrationStore from '../../CameraCalibrationStore';

/**
 * Links pan/zoom recentering across ALL loaded cameras while the aligned
 * view is active (SEAL-TK feature 3): panning or zooming any camera
 * recenters every other camera on the same world location, mapped through
 * the stored transforms composed via the reference camera
 * ({@link AlignedViewStore.mapCameraPoint}).
 *
 * Distinct from (a) the general "sync cameras" toggle (Controls.vue), which
 * forwards raw screen deltas/zoom levels and assumes identical pixel scale
 * between panes, and (b) the calibration pair link
 * (useCalibrationNavigation.ts), which is scoped to the active calibration
 * pair while authoring correspondences. To avoid three handlers fighting
 * over the same pan event, this link stands down while either of those is
 * turned on.
 */
export default function useAlignedNavigation(
  aggregateController: Ref<AggregateMediaController>,
  alignedView: AlignedViewStore,
  cameras: Ref<string[]>,
  calibration?: CameraCalibrationStore,
) {
  // Re-entrancy guard: setting a camera's center from a link handler must not
  // itself trigger that camera's own pan/zoom listener.
  let guard = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let attached: { viewer: any; handler: () => void }[] = [];

  function teardown() {
    attached.forEach(({ viewer, handler }) => {
      viewer.geoOff(geo.event.pan, handler);
      viewer.geoOff(geo.event.zoom, handler);
    });
    attached = [];
  }

  function link(camera: string) {
    return () => {
      if (guard) {
        return;
      }
      if (!alignedView.active.value) {
        return;
      }
      // Stand down while another camera-linking mechanism is driving.
      if (aggregateController.value.cameraSync.value || calibration?.linkedNav.value) {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let sourceViewer: any;
      try {
        sourceViewer = aggregateController.value.getController(camera).geoViewerRef.value;
      } catch {
        return;
      }
      if (!sourceViewer) {
        return;
      }
      const center = sourceViewer.center();
      guard = true;
      try {
        cameras.value.forEach((otherCamera) => {
          if (otherCamera === camera) {
            return;
          }
          const mapped = alignedView.mapCameraPoint(camera, otherCamera, [center.x, center.y]);
          if (!mapped) {
            return;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let targetViewer: any;
          try {
            targetViewer = aggregateController.value.getController(otherCamera).geoViewerRef.value;
          } catch {
            return;
          }
          if (targetViewer) {
            targetViewer.center({ x: mapped[0], y: mapped[1] });
          }
        });
      } finally {
        guard = false;
      }
    };
  }

  function setup() {
    teardown();
    if (!alignedView.active.value) {
      return;
    }
    cameras.value.forEach((camera) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let viewer: any;
      try {
        viewer = aggregateController.value.getController(camera).geoViewerRef.value;
      } catch {
        // This camera hasn't initialized a viewer yet; the resizeTrigger
        // dependency below re-runs setup once it does.
        return;
      }
      if (!viewer) {
        return;
      }
      const handler = link(camera);
      viewer.geoOn(geo.event.pan, handler);
      viewer.geoOn(geo.event.zoom, handler);
      attached.push({ viewer, handler });
    });
  }

  watch(
    [
      alignedView.active,
      alignedView.toReference,
      cameras,
      aggregateController.value.resizeTrigger,
    ],
    setup,
  );

  onBeforeUnmount(teardown);
}
