// @vitest-environment jsdom
/// <reference types="vitest" />
/* eslint-disable max-classes-per-file -- lightweight layer doubles */
import {
  defineComponent, h, ref,
} from 'vue';
import { shallowMount } from '@vue/test-utils';
import Track, { Feature } from '../track';
import CameraStore from '../CameraStore';
import TrackFilterControls from '../TrackFilterControls';
import GroupFilterControls from '../GroupFilterControls';
import type { AnnotationId } from '../BaseAnnotation';
import LayerManager from './LayerManager.vue';

const layerMocks = vi.hoisted(() => {
  const rectangleChangeData = vi.fn();

  class MockLayer {
    bus = { $on: vi.fn() };

    featureLayer = {};

    changeData = vi.fn();

    disable = vi.fn();

    setHoverAnnotations = vi.fn();

    setClickTargetsOnly = vi.fn();

    setDrawingOther = vi.fn();

    updateSettings = vi.fn();

    updateRenderAttributes = vi.fn();

    setType = vi.fn();

    setKey = vi.fn();

    getMode = vi.fn(() => 'disabled');

    clear = vi.fn();

    updatePoints = vi.fn();

    update = vi.fn();

    addDOMWidget = vi.fn();

    setToolTipWidget = vi.fn();

    setDisplayTransform = vi.fn();
  }

  class MockRectangleLayer extends MockLayer {
    changeData = rectangleChangeData;
  }

  return { MockLayer, MockRectangleLayer, rectangleChangeData };
});

const provided = vi.hoisted(() => ({
  values: null as null | Record<string, unknown>,
}));

vi.mock('../layers/AnnotationLayers/RectangleLayer', () => ({
  default: layerMocks.MockRectangleLayer,
}));
vi.mock('../layers/AnnotationLayers/PolygonLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/AnnotationLayers/PointLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/AnnotationLayers/LineLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/AnnotationLayers/TailLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/AnnotationLayers/OverlapLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/AnnotationLayers/RegistrationKeypointLayer', () => ({
  default: layerMocks.MockLayer,
}));
vi.mock('../layers/EditAnnotationLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/LassoSelectionLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/AnnotationLayers/TextLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/AnnotationLayers/AttributeLayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/AnnotationLayers/AttributeBoxLayer', () => ({
  default: layerMocks.MockLayer,
}));
vi.mock('../layers/AnnotationLayers/SegmentationPointsLayer', () => ({
  default: layerMocks.MockLayer,
}));
vi.mock('../layers/UILayers/UILayer', () => ({ default: layerMocks.MockLayer }));
vi.mock('../layers/UILayers/ToolTipWidget.vue', () => ({ default: {} }));

vi.mock('./annotators/useMediaController', () => ({
  injectAggregateController: () => provided.values?.aggregateController,
}));

vi.mock('../provides', () => ({
  useHandler: () => provided.values?.handler,
  useSelectedTrackId: () => provided.values?.selectedTrackId,
  useTrackFilters: () => provided.values?.trackFilters,
  useTrackStyleManager: () => provided.values?.trackStyleManager,
  useEditingMode: () => provided.values?.editingMode,
  useVisibleModes: () => provided.values?.visibleModes,
  useSelectedKey: () => provided.values?.selectedKey,
  useMultiSelectList: () => provided.values?.multiSelectList,
  useAnnotatorPreferences: () => provided.values?.annotatorPreferences,
  useGroupStyleManager: () => provided.values?.groupStyleManager,
  useCameraStore: () => provided.values?.cameraStore,
  useCameraRegistration: () => { throw new Error('not provided'); },
  useAlignedView: () => { throw new Error('not provided'); },
  useSelectedCamera: () => provided.values?.selectedCamera,
  useAttributes: () => provided.values?.attributes,
  useComparisonSets: () => provided.values?.comparisonSets,
  useLassoModeContext: () => ({ setLassoDrawing: vi.fn() }),
  useSegmentationPoints: () => provided.values?.segmentationPoints,
  usePendingSaveCount: () => provided.values?.pendingSaveCount,
}));

vi.mock('./layerManager/useLayerManagerAlignedView', () => ({
  default: () => ({
    alignedDisplayTransform: ref(null),
    alignedDisplayInverse: ref(null),
    mapDisplayPoint: (x: number, y: number) => ({ x, y }),
    mapNativePoint: (x: number, y: number) => [x, y],
    mapEditGeoJSONToNative: (value: unknown) => value,
    featureToDisplay: (value: unknown) => value,
    setupDisplayTransformWatches: vi.fn(),
  }),
}));

