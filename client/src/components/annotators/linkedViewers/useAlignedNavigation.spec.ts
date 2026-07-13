/// <reference types="vitest" />
import {
  ref, shallowRef, nextTick, Ref,
} from 'vue';
import useAlignedNavigation from './useAlignedNavigation';
import AlignedViewStore from '../../../alignedView/AlignedViewStore';
import type { AggregateMediaController } from '../mediaControllerType';
import type { Matrix3 } from '../../../alignedView/homography';

vi.mock('geojs', () => ({ default: { event: { pan: 'geo_pan', zoom: 'geo_zoom' } } }));

const IDENTITY: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Nominal viewport width for fakeViewer's zoomAndCenterFromBounds. */
const VIEWPORT_PX = 100;

/** Minimal stand-in for a geojs viewer: center/zoom state + geoOn events. */
function fakeViewer(baseUnitsPerPixel: number) {
  const state = { center: { x: 0, y: 0 }, zoom: 0 };
  const handlers: Record<string, Array<() => void>> = {};
  return {
    zoomAndCenterFromBounds(bounds: {
      left: number; top: number; right: number; bottom: number;
    }) {
      // Like geojs: the zoom that fits the bounds' width across the viewport.
      const unitsPerPixel = (bounds.right - bounds.left) / VIEWPORT_PX;
      return {
        zoom: Math.log2(baseUnitsPerPixel / unitsPerPixel),
        center: {
          x: (bounds.left + bounds.right) / 2,
          y: (bounds.top + bounds.bottom) / 2,
        },
      };
    },
    geoOn(evt: string, handler: () => void) {
      handlers[evt] = handlers[evt] || [];
      handlers[evt].push(handler);
    },
    geoOff(evt: string, handler: () => void) {
      handlers[evt] = (handlers[evt] || []).filter((h) => h !== handler);
    },
    center(c?: { x: number; y: number }) {
      if (c) {
        state.center = { ...c };
      }
      return state.center;
    },
    zoom(z?: number) {
      if (z !== undefined) {
        state.zoom = z;
      }
      return state.zoom;
    },
    unitsPerPixel(z: number) {
      return baseUnitsPerPixel / 2 ** z;
    },
    trigger(evt: string) {
      (handlers[evt] || []).forEach((h) => h());
    },
  };
}

function makeHarness() {
  // EO: high-res pane (fine zoom-0 baseline); IR: low-res pane.
  const eo = fakeViewer(1);
  const ir = fakeViewer(8);
  const resetZoom = vi.fn();
  const controllers: Record<string, {
    geoViewerRef: Ref<unknown>;
    resetZoom: () => void;
    originalBounds: Ref<{ left: number; top: number; right: number; bottom: number }>;
  }> = {
    eo: {
      geoViewerRef: ref(eo),
      resetZoom,
      originalBounds: ref({
        left: 0, top: 0, right: 400, bottom: 300,
      }),
    },
    ir: {
      geoViewerRef: ref(ir),
      resetZoom,
      originalBounds: ref({
        left: 0, top: 0, right: 200, bottom: 150,
      }),
    },
  };
  const cameraSync = ref(false);
  const resizing = ref(false);
  const resizeTrigger = ref(0);
  // shallowRef: a plain ref would deep-unwrap the nested cameraSync /
  // resizeTrigger refs, unlike the real aggregate controller object.
  const aggregate = shallowRef({
    cameraSync,
    resizeTrigger,
    resizing,
    getController: (name: string) => controllers[name],
  }) as unknown as Ref<AggregateMediaController>;
  const cameras = ref(['eo', 'ir']);
  const alignedView = new AlignedViewStore();
  const selectedCamera = ref('eo');
  let resetZoomOverride: (() => boolean) | null = null;
  useAlignedNavigation(aggregate, alignedView, cameras, {
    selectedCamera,
    setResetZoomOverride: (override) => { resetZoomOverride = override; },
  });
  return {
    eo,
    ir,
    cameraSync,
    resizing,
    resizeTrigger,
    alignedView,
    resetZoom,
    selectedCamera,
    resetAggregateZoom: () => (resetZoomOverride ? resetZoomOverride() : false),
  };
}

