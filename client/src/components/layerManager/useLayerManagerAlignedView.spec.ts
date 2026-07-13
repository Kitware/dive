// @vitest-environment jsdom
import { defineComponent, ref, nextTick } from 'vue';
// eslint-disable-next-line import/no-extraneous-dependencies -- @vue/test-utils is only used in tests
import { mount } from '@vue/test-utils';
import type { MediaController, AggregateMediaController } from '../annotators/mediaControllerType';
import AlignedViewStore from '../../alignedView/AlignedViewStore';
import useLayerManagerAlignedView from './useLayerManagerAlignedView';

vi.mock('geojs', () => ({ default: { event: { mouseclick: 'geo_mouseclick' } } }));

/**
 * Minimal geojs stand-ins: enough surface for AlignedImageLayer (createLayer /
 * createFeature / node / draw) and for findQuadMediaSource to discover the
 * "native" media quad layer by scanning viewer.layers().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeQuadFeature(initial: any[] = []) {
  let stored = initial;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feature: any = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: vi.fn((d?: any[]) => {
      if (d === undefined) {
        return stored;
      }
      stored = d;
      return feature;
    }),
    style: vi.fn(() => feature),
    draw: vi.fn(() => feature),
  };
  return feature;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeLayer(feature: any) {
  return {
    createFeature: vi.fn(() => feature),
    features: () => [feature],
    node: () => ({ css: vi.fn(() => '') }),
    visible: vi.fn(),
    draw: vi.fn(),
  };
}

function makeHarness() {
  // The annotator's own media quad: its datum carries the displayed <img>.
  const imgA = { naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement;
  const nativeFeature = makeQuadFeature([{ image: imgA }]);
  const nativeLayer = makeLayer(nativeFeature);

  const warpFeature = makeQuadFeature();
  const warpLayer = makeLayer(warpFeature);

  const viewer = {
    createLayer: vi.fn(() => warpLayer),
    geoOn: vi.fn(),
    layers: () => [nativeLayer, warpLayer],
  };

  const annotator = {
    cameraName: ref('rgb'),
    geoViewerRef: ref(viewer),
    frame: ref(0),
    imageRevision: ref(0),
  } as unknown as MediaController;
  const aggregateController = ref({
    getController: () => annotator,
  } as unknown as AggregateMediaController);

  const alignedView = new AlignedViewStore();
  // Pure translation: non-identity so cameraTransform('rgb') resolves.
  alignedView.setTransforms('ir', { rgb: [[1, 0, 5], [0, 1, -3], [0, 0, 1]], ir: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] });
  alignedView.setEnabled(true);

  let composable!: ReturnType<typeof useLayerManagerAlignedView>;
  const frameNumberRef = ref(0);
  const Host = defineComponent({
    setup() {
      composable = useLayerManagerAlignedView({
        camera: 'rgb',
        annotator,
        aggregateController,
        alignedView,
        editingModeRef: ref(false as const),
      });
      composable.setupDisplayTransformWatches([], () => undefined, frameNumberRef);
      return {};
    },
    template: '<div />',
  });
  const wrapper = mount(Host);
  return {
    wrapper, annotator, nativeFeature, warpFeature, imgA,
  };
}

/** The texture element of the warp quads from the feature's last data() set-call. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function lastWarpSource(warpFeature: any): unknown {
  const setCalls = warpFeature.data.mock.calls.filter((c: unknown[]) => c.length > 0);
  const quads = setCalls[setCalls.length - 1][0];
  return quads.length ? quads[0].image : null;
}

describe('useLayerManagerAlignedView warp refresh', () => {
  it('renders the warp from the displayed element once the transform applies', async () => {
    const { warpFeature, imgA } = makeHarness();
    await nextTick();
    expect(lastWarpSource(warpFeature)).toBe(imgA);
  });

  it('re-renders the warp when imageRevision bumps with a swapped element', async () => {
    const { annotator, nativeFeature, warpFeature } = makeHarness();
    await nextTick();
    // The annotator swaps its displayed <img> (e.g. the percentile-stretch
    // URL remap finishing its load) and bumps imageRevision -- the warp must
    // re-render from the new element with no other trigger.
    const imgB = { naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement;
    nativeFeature.data([{ image: imgB }]);
    annotator.imageRevision.value += 1;
    await nextTick();
    expect(lastWarpSource(warpFeature)).toBe(imgB);
  });

  it('clears the warp instead of rendering while the swapped element is unloaded', async () => {
    const { annotator, nativeFeature, warpFeature } = makeHarness();
    await nextTick();
    const pending = { naturalWidth: 0, naturalHeight: 0 } as HTMLImageElement;
    nativeFeature.data([{ image: pending }]);
    annotator.imageRevision.value += 1;
    await nextTick();
    expect(lastWarpSource(warpFeature)).toBeNull();
    // ...and renders it once the load lands and bumps again.
    const loaded = { naturalWidth: 100, naturalHeight: 50 } as HTMLImageElement;
    nativeFeature.data([{ image: loaded }]);
    annotator.imageRevision.value += 1;
    await nextTick();
    expect(lastWarpSource(warpFeature)).toBe(loaded);
  });
});