vi.mock('./layerManager/useSegmentationPointsLayer', () => ({ default: vi.fn() }));
vi.mock('./layerManager/useAnnotationClickHandling', () => ({
  default: () => ({ wireHandlers: vi.fn() }),
}));

/**
 * `@vue/test-utils` types a mount target as a Vue 2 constructor, which a `defineComponent`
 * SFC is not, so the manager renders from a host. It stays unstubbed to keep shallow
 * semantics for its own children.
 */
function mountLayerManager(props: Record<string, unknown> = {}) {
  const Host = defineComponent({
    setup: () => () => h(LayerManager, { props }),
  });
  return shallowMount(Host, { stubs: { LayerManager: false } });
}

describe('LayerManager hierarchy frame data', () => {
  it('drops a track whose own vector selects no pair without hiding valid frame data', () => {
    const track = new Track(1, {
      confidencePairs: [],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    });
    const validTrack = new Track(2, {
      confidencePairs: [['leaf', 0.8]],
      features: [{ frame: 0, bounds: [1, 1, 2, 2], keyframe: true }],
    });
    const getType = vi.spyOn(track, 'getType');
    const validGetType = vi.spyOn(validTrack, 'getType');
    const trackStore = {
      intervalTree: { search: vi.fn(() => ['1', '2']) },
      getPossible: vi.fn((id: number) => (id === 1 ? track : validTrack)),
    };
    const annotator = {
      frame: ref(0),
      flick: ref(0),
      hasFrame: ref(true),
      imageRevision: ref(0),
      geoViewerRef: ref({}),
      transition: vi.fn(),
    };
    provided.values = {
      aggregateController: ref({
        getController: vi.fn(() => annotator),
        resizeTrigger: ref(0),
      }),
      handler: {},
      selectedTrackId: ref(null),
      trackFilters: {
        enabledAnnotations: ref([{
          annotation: track,
          context: { confidencePairIndex: -1 },
        }, {
          annotation: validTrack,
          context: { confidencePairIndex: 0 },
        }]),
        hierarchyActive: ref(true),
        displayPairIndex: (candidate: Track) => (candidate.confidencePairs.length ? 0 : -1),
      },
      trackStyleManager: {
        stateStyles: {},
        typeStyling: ref({ color: vi.fn(() => '#000000') }),
      },
      editingMode: ref(false),
      visibleModes: ref(['rectangle']),
      selectedKey: ref('bounds'),
      multiSelectList: ref([]),
      annotatorPreferences: ref({
        lockedCamera: { enabled: false },
        suppressionDisplay: {},
        trackTails: { before: 0, after: 0 },
      }),
      groupStyleManager: {
        stateStyles: {},
        typeStyling: ref({ color: vi.fn(() => '#000000') }),
      },
      cameraStore: {
        camMap: ref(new Map([['singleCam', { trackStore, groupStore: {} }]])),
        lookupGroups: vi.fn(() => []),
        defaultGroup: ['unknown', 1],
      },
      selectedCamera: ref('singleCam'),
      attributes: ref([]),
      comparisonSets: ref([]),
      segmentationPoints: ref({ points: [], labels: [], frameNum: 0 }),
      pendingSaveCount: ref(0),
    };

    expect(() => mountLayerManager()).not.toThrow();
    expect(layerMocks.rectangleChangeData).toHaveBeenCalled();
    layerMocks.rectangleChangeData.mock.calls.forEach(([frameData]) => {
      expect(frameData).toHaveLength(1);
      expect(frameData[0]).toMatchObject({
        track: validTrack,
        styleType: ['leaf', 0.8],
      });
    });
    expect(getType).not.toHaveBeenCalled();
    expect(validGetType).toHaveBeenCalledWith(0);
  });
});

const features: Feature[] = [{
  frame: 0, bounds: [0, 0, 10, 10], keyframe: true,
}];

