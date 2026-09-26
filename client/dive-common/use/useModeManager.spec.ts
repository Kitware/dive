// @vitest-environment jsdom
/**
 * Functional tests for the Align View cross-camera mirror: drawing/editing a
 * track on one camera while the aligned view is active re-projects the
 * geometry onto every other aligned camera under the same track id.
 */
import { ref, shallowRef } from 'vue';
import CameraStore from 'vue-media-annotator/CameraStore';
import { AnnotationHistory } from 'dive-common/use/annotationUndo';
import AlignedViewStore from 'vue-media-annotator/alignedView/AlignedViewStore';
import TrackFilterControls from 'vue-media-annotator/TrackFilterControls';
import GroupFilterControls from 'vue-media-annotator/GroupFilterControls';
import { IDENTITY3 } from 'vue-media-annotator/alignedView/alignedView';
import type { Matrix3 } from 'vue-media-annotator/alignedView/homography';
import type { AggregateMediaController } from 'vue-media-annotator/components/annotators/mediaControllerType';
import type { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import type { MarkChangesPending } from 'vue-media-annotator/BaseAnnotationStore';
import Track from 'vue-media-annotator/track';
import { ROTATION_ATTRIBUTE_NAME } from 'vue-media-annotator/utils';
import { clientSettings } from 'dive-common/store/settings';
import useModeManager, {
  type NewAnnotationGeometryParams,
  type StereoAnnotationCompleteParams,
} from './useModeManager';
import HeadTail from '../recipes/headtail';
import SegmentationPointClick from '../recipes/segmentationpointclick';
import { headTailFeatures } from '../../src/headTail';
import type Recipe from '../../src/recipe';

function translation(tx: number, ty: number): Matrix3 {
  return [[1, 0, tx], [0, 1, ty], [0, 0, 1]];
}

it('undoes a segmentation refinement without the tool reset deleting the restored mask', async () => {
  const recipe = new SegmentationPointClick();
  let history: AnnotationHistory;
  const { cameraStore, modeManager } = makeHarness((change) => history?.record(change), [recipe]);
  history = new AnnotationHistory(cameraStore);
  history.start();
  const id = modeManager.handler.trackAdd();
  const first = [[0, 0], [10, 0], [10, 10]];
  const second = [[0, 0], [20, 0], [20, 20]];
  const predict = (polygon: number[][]) => recipe.bus.$emit('prediction-ready', {
    frameNum: 0, polygon, bounds: null, controlPoints: { points: [[5, 5]], labels: [1] },
  });
  predict(first); await Promise.resolve();
  const before = JSON.parse(JSON.stringify(cameraStore.getTrack(id, 'left').serialize()));
  predict(second); await Promise.resolve();
  expect(history.undo(modeManager.handler.prepareAnnotationUndo)).toBe(true);
  expect(cameraStore.getTrack(id, 'left').serialize()).toEqual(before);
  expect(modeManager.selectedTrackId.value).toBeNull();
  expect(modeManager.editingTrack.value).toBe(false);
  // No stale reset event can remove the restored geometry after undo.
  recipe.bus.$emit('prediction-reset', { frameNum: 0 });
  expect(cameraStore.getTrack(id, 'left').serialize()).toEqual(before);
});

function makeHarness(
  markChangesPending: MarkChangesPending = () => undefined,
  recipes: Recipe[] = [],
  onStereoAnnotationComplete: ((params: StereoAnnotationCompleteParams) => void) | undefined = undefined,
) {
  const cameraStore = new CameraStore({ markChangesPending });
  cameraStore.removeCamera('singleCam');
  cameraStore.addCamera('left');
  cameraStore.addCamera('right');

  // right -> reference(left) shifts x by -100, so left -> right adds +100.
  const alignedView = new AlignedViewStore();
  alignedView.setTransforms('left', {
    left: IDENTITY3,
    right: translation(-100, 0),
  });
  alignedView.setEnabled(true);

  const perCamera: Record<string, { frame: ReturnType<typeof ref>; hasFrame: ReturnType<typeof ref> }> = {
    left: { frame: ref(0), hasFrame: ref(true) },
    right: { frame: ref(0), hasFrame: ref(true) },
  };
  const aggregateController = shallowRef({
    frame: ref(0),
    nextFrame: () => undefined,
    seekCameraFrame: () => undefined,
    getController: (name: string) => perCamera[name],
  } as unknown as AggregateMediaController);

  const groupFilterControls = new GroupFilterControls({
    sorted: cameraStore.sortedGroups,
    remove: () => undefined,
    markChangesPending: () => undefined,
    setGroupType: () => undefined,
    removeTypes: () => [],
  });
  const trackFilterControls = new TrackFilterControls({
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

  const newGeometryEvents: NewAnnotationGeometryParams[] = [];
  const modeManager = useModeManager({
    cameraStore,
    trackFilterControls,
    groupFilterControls,
    aggregateController,
    readonlyState: ref(false),
    onNewAnnotationGeometry: (params) => newGeometryEvents.push(params),
    recipes,
    alignedView,
    onStereoAnnotationComplete,
  });
  modeManager.selectedCamera.value = 'left';
  return {
    cameraStore, alignedView, modeManager, perCamera, newGeometryEvents,
  };
}

describe('useModeManager aligned-view track mirroring', () => {
  it('mirrors a drawn rectangle onto the other camera, creating the same-id track', () => {
    const { cameraStore, modeManager } = makeHarness();
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.updateRectBounds(0, 0, [10, 20, 30, 40]);

    const mirrored = cameraStore.getPossibleTrack(trackId, 'right');
    expect(mirrored).toBeDefined();
    expect(mirrored?.features[0]?.bounds).toEqual([110, 20, 130, 40]);
    expect(mirrored?.confidencePairs[0][0])
      .toEqual(cameraStore.getTrack(trackId, 'left').confidencePairs[0][0]);
  });

  it('continuously re-mirrors subsequent edits (continuous mirror)', () => {
    const { cameraStore, modeManager } = makeHarness();
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.updateRectBounds(0, 0, [10, 20, 30, 40]);
    modeManager.handler.trackSelect(trackId, true);
    modeManager.handler.updateRectBounds(0, 0, [50, 60, 70, 80]);

    const mirrored = cameraStore.getTrack(trackId, 'right');
    expect(mirrored.features[0]?.bounds).toEqual([150, 60, 170, 80]);
  });

  it('mirrors polygon geometry coordinates into the target camera space', () => {
    const { cameraStore, modeManager } = makeHarness();
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.setTrackFeature(0, [0, 0, 4, 4], [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [4, 0], [4, 4], [0, 0]]] },
      properties: { key: '' },
    }]);

    const mirrored = cameraStore.getTrack(trackId, 'right');
    expect(mirrored.features[0]?.bounds).toEqual([100, 0, 104, 4]);
    const polygon = mirrored.features[0]?.geometry?.features[0];
    expect(polygon?.geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[100, 0], [104, 0], [104, 4], [100, 0]]],
    });
  });

  it('maps through per-camera local frames when they diverge (aligned timeline)', () => {
    const { cameraStore, modeManager, perCamera } = makeHarness();
    perCamera.left.frame.value = 5;
    perCamera.right.frame.value = 8;
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.updateRectBounds(5, 0, [10, 20, 30, 40]);

    const mirrored = cameraStore.getTrack(trackId, 'right');
    expect(mirrored.features[8]?.bounds).toEqual([110, 20, 130, 40]);
    expect(mirrored.features[5]).toBeUndefined();
  });

  it('skips cameras with no frame at the current aligned slot', () => {
    const { cameraStore, modeManager, perCamera } = makeHarness();
    perCamera.right.hasFrame.value = false;
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.updateRectBounds(0, 0, [10, 20, 30, 40]);

    expect(cameraStore.getPossibleTrack(trackId, 'right')).toBeUndefined();
  });

  it('does not mirror when the aligned view is disabled', () => {
    const { cameraStore, alignedView, modeManager } = makeHarness();
    alignedView.setEnabled(false);
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.updateRectBounds(0, 0, [10, 20, 30, 40]);

    expect(cameraStore.getPossibleTrack(trackId, 'right')).toBeUndefined();
    expect(cameraStore.getTrack(trackId, 'left').features[0]?.bounds).toEqual([10, 20, 30, 40]);
  });

  it('mirrors the whole source vector onto a newly created counterpart', () => {
    const { cameraStore, modeManager } = makeHarness();
    const trackId = modeManager.handler.trackAdd();
    const source = cameraStore.getTrack(trackId, 'left');
    source.setType('leaf', 0.8);
    modeManager.handler.updateRectBounds(0, 0, [10, 20, 30, 40]);

    const mirrored = cameraStore.getTrack(trackId, 'right');
    expect(mirrored.confidencePairs).toEqual(source.confidencePairs);
    expect(mirrored.confidencePairs).not.toBe(source.confidencePairs);
  });

  it('does not mirror while the aligned view is suspended (registration picking)', () => {
    const { cameraStore, alignedView, modeManager } = makeHarness();
    alignedView.setSuspended(true);
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.updateRectBounds(0, 0, [10, 20, 30, 40]);

    expect(cameraStore.getPossibleTrack(trackId, 'right')).toBeUndefined();
  });
});

