import { Ref, watch } from 'vue';
import type { AggregateMediaController } from '../mediaControllerType';
import type AlignedViewStore from '../../../alignedView/AlignedViewStore';
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
 * aligned view is available, and from the calibration pair link
 * ({@link useCalibrationNavigation}), which maps through the homography and
 * stands down while the aligned view is active.
 */
export default function useAlignedNavigation(
  aggregateController: Ref<AggregateMediaController>,
  alignedView: AlignedViewStore,
  cameras: Ref<string[]>,
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
