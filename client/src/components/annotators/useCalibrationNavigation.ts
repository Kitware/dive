import { Ref, watch } from 'vue';
import type { AggregateMediaController } from './mediaControllerType';
import type CameraCalibrationStore from '../../CameraCalibrationStore';
import type AlignedViewStore from '../../AlignedViewStore';
import { localLinkedScale } from '../../homography';
import type { Point } from '../../homography';
import useLinkedViewers from './useLinkedViewers';

/**
 * Links pan/zoom recentering between the two cameras of the active calibration
 * pair: panning or zooming one recenters the other on the same point, mapped
 * through the pair's fitted homography ({@link CameraCalibrationStore.linkedPoint}).
 * The mapping assumes UNWARPED panes showing native coordinates, so this is
 * active only while point picking is (the aligned-view link,
 * {@link useAlignedNavigation}, owns navigation otherwise) and stands down if
 * the aligned view is somehow active. Distinct from the general "sync cameras"
 * toggle (Controls.vue), which assumes identical pixel scale between panes.
 */
export default function useCalibrationNavigation(
  aggregateController: Ref<AggregateMediaController>,
  calibration: CameraCalibrationStore,
  alignedView?: AlignedViewStore,
) {
  const {
    viewer, teardown, attach, guarded, applyView,
  } = useLinkedViewers(aggregateController);

  function link(camera: string, otherCamera: string) {
    return () => guarded(() => {
      // The homography mapping assumes unwarped panes; the aligned-view link
      // owns navigation while it is active.
      if (alignedView?.active.value) {
        return;
      }
      const source = viewer(camera);
      const target = viewer(otherCamera);
      if (!source || !target) {
        return;
      }
      const center = source.center();
      const linked = calibration.linkedPoint(camera, [center.x, center.y]);
      if (!linked || linked.camera !== otherCamera) {
        return;
      }
      // Match the visible extent: one source pixel spans `scale` target pixels
      // here (position-dependent for non-similarity fits, so sampled at center;
      // null when unavailable -- leave the target's zoom alone).
      const scale = localLinkedScale(
        (p) => calibration.linkedPoint(camera, p)?.coord ?? null,
        [center.x, center.y],
      );
      applyView(target, {
        center: { x: linked.coord[0], y: linked.coord[1] },
        unitsPerPixel: scale === null ? null : source.unitsPerPixel(source.zoom()) * scale,
      });
    });
  }

  function setup() {
    teardown();
    const pair = calibration.activePair.value;
    // Authoring UI: active while picking and "Fit pan/zoom" is on (once a fit
    // exists, linkedPoint returns matches). attach() no-ops for a not-yet-ready
    // pane; the resizeTrigger watch re-runs setup once both viewers exist.
    if (calibration.pickingEnabled.value && calibration.linkedNav.value && pair) {
      attach(pair.camA, link(pair.camA, pair.camB));
      attach(pair.camB, link(pair.camB, pair.camA));
    }
  }

  watch(
    [
      calibration.pickingEnabled,
      calibration.linkedNav,
      calibration.activePair,
      calibration.homographies,
      aggregateController.value.resizeTrigger,
    ],
    setup,
    { deep: true },
  );

  /**
   * One-shot recenter (right-click while picking): center the clicked camera on
   * the clicked point and, when the pair has a fitted homography, the other
   * camera on the corresponding point. Guarded so it doesn't loop back through
   * the continuous link above.
   */
  function handleRecenterRequest(
    request: { camera: string; coord: Point; id: number } | null,
  ) {
    if (!request || alignedView?.active.value) {
      return;
    }
    const pair = calibration.activePair.value;
    if (!pair || (request.camera !== pair.camA && request.camera !== pair.camB)) {
      return;
    }
    const source = viewer(request.camera);
    if (source) {
      guarded(() => source.center({ x: request.coord[0], y: request.coord[1] }));
    }
    const linked = calibration.linkedPoint(request.camera, request.coord);
    const target = linked && viewer(linked.camera);
    if (linked && target) {
      guarded(() => target.center({ x: linked.coord[0], y: linked.coord[1] }));
    }
  }

  watch(() => calibration.recenterRequest.value, handleRecenterRequest);
}
