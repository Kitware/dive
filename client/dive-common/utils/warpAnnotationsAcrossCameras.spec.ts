/// <reference types="vitest" />
import CameraStore from 'vue-media-annotator/CameraStore';
import type { Matrix3 } from 'vue-media-annotator/homography';
import { IDENTITY3 } from 'vue-media-annotator/alignedView';
import { ROTATION_ATTRIBUTE_NAME } from 'vue-media-annotator/utils';
import warpAnnotationsAcrossCameras from './warpAnnotationsAcrossCameras';

function translation(tx: number, ty: number): Matrix3 {
  return [[1, 0, tx], [0, 1, ty], [0, 0, 1]];
}

function makeCameraStore(cameras: string[]) {
  const store = new CameraStore({ markChangesPending: () => null });
  cameras.forEach((camera) => store.addCamera(camera));
  store.removeCamera('singleCam');
  return store;
}

function trackStoreFor(store: CameraStore, camera: string) {
  const mapped = store.camMap.value.get(camera);
  if (!mapped) {
    throw new Error(`no camera ${camera}`);
  }
  return mapped.trackStore;
}

const headPoint: GeoJSON.Feature<GeoJSON.Point> = {
  type: 'Feature',
  properties: { key: 'head' },
  geometry: { type: 'Point', coordinates: [5, 5] },
};

/** left is the reference; right's native->reference is translation(10, 20),
 * so left->right maps points by (-10, -20). */
const TO_REFERENCE: Record<string, Matrix3> = {
  left: IDENTITY3,
  right: translation(10, 20),
};

describe('warpAnnotationsAcrossCameras', () => {
  it('copies tracks onto the other camera with warped geometry', () => {
    const store = makeCameraStore(['left', 'right']);
    const leftStore = trackStoreFor(store, 'left');
    const track = leftStore.add(3, 'fish', undefined, leftStore.getNewId());
    track.confidencePairs = [['fish', 0.9], ['shark', 0.1]];
    track.setFeature({
      frame: 3, bounds: [0, 0, 10, 10], keyframe: true, interpolate: true,
    }, [headPoint]);
    track.setFeatureAttribute(3, 'note', 'hello');
    track.setFeatureAttribute(3, ROTATION_ATTRIBUTE_NAME, 0.5);

    const result = warpAnnotationsAcrossCameras(store, TO_REFERENCE, 'left');
    expect(result).toEqual({ tracks: 1, cameras: 1 });

    const target = trackStoreFor(store, 'right').getPossible(track.id);
    expect(target).toBeDefined();
    const feature = target?.features[3];
    expect(feature?.keyframe).toBe(true);
    expect(feature?.interpolate).toBe(true);
    expect(feature?.bounds).toEqual([-10, -20, 0, -10]);
    expect(feature?.geometry?.features[0].geometry.coordinates).toEqual([-5, -15]);
    expect(feature?.attributes?.note).toBe('hello');
    // pure translation leaves the rotation angle unchanged
    expect(feature?.attributes?.[ROTATION_ATTRIBUTE_NAME]).toBeCloseTo(0.5, 6);
    expect(target?.confidencePairs).toEqual([['fish', 0.9], ['shark', 0.1]]);
  });

  it('copies every keyframe and skips cameras without a transform', () => {
    const store = makeCameraStore(['left', 'right', 'ir']);
    const leftStore = trackStoreFor(store, 'left');
    const track = leftStore.add(0, 'fish', undefined, leftStore.getNewId());
    track.setFeature({ frame: 0, bounds: [0, 0, 10, 10], keyframe: true });
    track.setFeature({ frame: 5, bounds: [30, 30, 40, 40], keyframe: true });

    // 'ir' has no entry in TO_REFERENCE, so it cannot receive copies
    const result = warpAnnotationsAcrossCameras(store, TO_REFERENCE, 'left');
    expect(result).toEqual({ tracks: 1, cameras: 1 });
    expect(trackStoreFor(store, 'ir').getPossible(track.id)).toBeUndefined();

    const target = trackStoreFor(store, 'right').getPossible(track.id);
    expect(target?.features[0]?.bounds).toEqual([-10, -20, 0, -10]);
    expect(target?.features[5]?.bounds).toEqual([20, 10, 30, 20]);
  });

  it('overwrites keyframes of an existing same-id target track', () => {
    const store = makeCameraStore(['left', 'right']);
    const leftStore = trackStoreFor(store, 'left');
    const rightStore = trackStoreFor(store, 'right');
    const track = leftStore.add(3, 'fish', undefined, leftStore.getNewId());
    track.setFeature({ frame: 3, bounds: [0, 0, 10, 10], keyframe: true });
    const existing = rightStore.add(3, 'other', undefined, track.id);
    existing.setFeature({ frame: 3, bounds: [100, 100, 200, 200], keyframe: true });
    existing.setFeature({ frame: 7, bounds: [1, 1, 2, 2], keyframe: true });

    warpAnnotationsAcrossCameras(store, TO_REFERENCE, 'left');
    expect(existing.features[3]?.bounds).toEqual([-10, -20, 0, -10]);
    // untouched keyframes on the target survive
    expect(existing.features[7]?.bounds).toEqual([1, 1, 2, 2]);
  });

  it('returns zeros when the source camera or its tracks are missing', () => {
    const store = makeCameraStore(['left', 'right']);
    expect(warpAnnotationsAcrossCameras(store, TO_REFERENCE, 'missing'))
      .toEqual({ tracks: 0, cameras: 0 });
    expect(warpAnnotationsAcrossCameras(store, TO_REFERENCE, 'left'))
      .toEqual({ tracks: 0, cameras: 0 });
  });
});
