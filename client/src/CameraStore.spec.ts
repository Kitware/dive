/// <reference types="vitest" />
import { compileHierarchy } from 'dive-common/typeHierarchy';
import CameraStore from './CameraStore';
import Track, { Feature } from './track';

const HIERARCHY_INDEX = compileHierarchy({
  'great white shark': 'shark',
  shark: 'fish',
  tern: 'bird',
});

const TRACK_ID = 7;

function features(): Feature[] {
  return [{
    frame: 0,
    keyframe: true,
    bounds: [0, 0, 1, 1],
  }];
}

function confidencePairs(value: [string, number][]): [string, number][] {
  return value.map(([type, confidence]) => [type, confidence]);
}

function makeTwoCameraStore() {
  const markChangesPending = vi.fn();
  const store = new CameraStore({ markChangesPending });
  store.removeCamera('singleCam');
  store.addCamera('left');
  store.addCamera('right');

  const left = new Track(TRACK_ID, {
    confidencePairs: confidencePairs([
      ['fish', 0.9],
      ['shark', 0.7],
      ['great white shark', 0.4],
      ['bird', 0.2],
    ]),
    features: features(),
  });
  const right = new Track(TRACK_ID, {
    confidencePairs: confidencePairs([
      ['rock', 0.95],
      ['shark', 0.1],
    ]),
    features: features(),
  });
  store.camMap.value.get('left')?.trackStore.insert(left, { imported: true });
  store.camMap.value.get('right')?.trackStore.insert(right, { imported: true });
  markChangesPending.mockClear();
  return {
    store, left, right, markChangesPending,
  };
}

function expectSynchronizedWrite(
  fixture: ReturnType<typeof makeTwoCameraStore>,
  result: [string, number][],
  expected: [string, number][],
) {
  const {
    left, right, markChangesPending,
  } = fixture;
  expect(result).toEqual(expected);
  expect(left.confidencePairs).toEqual(expected);
  expect(right.confidencePairs).toEqual(expected);
  expect(left.confidencePairs).not.toBe(right.confidencePairs);
  expect(result).not.toBe(left.confidencePairs);
  expect(result).not.toBe(right.confidencePairs);
  left.confidencePairs.forEach((pair) => expect(right.confidencePairs).not.toContain(pair));
  result.forEach((pair) => expect(left.confidencePairs).not.toContain(pair));
  expect(markChangesPending).toHaveBeenCalledTimes(2);
  expect(markChangesPending.mock.calls.map(([change]) => change.cameraName))
    .toEqual(['left', 'right']);
}

describe('CameraStore classification commands', () => {
  it('calculates assignment once from the first camera and synchronizes independent copies', () => {
    const fixture = makeTwoCameraStore();
    const result = fixture.store.assignTrackType(TRACK_ID, 'great white shark', {
      hierarchyIndex: HIERARCHY_INDEX,
      replaceType: 'shark',
      confidence: 0.7,
    });

    expectSynchronizedWrite(fixture, result, [
      ['fish', 0.9],
      ['shark', 0.7],
      ['great white shark', 0.7],
      ['bird', 0.2],
    ]);
  });

  it('accepts a hierarchy node without changing stored relative scores', () => {
    const fixture = makeTwoCameraStore();
    const result = fixture.store.acceptTrackType(TRACK_ID, 'shark', HIERARCHY_INDEX);

    expectSynchronizedWrite(fixture, result, [
      ['shark', 1.0],
      ['fish', 0.9],
      ['great white shark', 0.4],
    ]);
  });

  it.each([0.99, 1.0])(
    'treats confidence %s as a single-pair update',
    (confidence) => {
      const fixture = makeTwoCameraStore();
      const result = fixture.store.setTrackPairConfidence(TRACK_ID, 'shark', confidence);

      expectSynchronizedWrite(fixture, result, [
        ['shark', confidence],
        ['fish', 0.9],
        ['great white shark', 0.4],
        ['bird', 0.2],
      ]);
    },
  );

  it('removes exactly one type and returns the logical result', () => {
    const fixture = makeTwoCameraStore();
    const result = fixture.store.removeTrackPair(TRACK_ID, 'shark');

    expectSynchronizedWrite(fixture, result, [
      ['fish', 0.9],
      ['great white shark', 0.4],
      ['bird', 0.2],
    ]);
  });

  it('renames one pair without applying assignment or acceptance semantics', () => {
    const fixture = makeTwoCameraStore();
    const result = fixture.store.renameTrackPair(TRACK_ID, 'shark', 'selachimorpha');

    expectSynchronizedWrite(fixture, result, [
      ['fish', 0.9],
      ['selachimorpha', 0.7],
      ['great white shark', 0.4],
      ['bird', 0.2],
    ]);
  });

  it('rejects a classification command for a missing logical track', () => {
    const fixture = makeTwoCameraStore();
    expect(() => fixture.store.setTrackPairConfidence(99, 'fish', 1.0))
      .toThrow('TrackId 99 not found in any camera');
    expect(fixture.markChangesPending).not.toHaveBeenCalled();
  });
});

