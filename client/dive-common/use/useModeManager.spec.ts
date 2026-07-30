/// <reference types="vitest" />
/**
 * Functional tests for the Align View cross-camera mirror: drawing/editing a
 * track on one camera while the aligned view is active re-projects the
 * geometry onto every other aligned camera under the same track id.
 */
import { ref } from 'vue';
import CameraStore from 'vue-media-annotator/CameraStore';
import AlignedViewStore from 'vue-media-annotator/alignedView/AlignedViewStore';
import TrackFilterControls from 'vue-media-annotator/TrackFilterControls';
import GroupFilterControls from 'vue-media-annotator/GroupFilterControls';
import { IDENTITY3 } from 'vue-media-annotator/alignedView/alignedView';
import type { Matrix3 } from 'vue-media-annotator/alignedView/homography';
import type { AggregateMediaController } from 'vue-media-annotator/components/annotators/mediaControllerType';
import type { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import { ROTATION_ATTRIBUTE_NAME } from 'vue-media-annotator/utils';
import useModeManager from './useModeManager';

function translation(tx: number, ty: number): Matrix3 {
  return [[1, 0, tx], [0, 1, ty], [0, 0, 1]];
}

function makeHarness() {
  const cameraStore = new CameraStore({ markChangesPending: () => undefined });
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
  const aggregateController = ref({
    frame: ref(0),
    nextFrame: () => undefined,
    seekCameraFrame: () => undefined,
    getController: (name: string) => perCamera[name],
  } as unknown as AggregateMediaController);

  const groupFilterControls = new GroupFilterControls({
    sorted: cameraStore.sortedGroups,
    remove: () => undefined,
    markChangesPending: () => undefined,
    setType: () => undefined,
    removeTypes: () => [],
  });
  const trackFilterControls = new TrackFilterControls({
    sorted: cameraStore.sortedTracks,
    remove: () => undefined,
    markChangesPending: () => undefined,
    lookupGroups: cameraStore.lookupGroups.bind(cameraStore),
    getTrack: (id: AnnotationId, camera = 'singleCam') => cameraStore.getTrack(id, camera),
    groupFilterControls,
    setType: () => undefined,
    removeTypes: () => [],
  });

  const modeManager = useModeManager({
    cameraStore,
    trackFilterControls,
    groupFilterControls,
    aggregateController,
    readonlyState: ref(false),
    recipes: [],
    alignedView,
  });
  modeManager.selectedCamera.value = 'left';
  return {
    cameraStore, alignedView, modeManager, perCamera,
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
  const aggregateController = ref({
    frame: ref(0),
    nextFrame: () => undefined,
    seekCameraFrame: () => undefined,
    getController: () => ({ frame: ref(0), hasFrame: ref(true) }),
  } as unknown as AggregateMediaController);
  const groupFilterControls = new GroupFilterControls({
    sorted: cameraStore.sortedGroups,
    remove: () => undefined,
    markChangesPending: () => undefined,
    setType: () => undefined,
    removeTypes: () => [],
  });
  const trackFilterControls = new TrackFilterControls({
    sorted: cameraStore.sortedTracks,
    remove: () => undefined,
    markChangesPending: () => undefined,
    lookupGroups: cameraStore.lookupGroups.bind(cameraStore),
    getTrack: (id: AnnotationId, camera = 'singleCam') => cameraStore.getTrack(id, camera),
    groupFilterControls,
    setType: () => undefined,
    removeTypes: () => [],
  });
  const modeManager = useModeManager({
    cameraStore,
    trackFilterControls,
    groupFilterControls,
    aggregateController,
    readonlyState: ref(false),
    recipes: [],
  });
  return { cameraStore, modeManager };
}

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
