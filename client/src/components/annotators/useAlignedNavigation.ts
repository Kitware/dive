import geo from 'geojs';
import {
  Ref, onBeforeUnmount, watch,
} from 'vue';
import type { AggregateMediaController } from './mediaControllerType';
import type AlignedViewStore from '../../AlignedViewStore';

/**
 * Links pan/zoom recentering across ALL loaded cameras while the aligned
 * view is active (SEAL-TK feature 3).
 *
 * While the aligned view is active, every pane RENDERS in the shared
 * reference space: AlignedImageLayer draws each camera's imagery -- and
 * LayerManager maps its geometry -- through that camera's native->reference
 * transform. The link between panes is therefore the IDENTITY on
 * coordinates: same center, same reference-units-per-screen-pixel. Mapping
 * centers through the camera-to-camera transforms here would re-apply a
 * transform the rendering has already applied, offsetting every non-reference
 * pane by exactly its pair transform.
 *
 * Distinct from (a) the general "sync cameras" toggle (Controls.vue), which
 * forwards raw screen deltas/zoom levels for UNWARPED panes (it is hidden
 * and disabled whenever the aligned view is available), and (b) the
 * calibration pair link (useCalibrationNavigation.ts), which maps through
 * the homography because it operates on unwarped panes while authoring
 * correspondences -- it stands down while the aligned view is active.
 */
export default function useAlignedNavigation(
  aggregateController: Ref<AggregateMediaController>,
  alignedView: AlignedViewStore,
  cameras: Ref<string[]>,
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
      // Stand down while the raw screen-delta sync is driving (it should be
      // unreachable while the aligned view is available, but never let two
      // handlers fight over the same pan event).
      if (aggregateController.value.cameraSync.value) {
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
      // Shared reference space: copy the center verbatim and match the
      // visible extent. Viewers keep their own zoom-0 baselines (sized to
      // each camera's native image), so an equal units-per-pixel still needs
      // converting through the target's baseline rather than copying the
      // zoom level (geojs zoom is log2-based:
      // unitsPerPixel(z) = unitsPerPixel(0) / 2^z).
      const center = sourceViewer.center();
      const desiredUnitsPerPixel = sourceViewer.unitsPerPixel(sourceViewer.zoom());
      guard = true;
      try {
        cameras.value.forEach((otherCamera) => {
          if (otherCamera === camera) {
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
            const targetZoom = Math.log2(targetViewer.unitsPerPixel(0) / desiredUnitsPerPixel);
            if (Number.isFinite(targetZoom)) {
              targetViewer.zoom(targetZoom);
            }
            targetViewer.center({ x: center.x, y: center.y });
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
