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

  it('rejects a classification command for a missing logical track', () => {
    const fixture = makeTwoCameraStore();
    expect(() => fixture.store.setTrackPairConfidence(99, 'fish', 1.0))
      .toThrow('TrackId 99 not found in any camera');
    expect(fixture.markChangesPending).not.toHaveBeenCalled();
  });
});
