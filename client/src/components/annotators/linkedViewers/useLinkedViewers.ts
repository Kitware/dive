import geo from 'geojs';
import { getCurrentInstance, onBeforeUnmount, Ref } from 'vue';
import type { AggregateMediaController } from '../mediaControllerType';

/**
 * Where to move a linked pane: the world-space center to show, and how many
 * world units one screen pixel should span there (null leaves the pane's
 * current zoom untouched, for when a local scale can't be resolved).
 */
export interface LinkedView {
  center: { x: number; y: number };
  unitsPerPixel: number | null;
}

/**
 * Shared plumbing for the two multicam pan/zoom links -- the registration pair
 * link ({@link useRegistrationNavigation}) and the aligned-view link
 * ({@link useAlignedNavigation}). Both attach geojs pan/zoom listeners to a set
 * of panes and, when one moves, drive the others to a matching view; they
 * differ only in how a source pane's view maps onto a target pane. This owns
 * the parts that don't: a re-entrancy guard so a driven update doesn't echo
 * back, listener bookkeeping, and the zoom-baseline conversion (geojs zoom is
 * log2-based, and panes sized to different-resolution images keep their own
 * zoom-0 baselines, so matching an extent converts through the target's
 * baseline rather than copying the zoom level).
 */
export default function useLinkedViewers(
  aggregateController: Ref<AggregateMediaController>,
) {
  // Setting a pane's center/zoom from a handler must not re-trigger its own listener.
  let guard = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let attached: { viewer: any; handler: () => void }[] = [];

  /** This camera's geojs viewer, or null when it isn't initialized/known yet. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function viewer(camera: string): any {
    try {
      return aggregateController.value.getController(camera).geoViewerRef.value || null;
    } catch {
      return null;
    }
  }

  /** Detach every attached pan/zoom listener. */
  function teardown() {
    attached.forEach(({ viewer: v, handler }) => {
      v.geoOff(geo.event.pan, handler);
      v.geoOff(geo.event.zoom, handler);
    });
    attached = [];
  }

  /** Attach a pan+zoom handler to `camera`'s pane; no-op when it has no viewer yet. */
  function attach(camera: string, handler: () => void) {
    const v = viewer(camera);
    if (!v) {
      return;
    }
    v.geoOn(geo.event.pan, handler);
    v.geoOn(geo.event.zoom, handler);
    attached.push({ viewer: v, handler });
  }

  /** Run `fn` with the re-entrancy guard raised (a no-op while already guarded). */
  function guarded(fn: () => void) {
    if (guard) {
      return;
    }
    guard = true;
    try {
      fn();
    } finally {
      guard = false;
    }
  }

  /** Drive `target` to `view`: center, plus a matching extent via the target's own zoom-0 baseline. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function applyView(target: any, view: LinkedView) {
    if (view.unitsPerPixel !== null) {
      const targetZoom = Math.log2(target.unitsPerPixel(0) / view.unitsPerPixel);
      if (Number.isFinite(targetZoom)) {
        target.zoom(targetZoom);
      }
    }
    target.center(view.center);
  }

  // Only register when invoked from a component setup() (Viewer). Unit tests
  // call these composables imperatively and have no instance to attach to.
  if (getCurrentInstance()) {
    onBeforeUnmount(teardown);
  }
  return {
    viewer, teardown, attach, guarded, applyView,
  };
}
