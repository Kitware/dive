/// <reference types="vitest" />
import {
  ref, shallowRef, nextTick, Ref,
} from 'vue';
import useCalibrationNavigation from './useCalibrationNavigation';
import type CameraCalibrationStore from '../../CameraCalibrationStore';
import type { AggregateMediaController } from './mediaControllerType';
import type { Point } from '../../homography';

vi.mock('geojs', () => ({ default: { event: { pan: 'geo_pan', zoom: 'geo_zoom' } } }));

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
  const eo = fakeViewer(1);
  const ir = fakeViewer(8);
  const controllers: Record<string, { geoViewerRef: Ref<unknown> }> = {
    eo: { geoViewerRef: ref(eo) },
    ir: { geoViewerRef: ref(ir) },
  };
  const resizing = ref(false);
  const resizeTrigger = ref(0);
  // shallowRef: a plain ref would deep-unwrap the nested resizing /
  // resizeTrigger refs, unlike the real aggregate controller object.
  const aggregate = shallowRef({
    resizing,
    resizeTrigger,
    getController: (name: string) => controllers[name],
  }) as unknown as Ref<AggregateMediaController>;

  const pickingEnabled = ref(false);
  const linkedNav = ref(false);
  const homographies = ref<Record<string, unknown>>({});
  const fitted = ref(true);
  // eo -> ir is a pure +100 x-translation (and ir -> eo its inverse), so the
  // linked scale is 1 and centers map by simple offset.
  const calibration = {
    pickingEnabled,
    linkedNav,
    activePair: ref({ camA: 'eo', camB: 'ir' }),
    homographies,
    recenterRequest: ref(null),
    linkedPoint(camera: string, coord: Point) {
      if (!fitted.value) {
        return null;
      }
      if (camera === 'eo') {
        return { camera: 'ir', coord: [coord[0] + 100, coord[1]] as Point };
      }
      return { camera: 'eo', coord: [coord[0] - 100, coord[1]] as Point };
    },
  } as unknown as CameraCalibrationStore;

  useCalibrationNavigation(aggregate, calibration);
  return {
    eo, ir, pickingEnabled, linkedNav, homographies, fitted,
  };
}

describe('useCalibrationNavigation', () => {
  it('snaps the pair immediately when "Fit pan/zoom" turns on', async () => {
    const {
      eo, ir, pickingEnabled, linkedNav,
    } = makeHarness();
    pickingEnabled.value = true;
    await nextTick();
    eo.center({ x: 250, y: 150 });
    eo.zoom(1); // units-per-pixel = 0.5

    // Off: nothing linked yet.
    expect(ir.center()).toEqual({ x: 0, y: 0 });

    linkedNav.value = true;
    await nextTick();

    // No pan/zoom event fired: the toggle itself lined the pair up.
    expect(ir.center()).toEqual({ x: 350, y: 150 });
    // Matching extent (scale 1) through ir's own zoom-0 baseline: log2(8 / 0.5).
    expect(ir.zoom()).toBeCloseTo(4, 6);
  });

  it('re-snaps when the fitted homography changes under the link', async () => {
    const {
      eo, ir, pickingEnabled, linkedNav, homographies,
    } = makeHarness();
    pickingEnabled.value = true;
    linkedNav.value = true;
    await nextTick();

    eo.center({ x: 10, y: 20 });
    homographies.value = { 'eo|ir': 'refit' };
    await nextTick();

    expect(ir.center()).toEqual({ x: 110, y: 20 });
  });

  it('does not snap while no fit exists yet', async () => {
    const {
      ir, pickingEnabled, linkedNav, fitted,
    } = makeHarness();
    fitted.value = false;
    pickingEnabled.value = true;
    linkedNav.value = true;
    await nextTick();

    expect(ir.center()).toEqual({ x: 0, y: 0 });
    expect(ir.zoom()).toBe(0);
  });
});