describe('useAlignedNavigation', () => {
  it('snaps panes to the reference view immediately on activation', async () => {
    const { eo, ir, alignedView } = makeHarness();
    eo.center({ x: 250, y: 150 });
    eo.zoom(1); // units-per-pixel = 0.5
    alignedView.setTransforms('eo', {
      eo: IDENTITY,
      ir: [[1, 0, 100], [0, 1, 0], [0, 0, 1]],
    });
    alignedView.setEnabled(true);
    await nextTick();

    // No pan/zoom event fired: activation itself aligned the panes.
    expect(ir.center()).toEqual({ x: 250, y: 150 });
    expect(ir.zoom()).toBeCloseTo(Math.log2(8 / 0.5), 6);
  });

  it('links panes by IDENTITY center in the shared reference space', async () => {
    const { eo, ir, alignedView } = makeHarness();
    // ir's imagery renders warped through ir->eo (translation +100), so its
    // pane coordinates ARE reference coordinates: the link must NOT map the
    // center through the camera-to-camera transform again.
    alignedView.setTransforms('eo', {
      eo: IDENTITY,
      ir: [[1, 0, 100], [0, 1, 0], [0, 0, 1]],
    });
    alignedView.setEnabled(true);
    await nextTick();

    eo.center({ x: 500, y: 300 });
    eo.zoom(2); // source units-per-pixel = 1 / 2^2 = 0.25 reference units
    eo.trigger('geo_pan');

    expect(ir.center()).toEqual({ x: 500, y: 300 });
    // Same reference extent through ir's own zoom-0 baseline:
    // log2(8 / 0.25) = 5.
    expect(ir.zoom()).toBeCloseTo(5, 6);
  });

  it('propagates from the warped pane back to the reference pane identically', async () => {
    const { eo, ir, alignedView } = makeHarness();
    alignedView.setTransforms('eo', {
      eo: IDENTITY,
      ir: [[2, 0, 0], [0, 2, 0], [0, 0, 1]],
    });
    alignedView.setEnabled(true);
    await nextTick();

    ir.center({ x: 40, y: 60 });
    ir.trigger('geo_pan');

    expect(eo.center()).toEqual({ x: 40, y: 60 });
  });

  it('resets every pane to its native view when the aligned view deactivates', async () => {
    const { alignedView, resetZoom } = makeHarness();
    alignedView.setTransforms('eo', { eo: IDENTITY, ir: IDENTITY });
    alignedView.setEnabled(true);
    await nextTick();
    expect(resetZoom).not.toHaveBeenCalled();

    alignedView.setEnabled(false);
    await nextTick();
    // Once per pane (eo + ir).
    expect(resetZoom).toHaveBeenCalledTimes(2);
  });

  it('ignores the native-space pan/zoom events onResize emits while resizing', async () => {
    const {
      eo, ir, resizing, resizeTrigger, alignedView,
    } = makeHarness();
    alignedView.setTransforms('eo', {
      eo: IDENTITY,
      ir: [[1, 0, 100], [0, 1, 0], [0, 0, 1]],
    });
    alignedView.setEnabled(true);
    await nextTick();

    // A good aligned view: both panes centered in the shared reference space.
    eo.center({ x: 500, y: 300 });
    eo.zoom(2);
    eo.trigger('geo_pan');
    expect(ir.center()).toEqual({ x: 500, y: 300 });

    // onResize resets each pane to its OWN native bounds and fires pan events.
    // ir's reset drops it to its native center; while resizing this must NOT be
    // broadcast into the reference space (that is what parked panes in a black
    // corner). eo -- the reference -- must stay put.
    resizing.value = true;
    ir.center({ x: 40, y: 60 });
    ir.trigger('geo_pan');
    expect(eo.center()).toEqual({ x: 500, y: 300 });
    resizing.value = false;

    // The resizeTrigger bump that follows re-snaps every pane from the
    // reference, so ir lands back on the reference-space center.
    resizeTrigger.value += 1;
    await nextTick();
    expect(ir.center()).toEqual({ x: 500, y: 300 });
  });

  it('falls back to the native per-pane reset while the aligned view is inactive', () => {
    const { resetAggregateZoom } = makeHarness();
    expect(resetAggregateZoom()).toBe(false);
  });

  it('center view fits the selected reference camera and mirrors it everywhere', async () => {
    const {
      eo, ir, alignedView, resetAggregateZoom,
    } = makeHarness();
    alignedView.setTransforms('eo', {
      eo: IDENTITY,
      ir: [[1, 0, 100], [0, 1, 0], [0, 0, 1]],
    });
    alignedView.setEnabled(true);
    await nextTick();

    // Wander off, then hit center view with the reference camera selected.
    eo.center({ x: 900, y: 900 });
    eo.trigger('geo_pan');
    expect(resetAggregateZoom()).toBe(true);

    // eo (reference, unwarped): fit its native 400x300 bounds.
    expect(eo.center()).toEqual({ x: 200, y: 150 });
    expect(eo.zoom()).toBeCloseTo(Math.log2(1 / (400 / VIEWPORT_PX)), 6);
    // ir mirrors the same reference-space view through its own zoom-0 baseline.
    expect(ir.center()).toEqual({ x: 200, y: 150 });
    expect(ir.zoom()).toBeCloseTo(Math.log2(8 / (400 / VIEWPORT_PX)), 6);
  });

  it('center view fits a WARPED selected camera via its reference-space bounds', async () => {
    const {
      eo, ir, alignedView, selectedCamera, resetAggregateZoom,
    } = makeHarness();
    // ir's 200x150 native content lands at x:[100,300], y:[0,150] in eo space.
    alignedView.setTransforms('eo', {
      eo: IDENTITY,
      ir: [[1, 0, 100], [0, 1, 0], [0, 0, 1]],
    });
    alignedView.setEnabled(true);
    await nextTick();

    selectedCamera.value = 'ir';
    expect(resetAggregateZoom()).toBe(true);

    // Both panes centered on ir's warped content, NOT its native bounds.
    expect(ir.center()).toEqual({ x: 200, y: 75 });
    expect(ir.zoom()).toBeCloseTo(Math.log2(8 / (200 / VIEWPORT_PX)), 6);
    expect(eo.center()).toEqual({ x: 200, y: 75 });
    expect(eo.zoom()).toBeCloseTo(Math.log2(1 / (200 / VIEWPORT_PX)), 6);
  });

  it('stands down while inactive, suspended, or raw camera sync is on', async () => {
    const {
      eo, ir, cameraSync, alignedView,
    } = makeHarness();
    alignedView.setTransforms('eo', { eo: IDENTITY, ir: IDENTITY });
    alignedView.setEnabled(true);
    await nextTick();

    cameraSync.value = true;
    eo.center({ x: 9, y: 9 });
    eo.trigger('geo_pan');
    expect(ir.center()).toEqual({ x: 0, y: 0 });
    cameraSync.value = false;

    alignedView.setSuspended(true);
    await nextTick();
    eo.trigger('geo_pan');
    expect(ir.center()).toEqual({ x: 0, y: 0 });
  });
});