function makeSingleCamHarness() {
  const cameraStore = new CameraStore({ markChangesPending: () => undefined });
  const aggregateController = shallowRef({
    frame: ref(0),
    nextFrame: () => undefined,
    seekCameraFrame: () => undefined,
    getController: () => ({ frame: ref(0), hasFrame: ref(true) }),
  } as unknown as AggregateMediaController);
  const groupFilterControls = new GroupFilterControls({
    sorted: cameraStore.sortedGroups,
    remove: () => undefined,
    markChangesPending: () => undefined,
    setGroupType: () => undefined,
    removeTypes: () => [],
  });
  const trackFilterControls = new TrackFilterControls({
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
  const newGeometryEvents: NewAnnotationGeometryParams[] = [];
  const modeManager = useModeManager({
    cameraStore,
    trackFilterControls,
    groupFilterControls,
    aggregateController,
    readonlyState: ref(false),
    onNewAnnotationGeometry: (params) => newGeometryEvents.push(params),
    recipes: [],
  });
  return { cameraStore, modeManager, trackFilterControls };
}

describe('useModeManager counterpart creation', () => {
  it('copies the source confidence vector onto the counterpart camera track', () => {
    const { cameraStore, modeManager } = makeHarness();
    cameraStore.camMap.value.get('left')?.trackStore.insert(new Track(9, {
      confidencePairs: [['root', 0.9], ['leaf', 0.8]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    }));
    modeManager.selectedCamera.value = 'right';
    modeManager.handler.trackAdd(9);

    const source = cameraStore.getTrack(9, 'left');
    const counterpart = cameraStore.getTrack(9, 'right');
    expect(counterpart.confidencePairs).toEqual([['root', 0.9], ['leaf', 0.8]]);
    expect(counterpart.confidencePairs).not.toBe(source.confidencePairs);
    expect(counterpart.confidencePairs[0]).not.toBe(source.confidencePairs[0]);
  });
});

describe('useModeManager multicamera merge', () => {
  it('canonicalizes every target and source replica before removing sources', () => {
    const changes: string[] = [];
    const { cameraStore, modeManager } = makeHarness((change) => {
      changes.push(`${change.action}:${change.track?.id}`);
    });
    const leftStore = cameraStore.camMap.value.get('left')?.trackStore;
    const rightStore = cameraStore.camMap.value.get('right')?.trackStore;
    leftStore?.insert(new Track(1, {
      confidencePairs: [['fish', 0.4]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    }), { imported: true });
    leftStore?.insert(Track.fromJSON({
      id: 2,
      begin: 1,
      end: 1,
      attributes: {},
      confidencePairs: [['fish', 0.7]],
      features: [{ frame: 1, bounds: [1, 1, 2, 2], keyframe: true }],
    }), { imported: true });
    leftStore?.insert(Track.fromJSON({
      id: 3,
      begin: 2,
      end: 2,
      attributes: {},
      confidencePairs: [['turtle', 0.8]],
      features: [{ frame: 2, bounds: [2, 2, 3, 3], keyframe: true }],
    }), { imported: true });
    rightStore?.insert(new Track(1, {
      confidencePairs: [['rock', 0.6]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    }), { imported: true });
    rightStore?.insert(Track.fromJSON({
      id: 2,
      begin: 1,
      end: 1,
      attributes: {},
      confidencePairs: [['shark', 0.9]],
      features: [{ frame: 1, bounds: [1, 1, 2, 2], keyframe: true }],
    }), { imported: true });
    const leftTarget = cameraStore.getTrack(1, 'left');
    const setConfidencePairs = leftTarget.setConfidencePairs.bind(leftTarget);
    vi.spyOn(leftTarget, 'setConfidencePairs').mockImplementation((pairs) => {
      changes.push('canonical:left');
      setConfidencePairs(pairs);
    });
    const rightTarget = cameraStore.getTrack(1, 'right');
    const setRightConfidencePairs = rightTarget.setConfidencePairs.bind(rightTarget);
    vi.spyOn(rightTarget, 'setConfidencePairs').mockImplementation((pairs) => {
      changes.push('canonical:right');
      setRightConfidencePairs(pairs);
    });
    modeManager.multiSelectList.value = [1, 2, 3];

    modeManager.handler.commitMerge();

    const leftPairs = cameraStore.getTrack(1, 'left').confidencePairs;
    const rightPairs = cameraStore.getTrack(1, 'right').confidencePairs;
    expect(leftPairs).toEqual([
      ['shark', 0.9], ['turtle', 0.8], ['fish', 0.7], ['rock', 0.6],
    ]);
    expect(rightPairs).toEqual(leftPairs);
    expect(rightPairs).not.toBe(leftPairs);
    expect(cameraStore.getPossibleTrack(2, 'left')).toBeUndefined();
    expect(cameraStore.getPossibleTrack(2, 'right')).toBeUndefined();
    expect(cameraStore.getPossibleTrack(3, 'left')).toBeUndefined();
    ['canonical:left', 'canonical:right'].forEach((canonical) => {
      expect(changes.indexOf(canonical)).toBeLessThan(changes.indexOf('delete:2'));
      expect(changes.indexOf(canonical)).toBeLessThan(changes.indexOf('delete:3'));
    });
  });

  it('creates a target replica in a source-only camera without losing local data', () => {
    const { cameraStore, modeManager } = makeHarness();
    const leftStore = cameraStore.camMap.value.get('left')?.trackStore;
    const rightStore = cameraStore.camMap.value.get('right')?.trackStore;
    leftStore?.insert(Track.fromJSON({
      id: 2,
      begin: 4,
      end: 4,
      attributes: { camera: 'left' },
      confidencePairs: [['fish', 0.8]],
      features: [{ frame: 4, bounds: [4, 5, 6, 7], keyframe: true }],
    }), { imported: true });
    rightStore?.insert(new Track(1, {
      confidencePairs: [['shark', 0.9]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    }), { imported: true });
    modeManager.multiSelectList.value = [1, 2];

    modeManager.handler.commitMerge();

    const leftTarget = cameraStore.getTrack(1, 'left');
    const rightTarget = cameraStore.getTrack(1, 'right');
    expect(leftTarget.features[4]?.bounds).toEqual([4, 5, 6, 7]);
    expect(leftTarget.attributes).toEqual({ camera: 'left' });
    expect(leftTarget.confidencePairs).toEqual([['shark', 0.9], ['fish', 0.8]]);
    expect(rightTarget.confidencePairs).toEqual(leftTarget.confidencePairs);
    expect(rightTarget.confidencePairs).not.toBe(leftTarget.confidencePairs);
    expect(rightTarget.confidencePairs[0]).not.toBe(leftTarget.confidencePairs[0]);
    expect(cameraStore.getPossibleTrack(2, 'left')).toBeUndefined();
  });
});

describe('TrackFilterControls construction', () => {
  it('provides complete stored-track enumeration for hierarchy renames', () => {
    const { cameraStore, trackFilterControls } = makeSingleCamHarness();
    const trackStore = cameraStore.camMap.value.get('singleCam')?.trackStore;
    trackStore?.insert(new Track(7, {
      confidencePairs: [['leaf', 1], ['root', 0.8]],
      features: [{ frame: 0, bounds: [0, 0, 1, 1], keyframe: true }],
    }));
    trackStore?.setEnableSorting();
    trackFilterControls.setTypeHierarchy({ leaf: 'root' });
    trackFilterControls.updateTypeName({ currentType: 'leaf', newType: 'fin' });
    expect(cameraStore.getTrack(7).confidencePairs).toEqual([
      ['fin', 1], ['root', 0.8],
    ]);
  });
});

describe('useModeManager polygon clip on box resize', () => {
  // Triangle that sticks past x=20; clipping to [0,0,20,40] leaves a non-box shape.
  const stickingOutPolygon = {
    type: 'Feature' as const,
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[[0, 0], [40, 0], [0, 40], [0, 0]]],
    },
    properties: { key: '' },
  };

  it('clips polygons that stick outside a resized axis-aligned box', () => {
    const { cameraStore, modeManager } = makeSingleCamHarness();
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.setTrackFeature(0, [0, 0, 40, 40], [stickingOutPolygon]);
    modeManager.handler.trackSelect(trackId, true);
    modeManager.handler.updateRectBounds(0, 0, [0, 0, 20, 40]);

    const poly = cameraStore.getTrack(trackId).features[0]?.geometry?.features[0];
    expect(poly?.geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [20, 0], [20, 20], [0, 40], [0, 0]]],
    });
  });

  it('translates polygons with the box on a pure move (does not clip)', () => {
    const { cameraStore, modeManager } = makeSingleCamHarness();
    const trackId = modeManager.handler.trackAdd();
    // Polygon inset inside the box so a naive clip-on-move would shrink it.
    const insetPolygon = {
      type: 'Feature' as const,
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[[5, 5], [25, 5], [25, 25], [5, 25], [5, 5]]],
      },
      properties: { key: '' },
    };
    modeManager.handler.setTrackFeature(0, [0, 0, 40, 40], [insetPolygon]);
    modeManager.handler.trackSelect(trackId, true);
    modeManager.handler.updateRectBounds(0, 0, [10, 5, 50, 45]);

    const poly = cameraStore.getTrack(trackId).features[0]?.geometry?.features[0];
    expect(poly?.geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[15, 10], [35, 10], [35, 30], [15, 30], [15, 10]]],
    });
  });

  it('does not clip when the detection already has significant stored rotation', () => {
    const { cameraStore, modeManager } = makeSingleCamHarness();
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.setTrackFeature(0, [0, 0, 40, 40], [stickingOutPolygon]);
    cameraStore.getTrack(trackId).setFeatureAttribute(0, ROTATION_ATTRIBUTE_NAME, Math.PI / 4);
    modeManager.handler.trackSelect(trackId, true);
    // Omit rotation arg — must still consult the stored attribute
    modeManager.handler.updateRectBounds(0, 0, [0, 0, 20, 40]);

    const poly = cameraStore.getTrack(trackId).features[0]?.geometry?.features[0];
    expect(poly?.geometry).toEqual(stickingOutPolygon.geometry);
  });

  it('clips when rotation is explicitly cleared (0) even if stored rotation existed', () => {
    const { cameraStore, modeManager } = makeSingleCamHarness();
    const trackId = modeManager.handler.trackAdd();
    modeManager.handler.setTrackFeature(0, [0, 0, 40, 40], [stickingOutPolygon]);
    cameraStore.getTrack(trackId).setFeatureAttribute(0, ROTATION_ATTRIBUTE_NAME, Math.PI / 4);
    modeManager.handler.trackSelect(trackId, true);
    modeManager.handler.updateRectBounds(0, 0, [0, 0, 20, 40], 0);

    const poly = cameraStore.getTrack(trackId).features[0]?.geometry?.features[0];
    expect(poly?.geometry).toEqual({
      type: 'Polygon',
      coordinates: [[[0, 0], [20, 0], [20, 20], [0, 40], [0, 0]]],
    });
  });
});

