import { onBeforeUnmount, Ref, watch } from 'vue';
import type { AggregateMediaController } from '../mediaControllerType';
import type AlignedViewStore from '../../../alignedView/AlignedViewStore';
import { applyHomography, Point } from '../../../alignedView/homography';
import useLinkedViewers from './useLinkedViewers';

/**
 * Links pan/zoom recentering across ALL loaded cameras while the aligned view
 * is active (SEAL-TK feature 3).
 *
 * While active, every pane RENDERS in the shared reference space, so the link
 * between panes is the IDENTITY on coordinates: same center, same
 * reference-units-per-screen-pixel. (Mapping centers through the
 * camera-to-camera transforms here would re-apply a transform the rendering has
 * already applied.) Distinct from the raw "sync cameras" toggle (Controls.vue),
 * which forwards raw screen deltas for UNWARPED panes and is hidden whenever the
 * aligned view is available, and from the registration pair link
 * ({@link useRegistrationNavigation}), which maps through the homography and
 * stands down while the aligned view is active.
 */
export default function useAlignedNavigation(
  aggregateController: Ref<AggregateMediaController>,
  alignedView: AlignedViewStore,
  cameras: Ref<string[]>,
  options?: {
    /** The camera pane the user is working in (Viewer.vue's selection). */
    selectedCamera?: Ref<string>;
    /** useMediaController's hook for replacing the aggregate "reset pan and zoom". */
    setResetZoomOverride?: (override: (() => boolean) | null) => void;
  },
) {
  const {
    viewer, teardown, attach, guarded, applyView,
  } = useLinkedViewers(aggregateController);

  function link(camera: string) {
    return () => guarded(() => {
      if (!alignedView.active.value) {
        return;
      }
      // onResize resets each pane to its own native bounds and emits pan/zoom
      // events; ignore them so a non-reference pane's native center doesn't get
      // copied into the shared reference space. setup() re-snaps from the
      // reference once the resize settles (via the resizeTrigger watch).
      if (aggregateController.value.resizing.value) {
        return;
      }
      // Never fight the raw screen-delta sync (unreachable while the aligned
      // view is available, but be defensive about two handlers on one event).
      if (aggregateController.value.cameraSync.value) {
        return;
      }
      const source = viewer(camera);
      if (!source) {
        return;
      }
      // Shared reference space: copy the center verbatim and match the extent.
      const center = source.center();
      const view = {
        center: { x: center.x, y: center.y },
        unitsPerPixel: source.unitsPerPixel(source.zoom()),
      };
      cameras.value.forEach((other) => {
        if (other !== camera) {
          const target = viewer(other);
          if (target) {
            applyView(target, view);
          }
        }
      });
    });
  }

  /**
   * Aligned-aware "reset pan and zoom" (the center-view button / `r`): fit
   * the SELECTED camera's content -- its native bounds mapped into the shared
   * reference space -- in its own pane, then mirror that view to every other
   * pane through the identity link. The default aggregate reset instead fits
   * each pane to its own native bounds, which under the aligned view parks
   * every pane near the reference-space origin rather than on the imagery
   * (whichever pane's reset lands last wins the link). Returns false to fall
   * back to the native per-pane reset whenever the aligned view is inactive
   * or this camera's pane isn't usable yet.
   */
  function alignedResetZoom(): boolean {
    if (!alignedView.active.value) {
      return false;
    }
    const selected = options?.selectedCamera?.value;
    const camera = selected && cameras.value.includes(selected)
      ? selected
      : (alignedView.reference.value ?? cameras.value[0]);
    if (!camera) {
      return false;
    }
    const source = viewer(camera);
    if (!source) {
      return false;
    }
    let native: { left: number; top: number; right: number; bottom: number };
    try {
      native = aggregateController.value.getController(camera).originalBounds.value;
    } catch {
      // Controllers may be cleared mid-reset during a dataset reload.
      return false;
    }
    // The camera's content rectangle in reference space: its native corners
    // through the native->reference homography (null for the unwarped
    // reference camera, whose native bounds already ARE reference bounds).
    const matrix = alignedView.cameraTransform(camera);
    let bounds = native;
    if (matrix) {
      const corners: Point[] = [
        [native.left, native.top],
        [native.right, native.top],
        [native.right, native.bottom],
        [native.left, native.bottom],
      ].map((corner) => applyHomography(matrix, corner));
      bounds = {
        left: Math.min(...corners.map((c) => c[0])),
        top: Math.min(...corners.map((c) => c[1])),
        right: Math.max(...corners.map((c) => c[0])),
        bottom: Math.max(...corners.map((c) => c[1])),
      };
    }
    const zoomAndCenter = source.zoomAndCenterFromBounds(bounds, 0);
    source.zoom(zoomAndCenter.zoom);
    source.center(zoomAndCenter.center);
    // The zoom/center calls above already fire this pane's pan/zoom link, but
    // mirror explicitly too so the reset lands even if the listeners haven't
    // (re)attached yet.
    link(camera)();
    return true;
  }

  if (options?.setResetZoomOverride) {
    options.setResetZoomOverride(alignedResetZoom);
    onBeforeUnmount(() => options.setResetZoomOverride?.(null));
  }

  function setup() {
    teardown();
    if (!alignedView.active.value) {
      return;
    }
    cameras.value.forEach((camera) => attach(camera, link(camera)));
    // Snap immediately from the reference pane so hitting Align lines every pane
    // up right away instead of waiting for the first pan/zoom event.
    const reference = alignedView.reference.value;
    if (reference && cameras.value.includes(reference)) {
      link(reference)();
    }
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

  // Leaving the aligned view strands every pane at reference-space centers/zooms
  // while content reverts to native coordinates -- reset each to its full native
  // view so the imagery is back on-screen.
  watch(alignedView.active, (active, wasActive) => {
    if (!active && wasActive) {
      cameras.value.forEach((camera) => {
        try {
          aggregateController.value.getController(camera).resetZoom();
        } catch {
          // A pane may already be torn down during dataset unload.
        }
      });
    }
  });
}