function makeMultiCamFixture(
  left: [string, number][],
  right: [string, number][],
  hierarchy: Record<string, string>,
) {
  const cameraStore = new CameraStore({ markChangesPending: () => undefined });
  cameraStore.removeCamera('singleCam');
  cameraStore.addCamera('left');
  cameraStore.addCamera('right');
  [['left', left], ['right', right]].forEach(([camera, pairs]) => {
    const store = cameraStore.camMap.value.get(camera as string)?.trackStore;
    store?.insert(new Track(1, {
      confidencePairs: pairs as [string, number][],
      features,
    }));
    store?.setEnableSorting();
  });
  const groupFilterControls = new GroupFilterControls({
    sorted: cameraStore.sortedGroups,
    remove: () => undefined,
    markChangesPending: () => undefined,
    setGroupType: () => undefined,
    removeTypes: () => [],
  });
  const trackFilters = new TrackFilterControls({
    sorted: cameraStore.sortedTracks,
    remove: () => undefined,
    markChangesPending: () => undefined,
    lookupGroups: cameraStore.lookupGroups.bind(cameraStore),
    getTracks: (id: AnnotationId) => cameraStore.getTrackAll(id),
    renameTrackPair: (id, currentType, newType) => (
      cameraStore.renameTrackPair(id, currentType, newType)
    ),
    groupFilterControls,
    removeTypes: () => [],
  });
  trackFilters.setTypeHierarchy(hierarchy);
  return { cameraStore, trackFilters };
}

function renderCamera(
  cameraStore: CameraStore,
  trackFilters: TrackFilterControls,
  camera: string,
) {
  const annotator = {
    frame: ref(0),
    flick: ref(0),
    hasFrame: ref(true),
    imageRevision: ref(0),
    geoViewerRef: ref({}),
    transition: vi.fn(),
  };
  provided.values = {
    aggregateController: ref({
      getController: vi.fn(() => annotator),
      resizeTrigger: ref(0),
    }),
    handler: {},
    selectedTrackId: ref(null),
    trackFilters,
    trackStyleManager: {
      stateStyles: {},
      typeStyling: ref({ color: vi.fn(() => '#000000') }),
    },
    editingMode: ref(false),
    visibleModes: ref(['rectangle']),
    selectedKey: ref('bounds'),
    multiSelectList: ref([]),
    annotatorPreferences: ref({
      lockedCamera: { enabled: false },
      suppressionDisplay: {},
      trackTails: { before: 0, after: 0 },
    }),
    groupStyleManager: {
      stateStyles: {},
      typeStyling: ref({ color: vi.fn(() => '#000000') }),
    },
    cameraStore,
    selectedCamera: ref('left'),
    attributes: ref([]),
    comparisonSets: ref([]),
    segmentationPoints: ref({ points: [], labels: [], frameNum: 0 }),
    pendingSaveCount: ref(0),
  };
  layerMocks.rectangleChangeData.mockClear();
  mountLayerManager({ camera });
  const { calls } = layerMocks.rectangleChangeData.mock;
  return calls[calls.length - 1][0] as { styleType: [string, number] }[];
}

describe('LayerManager multicamera hierarchy selection', () => {
  it('renders each camera deepest qualifying pair instead of the merged index', () => {
    const { cameraStore, trackFilters } = makeMultiCamFixture(
      [['root', 0.9], ['leaf', 0.8]],
      [['root', 0.9]],
      { leaf: 'root' },
    );
    expect(renderCamera(cameraStore, trackFilters, 'left')[0].styleType).toEqual(['leaf', 0.8]);
    expect(renderCamera(cameraStore, trackFilters, 'right')[0].styleType).toEqual(['root', 0.9]);
  });

  it('resolves a camera whose vector orders the same types differently', () => {
    const { cameraStore, trackFilters } = makeMultiCamFixture(
      [['fish', 0.9], ['shark', 0.4]],
      [['shark', 0.8], ['fish', 0.3]],
      { shark: 'fish' },
    );
    expect(renderCamera(cameraStore, trackFilters, 'right')[0].styleType).toEqual(['shark', 0.8]);
  });

  it('hides only the camera whose own vector passes no filter', () => {
    const { cameraStore, trackFilters } = makeMultiCamFixture(
      [['root', 0.9], ['leaf', 0.8]],
      [['root', 0.1]],
      { leaf: 'root' },
    );
    trackFilters.setConfidenceFilters({ default: 0.5 });
    expect(renderCamera(cameraStore, trackFilters, 'left')[0].styleType).toEqual(['leaf', 0.8]);
    expect(renderCamera(cameraStore, trackFilters, 'right')).toHaveLength(0);
  });
});
