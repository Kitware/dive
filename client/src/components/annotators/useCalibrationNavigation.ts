import geo from 'geojs';
import {
  Ref, onBeforeUnmount, watch,
} from 'vue';
import type { AggregateMediaController } from './mediaControllerType';
import type CameraCalibrationStore from '../../CameraCalibrationStore';
import type AlignedViewStore from '../../AlignedViewStore';
import { localLinkedScale } from '../../homography';
import type { Point } from '../../homography';

/**
 * Links pan/zoom recentering between the two cameras of the active calibration
 * pair: panning or zooming one camera recenters the other on the same
 * reference-space point, mapped through the pair's fitted homography (see
 * {@link CameraCalibrationStore.linkedPoint}). This is distinct from the
 * general "sync cameras" toggle (Controls.vue), which forwards raw screen
 * deltas/zoom levels and assumes identical pixel scale between panes -- not
 * true for cross-modality (e.g. EO/IR) rigs with differing resolutions.
 *
 * Active whenever point picking is (no separate toggle): during authoring
 * the panes are unwarped and this link maps through the pair homography;
 * outside picking the Align button's link (useAlignedNavigation) owns
 * navigation instead. The homography mapping assumes UNWARPED panes
 * displaying native coordinates, so this link also stands down defensively
 * if the aligned view is somehow active.
 */
export default function useCalibrationNavigation(
  aggregateController: Ref<AggregateMediaController>,
  calibration: CameraCalibrationStore,
  alignedView?: AlignedViewStore,
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

  function link(camera: string, otherCamera: string) {
    return () => {
      if (guard) {
        return;
      }
      // Panes render in reference space while the aligned view is active;
      // this link's native-coordinate mapping would double-apply the
      // transform there. useAlignedNavigation owns linking in that state.
      if (alignedView?.active.value) {
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let sourceViewer: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let targetViewer: any;
      try {
        sourceViewer = aggregateController.value.getController(camera).geoViewerRef.value;
        targetViewer = aggregateController.value.getController(otherCamera).geoViewerRef.value;
      } catch {
        return;
      }
      if (!sourceViewer || !targetViewer) {
        return;
      }
      const center = sourceViewer.center();
      const linked = calibration.linkedPoint(camera, [center.x, center.y]);
      if (!linked || linked.camera !== otherCamera) {
        return;
      }
      // Match the visible extent, not just the center: one source pixel spans
      // `scale` target pixels around this point, so the target must display
      // `scale`x the units-per-pixel of the source. geojs zoom is log2-based
      // (unitsPerPixel(z) = unitsPerPixel(0) / 2^z), so invert through the
      // target's own zoom-0 baseline -- the two viewers' baselines differ
      // whenever the images differ in resolution (e.g. EO vs IR).
      const scale = localLinkedScale(
        (p) => calibration.linkedPoint(camera, p)?.coord ?? null,
        [center.x, center.y],
      );
      guard = true;
      try {
        if (scale !== null) {
          const desiredUnitsPerPixel = sourceViewer.unitsPerPixel(sourceViewer.zoom()) * scale;
          const targetZoom = Math.log2(targetViewer.unitsPerPixel(0) / desiredUnitsPerPixel);
          if (Number.isFinite(targetZoom)) {
            targetViewer.zoom(targetZoom);
          }
        }
        targetViewer.center({ x: linked.coord[0], y: linked.coord[1] });
      } finally {
        guard = false;
      }
    };
  }

  function setup() {
    teardown();
    const pair = calibration.activePair.value;
    // The pair link is authoring UI: it is simply active whenever point
    // picking is (once a fit exists, linkedPoint starts returning matches).
    // Outside picking, the Align button's link owns navigation.
    if (!calibration.pickingEnabled.value || !pair) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewerA: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewerB: any;
    try {
      viewerA = aggregateController.value.getController(pair.camA).geoViewerRef.value;
      viewerB = aggregateController.value.getController(pair.camB).geoViewerRef.value;
    } catch {
      // One or both cameras haven't initialized a viewer yet; the resizeTrigger
      // dependency below re-runs setup once they do.
      return;
    }
    if (!viewerA || !viewerB) {
      return;
    }
    const handlerA = link(pair.camA, pair.camB);
    const handlerB = link(pair.camB, pair.camA);
    viewerA.geoOn(geo.event.pan, handlerA);
    viewerA.geoOn(geo.event.zoom, handlerA);
    viewerB.geoOn(geo.event.pan, handlerB);
    viewerB.geoOn(geo.event.zoom, handlerB);
    attached = [
      { viewer: viewerA, handler: handlerA },
      { viewer: viewerB, handler: handlerB },
    ];
  }

  watch(
    [
      calibration.pickingEnabled,
      calibration.activePair,
      calibration.homographies,
      aggregateController.value.resizeTrigger,
    ],
    setup,
    { deep: true },
  );

  /**
   * One-shot recenter (right-click while picking): center the clicked camera
   * on the clicked point, and -- when the pair has a fitted homography --
   * center the other camera on the corresponding point. The `guard` flag
   * still applies so this doesn't loop back through the continuous pan/zoom
   * link above.
   */
  function handleRecenterRequest(
    request: { camera: string; coord: Point; id: number } | null,
  ) {
    if (!request) {
      return;
    }
    // Same native-coordinate assumption as the continuous link above.
    if (alignedView?.active.value) {
      return;
    }
    const pair = calibration.activePair.value;
    if (!pair || (request.camera !== pair.camA && request.camera !== pair.camB)) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sourceViewer: any;
    try {
      sourceViewer = aggregateController.value.getController(request.camera).geoViewerRef.value;
    } catch {
      return;
    }
    if (sourceViewer) {
      guard = true;
      try {
        sourceViewer.center({ x: request.coord[0], y: request.coord[1] });
      } finally {
        guard = false;
      }
    }
    const linked = calibration.linkedPoint(request.camera, request.coord);
    if (!linked) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetViewer: any;
    try {
      targetViewer = aggregateController.value.getController(linked.camera).geoViewerRef.value;
    } catch {
      return;
    }
    if (!targetViewer) {
      return;
    }
    guard = true;
    try {
      targetViewer.center({ x: linked.coord[0], y: linked.coord[1] });
    } finally {
      guard = false;
    }
  }

  watch(() => calibration.recenterRequest.value, handleRecenterRequest);

  onBeforeUnmount(teardown);
}