describe('centerline editing continuity', () => {
  it('keeps the saved line editable after deleting an interior vertex', () => {
    const recipe = new HeadTail();
    const { cameraStore, modeManager: manager } = makeHarness(undefined, [recipe]);
    const id = manager.handler.trackAdd();
    const track = cameraStore.getTrack(id, 'left');
    track.setFeature({ frame: 0, keyframe: true, bounds: [0, 0, 100, 100] }, headTailFeatures([[10, 10], [50, 50], [90, 10]]));
    recipe.activate();
    manager.handler.selectFeatureHandle(1, 'HeadTails');
    manager.handler.removePoint();
    expect(manager.selectedKey.value).toBe('HeadTails');
    expect(manager.editingMode.value).toBe('LineString');
    expect(manager.editingDetails.value).toBe('Editing');
    expect(manager.selectedFeatureHandle.value).toBe(-1);
    expect(track.getFeatureGeometry(0, { key: 'HeadTails' })[0].geometry.coordinates).toEqual([[10, 10], [90, 10]]);
    // Move an endpoint through the same update path, without reactivating a tool.
    manager.handler.updateGeoJSON('editing', 0, 0, {
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[20, 20], [90, 10]] },
    }, manager.selectedKey.value);
    expect(track.getFeatureGeometry(0, { key: 'HeadTails' })[0].geometry.coordinates).toEqual([[20, 20], [90, 10]]);
    expect(track.features[0].bounds).toEqual([0, 0, 100, 100]);
  });
});