describe('CameraStore track projections', () => {
  const mutationKeys = [
    'notifier',
    'revision',
    'setNotifier',
    'setFeature',
    'setFeatureNotes',
    'setAttribute',
    'merge',
    'toggleKeyframe',
  ];

  it('returns the same notifier-free read contract for a single camera', () => {
    const markChangesPending = vi.fn();
    const store = new CameraStore({ markChangesPending });
    const track = new Track(TRACK_ID, {
      confidencePairs: [['fish', 0.8]],
      features: features(),
    });
    store.camMap.value.get('singleCam')?.trackStore.insert(track, { imported: true });

    const projection = store.getTrackProjection(TRACK_ID);

    expect(projection).not.toBe(track);
    expect(projection.id).toBe(TRACK_ID);
    expect(projection.getType()).toEqual(['fish', 0.8]);
    mutationKeys.forEach((key) => expect(key in projection).toBe(false));
    expect(markChangesPending).not.toHaveBeenCalled();
  });

  it('merges display data without mutating or notifying source tracks', () => {
    const markChangesPending = vi.fn();
    const store = new CameraStore({ markChangesPending });
    store.removeCamera('singleCam');
    store.addCamera('left');
    store.addCamera('right');
    const leftFeatures: Feature[] = [];
    leftFeatures[2] = {
      frame: 2, keyframe: true, bounds: [0, 0, 2, 2], notes: ['left'],
    };
    const rightFeatures: Feature[] = [];
    rightFeatures[5] = {
      frame: 5, keyframe: true, bounds: [5, 5, 2, 2], notes: ['right'],
    };
    const left = new Track(TRACK_ID, {
      attributes: { source: 'left' },
      begin: 2,
      end: 2,
      confidencePairs: [['fish', 0.7]],
      features: leftFeatures,
    });
    const right = new Track(TRACK_ID, {
      attributes: { quality: 'right' },
      begin: 5,
      end: 5,
      confidencePairs: [['fish', 0.9], ['bird', 0.2]],
      features: rightFeatures,
    });
    store.camMap.value.get('left')?.trackStore.insert(left, { imported: true });
    store.camMap.value.get('right')?.trackStore.insert(right, { imported: true });
    markChangesPending.mockClear();
    const leftBefore = left.serialize();
    const rightBefore = right.serialize();

    const projection = store.getTrackProjection(TRACK_ID);

    expect(projection.begin).toBe(2);
    expect(projection.end).toBe(5);
    expect(projection.featureIndex).toEqual([2, 5]);
    expect(projection.features[2]?.notes).toEqual(['left']);
    expect(projection.features[5]?.notes).toEqual(['right']);
    expect(projection.attributes).toMatchObject({ source: 'left', quality: 'right' });
    expect(projection.confidencePairs).toEqual([['fish', 0.9], ['bird', 0.2]]);
    mutationKeys.forEach((key) => expect(key in projection).toBe(false));
    expect(left.serialize()).toEqual(leftBefore);
    expect(right.serialize()).toEqual(rightBefore);
    expect(markChangesPending).not.toHaveBeenCalled();
  });
});

describe('CameraStore projection cache', () => {
  it('returns the same projection object until an input changes', () => {
    const { store } = makeTwoCameraStore();
    const first = store.getTrackProjection(TRACK_ID);
    expect(store.getTrackProjection(TRACK_ID)).toBe(first);
  });

  it('rebuilds after a canonical replica edit', () => {
    const { store, left } = makeTwoCameraStore();
    const before = store.getTrackProjection(TRACK_ID);
    left.setType('tuna');
    const after = store.getTrackProjection(TRACK_ID);
    expect(after).not.toBe(before);
    expect(after.confidencePairs).toContainEqual(['tuna', 1]);
  });

  it('rebuilds after an edit that touches only a non-canonical replica', () => {
    const { store, right } = makeTwoCameraStore();
    const before = store.getTrackProjection(TRACK_ID);
    right.setFeature({ frame: 5, keyframe: true, bounds: [1, 1, 2, 2] });
    const after = store.getTrackProjection(TRACK_ID);
    expect(after).not.toBe(before);
    expect(after.features[5]?.bounds).toEqual([1, 1, 2, 2]);
  });

  it('includes a replica inserted after the first read', () => {
    const { store } = makeTwoCameraStore();
    store.addCamera('center');
    const before = store.getTrackProjection(TRACK_ID);
    const centerFeatures: Feature[] = [];
    centerFeatures[3] = { frame: 3, keyframe: true, bounds: [3, 3, 1, 1] };
    const center = new Track(TRACK_ID, {
      begin: 3,
      end: 3,
      confidencePairs: confidencePairs([['crab', 0.5]]),
      features: centerFeatures,
    });
    store.camMap.value.get('center')?.trackStore.insert(center, { imported: true });
    const after = store.getTrackProjection(TRACK_ID);
    expect(after).not.toBe(before);
    expect(after.features[3]?.bounds).toEqual([3, 3, 1, 1]);
  });

  it('serves a replacement track after removal', () => {
    const { store } = makeTwoCameraStore();
    store.getTrackProjection(TRACK_ID);
    store.remove(TRACK_ID);
    expect(() => store.getTrackProjection(TRACK_ID)).toThrow();
    const replacement = new Track(TRACK_ID, {
      confidencePairs: confidencePairs([['crab', 1]]),
      features: features(),
    });
    store.camMap.value.get('left')?.trackStore.insert(replacement, { imported: true });
    expect(store.getTrackProjection(TRACK_ID).confidencePairs).toEqual([['crab', 1]]);
  });

  it('drops all entries on clearAll', () => {
    const { store } = makeTwoCameraStore();
    store.getTrackProjection(TRACK_ID);
    store.clearAll();
    expect(() => store.getTrackProjection(TRACK_ID)).toThrow();
  });

  it('re-projects from the remaining camera after a camera is removed', () => {
    const { store } = makeTwoCameraStore();
    const before = store.getTrackProjection(TRACK_ID);
    store.removeCamera('left');
    const after = store.getTrackProjection(TRACK_ID);
    expect(after).not.toBe(before);
    expect(after.confidencePairs).toEqual(confidencePairs([['rock', 0.95], ['shark', 0.1]]));
  });
});
