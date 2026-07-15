import {
  getCurrentInstance, nextTick, onBeforeUnmount, Ref, watch,
} from 'vue';
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
      // Shared reference space: copy the visible world rectangle, not zoom-0
      // unitsPerPixel. Large-image (tile pyramid) and image-sequence maps
      // define that baseline differently; zoomAndCenterFromBounds works for
      // both and keeps Align View linked without changing how large-image
      // fits when Align is off.
      const center = source.center();
      const size = typeof source.size === 'function' ? source.size() : null;
      const upp = source.unitsPerPixel(source.zoom());
      let bounds: {
        left: number; right: number; top: number; bottom: number;
      } | null = null;
      if (size && size.width > 0 && size.height > 0 && upp > 0) {
        const halfW = (size.width * upp) / 2;
        const halfH = (size.height * upp) / 2;
        bounds = {
          left: center.x - halfW,
          right: center.x + halfW,
          top: center.y - halfH,
          bottom: center.y + halfH,
        };
      }
      cameras.value.forEach((other) => {
        if (other !== camera) {
          const target = viewer(other);
          if (!target) {
            return;
          }
          if (bounds && typeof target.zoomAndCenterFromBounds === 'function') {
            const zc = target.zoomAndCenterFromBounds(bounds, 0);
            target.zoom(zc.zoom);
            target.center(zc.center);
          } else {
            applyView(target, {
              center: { x: center.x, y: center.y },
              unitsPerPixel: upp,
            });
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
    if (getCurrentInstance()) {
      onBeforeUnmount(() => options.setResetZoomOverride?.(null));
    }
  }

  /**
   * Fit the reference pane to its native frame, then copy that reference-space
   * viewport onto every other camera. Large-image panes sit on a native fit
   * while Align is off; without this snap they keep that FOV after the warp
   * switches into reference coordinates and look stranded (upper-left /
   * wrong scale).
   */
  /**
   * Large-image (tiled) maps keep GeoJS clampZoom/clampBounds on by default.
   * Align View places warps in reference space and snaps every pane to the
   * reference FOV, which often exceeds a non-reference pane's native
   * maxBounds -- with clamp on, zoom/center snaps are silently rejected and
   * IR looks stranded at its native tile fit. Unlock before every snap.
   */
  function unlockPanZoomClamp() {
    cameras.value.forEach((camera) => {
      const map = viewer(camera);
      if (map && typeof map.clampZoom === 'function') {
        map.clampBoundsX(false);
        map.clampBoundsY(false);
        map.clampZoom(false);
      }
    });
  }

  function snapFromReference() {
    if (!alignedView.active.value) {
      return;
    }
    const reference = alignedView.reference.value;
    if (!reference || !cameras.value.includes(reference)) {
      return;
    }
    const source = viewer(reference);
    if (!source) {
      return;
    }
    unlockPanZoomClamp();
    guarded(() => {
      try {
        const bounds = aggregateController.value.getController(reference).originalBounds.value;
        if (typeof source.zoomAndCenterFromBounds === 'function') {
          const zc = source.zoomAndCenterFromBounds(bounds, 0);
          source.zoom(zc.zoom);
          source.center(zc.center);
        } else {
          aggregateController.value.getController(reference).resetZoom();
        }
      } catch {
        // Controllers may be mid-reload; link() below still copies whatever
        // view the reference currently has.
      }
    });
    link(reference)();
  }

  function setup() {
    teardown();
    if (!alignedView.active.value) {
      return;
    }
    cameras.value.forEach((camera) => attach(camera, link(camera)));
    // Propagate the reference pane's current view. Full fit-to-reference
    // (snapFromReference) is only for Align-on below so resizes don't yank
    // the user back to a native fit.
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

  // Align View toggled on: fit the reference frame and push that viewport onto
  // every other pane (large-image leaves Align-off on a native tile fit that
  // is wrong once warps live in reference coords). Re-snap after a tick so
  // AlignedImageLayer / frameTexture have settled, and once more when any
  // camera's imageRevision bumps (overview texture usually lands async).
  // Toggled off: restore each pane's native full-frame fit.
  const alignOnRevisionStops: (() => void)[] = [];
  watch(alignedView.active, (active, wasActive) => {
    if (active && !wasActive) {
      snapFromReference();
      nextTick(() => {
        if (!alignedView.active.value) {
          return;
        }
        snapFromReference();
        if (typeof window !== 'undefined'
          && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => {
            if (alignedView.active.value) {
              snapFromReference();
            }
          });
        }
      });
      cameras.value.forEach((camera) => {
        try {
          const { imageRevision } = aggregateController.value.getController(camera);
          const stop = watch(imageRevision, () => {
            stop();
            if (alignedView.active.value) {
              snapFromReference();
            }
          });
          alignOnRevisionStops.push(stop);
        } catch {
          // Camera controller may be mid-teardown.
        }
      });
      return;
    }
    if (!active && wasActive) {
      while (alignOnRevisionStops.length) {
        alignOnRevisionStops.pop()?.();
      }
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