describe('successive auto-populate triggers', () => {
  it('emits a new box for each track, but not again when that box is edited', () => {
    const { modeManager: manager, newGeometryEvents } = makeHarness();
    const first = manager.handler.trackAdd();
    manager.handler.updateRectBounds(0, 0, [0, 0, 10, 10]);
    manager.handler.updateRectBounds(0, 0, [1, 1, 11, 11]);
    const second = manager.handler.trackAdd();
    manager.handler.updateRectBounds(0, 0, [20, 20, 30, 30]);
    expect(newGeometryEvents.map((event) => [event.trackId, event.source])).toEqual([
      [first, 'box'], [second, 'box'],
    ]);
  });

  it('emits again when the same track gets a new box on a later frame', () => {
    const { modeManager: manager, newGeometryEvents } = makeHarness();
    const trackId = manager.handler.trackAdd();
    manager.handler.updateRectBounds(0, 0, [0, 0, 10, 10]);
    manager.handler.updateRectBounds(1, 0, [20, 20, 30, 30]);
    manager.handler.updateRectBounds(1, 0, [21, 21, 31, 31]);
    expect(newGeometryEvents.map((event) => [event.trackId, event.frameNum, event.source])).toEqual([
      [trackId, 0, 'box'], [trackId, 1, 'box'],
    ]);
  });

  it('emits both completed lines when annotations are drawn one after another', () => {
    const recipe = new HeadTail();
    const { modeManager: manager, newGeometryEvents } = makeHarness(undefined, [recipe]);
    const draw = (coordinates: number[][]) => manager.handler.updateGeoJSON('in-progress', 0, 0, {
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates },
    }, 'HeadTails');
    const first = manager.handler.trackAdd();
    recipe.activate();
    draw([[0, 0]]);
    draw([[0, 0], [10, 10]]);
    const second = manager.handler.trackAdd();
    recipe.activate();
    draw([[20, 20]]);
    draw([[20, 20], [30, 30]]);
    expect(newGeometryEvents.map((event) => [event.trackId, event.source])).toEqual([
      [first, 'line'], [second, 'line'],
    ]);
  });

  it('emits again when the same track gets a new line on a later frame', () => {
    const recipe = new HeadTail();
    const { modeManager: manager, newGeometryEvents } = makeHarness(undefined, [recipe]);
    const draw = (frame: number, coordinates: number[][]) => manager.handler.updateGeoJSON('in-progress', frame, 0, {
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates },
    }, 'HeadTails');
    const trackId = manager.handler.trackAdd();
    recipe.activate();
    draw(0, [[0, 0]]);
    draw(0, [[0, 0], [10, 10]]);
    draw(1, [[20, 20]]);
    draw(1, [[20, 20], [30, 30]]);
    // Endpoint edit on frame 1 must not re-emit.
    manager.handler.updateGeoJSON('editing', 1, 0, {
      type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[21, 21], [30, 30]] },
    }, manager.selectedKey.value);
    expect(newGeometryEvents.map((event) => [event.trackId, event.frameNum, event.source])).toEqual([
      [trackId, 0, 'line'], [trackId, 1, 'line'],
    ]);
  });
});

