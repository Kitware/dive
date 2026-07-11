/// <reference types="vitest" />
import {
  ref, shallowRef, nextTick, Ref,
} from 'vue';
import useAlignedNavigation from './useAlignedNavigation';
import AlignedViewStore from '../../../AlignedViewStore';
import type { AggregateMediaController } from '../mediaControllerType';
import type { Matrix3 } from '../../../homography';

vi.mock('geojs', () => ({ default: { event: { pan: 'geo_pan', zoom: 'geo_zoom' } } }));

const IDENTITY: Matrix3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/** Minimal stand-in for a geojs viewer: center/zoom state + geoOn events. */
function fakeViewer(baseUnitsPerPixel: number) {
  const state = { center: { x: 0, y: 0 }, zoom: 0 };
  const handlers: Record<string, Array<() => void>> = {};
  return {
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
  const controllers: Record<string, { geoViewerRef: Ref<unknown>; resetZoom: () => void }> = {
    eo: { geoViewerRef: ref(eo), resetZoom },
    ir: { geoViewerRef: ref(ir), resetZoom },
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
  useAlignedNavigation(aggregate, alignedView, cameras);
  return {
    eo, ir, cameraSync, resizing, resizeTrigger, alignedView, resetZoom,
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