describe('auto-populate of point-segmented masks', () => {
  const polygon: [number, number][] = [[0, 0], [10, 0], [10, 10]];
  const confirm = (recipe: SegmentationPointClick) => recipe.bus.$emit('prediction-confirmed-multi', {
    frames: new Map([[0, { polygon, bounds: null, frameNum: 0 }]]),
  });

  it('emits the mask of a brand-new detection on every click, but not on restore, confirm or a refinement of an existing one', () => {
    const recipe = new SegmentationPointClick();
    const { modeManager: manager, newGeometryEvents } = makeHarness(undefined, [recipe]);
    const fresh = manager.handler.trackAdd();
    const click = () => recipe.bus.$emit('prediction-ready', {
      polygon, bounds: null, frameNum: 0, controlPoints: { points: [[5, 5]], labels: [1] },
    });
    click();
    click();
    recipe.bus.$emit('prediction-ready', { polygon, bounds: null, frameNum: 0 });
    confirm(recipe);
    const event = {
      camera: 'left', trackId: fresh, frameNum: 0, source: 'mask', polygons: [{ exterior: polygon, holes: [] }],
    };
    expect(newGeometryEvents).toEqual([event, event]);

    manager.handler.trackAdd();
    manager.handler.updateRectBounds(0, 0, [0, 0, 10, 10]);
    newGeometryEvents.length = 0;
    click();
    confirm(recipe);
    expect(newGeometryEvents).toEqual([]);
  });
});

describe('useModeManager point segmentation masks', () => {
  const components = [
    { exterior: [[0, 0], [10, 0], [10, 10]] as [number, number][], holes: [[[2, 2], [4, 2], [4, 4]] as [number, number][]] },
    { exterior: [[20, 0], [30, 0], [30, 10]] as [number, number][], holes: [] },
  ];

  it('stores every component with its holes, then drops the ones a refinement loses', () => {
    const recipe = new SegmentationPointClick();
    const { cameraStore, modeManager } = makeHarness(undefined, [recipe]);
    const trackId = modeManager.handler.trackAdd();
    const predicted = (polygons: typeof components) => recipe.bus.$emit('prediction-ready', {
      polygon: polygons[0].exterior,
      polygons,
      bounds: null,
      frameNum: 0,
      controlPoints: { points: [[5, 5]], labels: [1] },
    });

    predicted(components);
    const track = cameraStore.getTrack(trackId, 'left');
    expect(track.getPolygonFeatures(0).map((p) => [p.key, p.holeCount])).toEqual([
      ['SegmentationPolygon', 1], ['SegmentationPolygon-1', 0],
    ]);
    expect(track.getFeature(0)[0]?.bounds).toEqual([0, 0, 30, 10]);

    predicted([components[1]]);
    expect(track.getPolygonFeatures(0).map((p) => p.key)).toEqual(['SegmentationPolygon']);
    expect(track.getFeature(0)[0]?.bounds).toEqual([20, 0, 30, 10]);

    recipe.bus.$emit('prediction-reset', { frameNum: 0 });
    expect(track.getFeature(0)[0]).toBeNull();
  });

  it('lets the emptied detection be deleted after a reset (interval tree stays in sync)', () => {
    const recipe = new SegmentationPointClick();
    const { cameraStore, modeManager } = makeHarness(undefined, [recipe]);
    const trackId = modeManager.handler.trackAdd();
    recipe.bus.$emit('prediction-ready', {
      polygon: [[0, 0], [10, 0], [10, 10]],
      bounds: null,
      frameNum: 0,
      controlPoints: { points: [[5, 5]], labels: [1] },
    });
    recipe.bus.$emit('prediction-ready', {
      polygon: [[0, 0], [20, 0], [20, 20]],
      bounds: null,
      frameNum: 0,
      controlPoints: { points: [[5, 5], [8, 8]], labels: [1, 1] },
    });
    recipe.bus.$emit('prediction-reset', { frameNum: 0 });
    const track = cameraStore.getTrack(trackId, 'left');
    expect(track.begin).toBe(Infinity);
    expect(track.end).toBe(0);
    expect(() => modeManager.handler.removeTrack([trackId], true)).not.toThrow();
    expect(cameraStore.getPossibleTrack(trackId, 'left')).toBeUndefined();
  });

  it('clears the pending mask on every Reset, including a second segmentation pass', () => {
    const recipe = new SegmentationPointClick();
    const { cameraStore, modeManager } = makeHarness(undefined, [recipe]);
    const trackId = modeManager.handler.trackAdd();
    const predict = (polygon: [number, number][]) => recipe.bus.$emit('prediction-ready', {
      polygon, bounds: null, frameNum: 0, controlPoints: { points: [[5, 5]], labels: [1] },
    });

    predict([[0, 0], [10, 0], [10, 10]]);
    expect(cameraStore.getTrack(trackId, 'left').getPolygonFeatures(0)).toHaveLength(1);
    recipe.resetPoints();
    expect(cameraStore.getTrack(trackId, 'left').getFeature(0)[0]).toBeNull();
    expect(recipe.hasPoints()).toBe(false);
    expect(recipe.hasPendingPrediction()).toBe(false);

    predict([[0, 0], [20, 0], [20, 20]]);
    expect(cameraStore.getTrack(trackId, 'left').getPolygonFeatures(0)).toHaveLength(1);
    recipe.resetPoints();
    expect(cameraStore.getTrack(trackId, 'left').getFeature(0)[0]).toBeNull();
  });
});

describe('stereo mapping of a line being drawn', () => {
  it('waits for both ends instead of mapping the first one alone', () => {
    const wasAutoCompute = clientSettings.stereoSettings.autoComputeOtherCamera;
    clientSettings.stereoSettings.autoComputeOtherCamera = true;
    try {
      const recipe = new HeadTail();
      const events: StereoAnnotationCompleteParams[] = [];
      const { modeManager: manager } = makeHarness(undefined, [recipe], (params) => events.push(params));
      manager.handler.trackAdd();
      recipe.activate();
      const draw = (coordinates: number[][]) => manager.handler.updateGeoJSON('in-progress', 0, 0, {
        type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates },
      }, 'HeadTails');
      draw([[10, 10]]);
      expect(events).toEqual([]);
      draw([[10, 10], [90, 10]]);
      expect(events.map((e) => e.type)).toEqual(['line']);
    } finally {
      clientSettings.stereoSettings.autoComputeOtherCamera = wasAutoCompute;
    }
  });
});

describe('a point segmentation of a detection that already has a polygon', () => {
  const existing: GeoJSON.Feature = {
    type: 'Feature',
    properties: { key: '' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [40, 0], [40, 40], [0, 0]]] },
  };

  it('replaces the polygon with the mask, and a reset brings it back', () => {
    const recipe = new SegmentationPointClick();
    const { cameraStore, modeManager: manager } = makeHarness(undefined, [recipe]);
    const trackId = manager.handler.trackAdd();
    const track = cameraStore.getTrack(trackId, 'left');
    track.setFeature({ frame: 0, keyframe: true, bounds: [0, 0, 40, 40] }, [existing as never]);
    expect(track.getPolygonFeatures(0).map((p) => p.key)).toEqual(['']);

    recipe.bus.$emit('prediction-ready', {
      polygon: [[5, 5], [20, 5], [20, 20]], bounds: null, frameNum: 0, controlPoints: { points: [[10, 10]], labels: [1] },
    });
    expect(track.getPolygonFeatures(0).map((p) => p.key)).toEqual(['SegmentationPolygon']);

    recipe.bus.$emit('prediction-reset', { frameNum: 0 });
    expect(track.getPolygonFeatures(0).map((p) => p.key)).toEqual(['']);
    expect(track.getFeature(0)[0]?.bounds).toEqual([0, 0, 40, 40]);
  });
});

describe('entering polygon editing', () => {
  const polygon = (key: string): GeoJSON.Feature<GeoJSON.Polygon> => ({
    type: 'Feature',
    properties: { key },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 0]]] },
  });

  it('lands on the keyed mask a detection already has', () => {
    const { cameraStore, modeManager: manager } = makeHarness();
    const id = manager.handler.trackAdd();
    cameraStore.getTrack(id, 'left').setFeature({ frame: 0, keyframe: true, bounds: [0, 0, 10, 10] }, [polygon('SegmentationPolygon')]);
    manager.handler.setAnnotationState({ editing: 'LineString', key: 'HeadTails' });
    manager.handler.setAnnotationState({ editing: 'Polygon', key: '' });
    expect(manager.selectedKey.value).toBe('SegmentationPolygon');
  });

  it('keeps the default polygon and an explicitly requested new key', () => {
    const { cameraStore, modeManager: manager } = makeHarness();
    const id = manager.handler.trackAdd();
    cameraStore.getTrack(id, 'left').setFeature({ frame: 0, keyframe: true, bounds: [0, 0, 10, 10] }, [polygon(''), polygon('1')]);
    manager.handler.setAnnotationState({ editing: 'Polygon', key: '' });
    expect(manager.selectedKey.value).toBe('');
    manager.handler.setAnnotationState({ editing: 'Polygon', key: '2' });
    expect(manager.selectedKey.value).toBe('2');
  });
});

describe('confirming a point segmentation', () => {
  it('leaves edit mode with the detection still selected, and removes one with nothing drawn', () => {
    const recipe = new SegmentationPointClick();
    const { modeManager: manager, cameraStore } = makeHarness(undefined, [recipe]);
    recipe.activate();
    const drawn = manager.handler.trackAdd();
    manager.handler.updateRectBounds(0, 0, [0, 0, 10, 10]);
    manager.handler.trackEdit(drawn);
    recipe.resetPoints();
    manager.handler.confirmRecipe();
    expect(manager.selectedTrackId.value).toBe(drawn);
    expect(manager.editingTrack.value).toBe(false);
    expect(recipe.active.value).toBe(true);

    const empty = manager.handler.trackAdd();
    recipe.resetPoints();
    manager.handler.confirmRecipe();
    expect(manager.selectedTrackId.value).toBeNull();
    expect(cameraStore.getPossibleTrack(empty, 'left')).toBeUndefined();
    expect(cameraStore.getPossibleTrack(drawn, 'left')).toBeDefined();
  });
});

describe('stereo copy of a point-segmented mask', () => {
  it('runs once per click and not again when the mask is confirmed', () => {
    const wasAutoCompute = clientSettings.stereoSettings.autoComputeOtherCamera;
    clientSettings.stereoSettings.autoComputeOtherCamera = true;
    try {
      const recipe = new SegmentationPointClick();
      const events: StereoAnnotationCompleteParams[] = [];
      const { modeManager: manager } = makeHarness(undefined, [recipe], (params) => events.push(params));
      manager.handler.trackAdd();
      const result = {
        polygon: [[0, 0], [10, 0], [10, 10]] as [number, number][],
        bounds: null,
        frameNum: 0,
        controlPoints: { points: [[5, 5]] as [number, number][], labels: [1] },
      };
      recipe.bus.$emit('prediction-ready', result);
      expect(events.map((e) => e.type)).toEqual(['segmentation']);
      recipe.bus.$emit('prediction-confirmed', result);
      recipe.bus.$emit('prediction-confirmed-multi', { frames: new Map([[0, result]]) });
      expect(events.map((e) => e.type)).toEqual(['segmentation']);
    } finally {
      clientSettings.stereoSettings.autoComputeOtherCamera = wasAutoCompute;
    }
  });
});

describe('a right-click that enters point segmentation editing', () => {
  const press = () => document.dispatchEvent(new MouseEvent('mousedown', { button: 2 }));
  it('is not finalized by the contextmenu that follows it, unlike a later right-click or a user reset', () => {
    const recipe = new SegmentationPointClick();
    const { modeManager: manager } = makeHarness(undefined, [recipe]);
    recipe.activate();
    const first = manager.handler.trackAdd();
    manager.handler.updateRectBounds(0, 0, [0, 0, 10, 10]);
    const second = manager.handler.trackAdd();
    manager.handler.updateRectBounds(0, 0, [20, 20, 30, 30]);
    expect(manager.selectedTrackId.value).toBe(second);
    // Selecting another detection clears the recipe, but not as a user reset.
    press();
    manager.handler.trackEdit(first);
    expect(manager.selectedTrackId.value).toBe(first);
    expect(manager.editingTrack.value).toBe(true);
    expect(recipe.wasReset).toBe(false);
    // On Windows the contextmenu of that right-click arrives after edit mode began.
    manager.handler.confirmRecipe();
    expect(manager.selectedTrackId.value).toBe(first);
    expect(manager.editingTrack.value).toBe(true);
    // A later right-click with no points placed leaves edit mode with the
    // detection still selected, as the other annotation types do.
    press();
    manager.handler.confirmRecipe();
    expect(manager.selectedTrackId.value).toBe(first);
    expect(manager.editingTrack.value).toBe(false);
    // So does one after a reset by the user, even within the same press.
    press();
    manager.handler.trackEdit(second);
    recipe.resetPoints();
    expect(recipe.wasReset).toBe(true);
    manager.handler.confirmRecipe();
    expect(manager.selectedTrackId.value).toBe(second);
    expect(manager.editingTrack.value).toBe(false);
    // With nothing selected a right-click changes nothing.
    manager.handler.trackSelect(null, false);
    press();
    manager.handler.confirmRecipe();
    expect(recipe.active.value).toBe(true);
  });
});
