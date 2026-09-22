import { compileHierarchy } from 'dive-common/typeHierarchy';
import CameraStore, { formatDivergentClassificationWarning } from './CameraStore';
import Group from './Group';
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
    begin: 0,
    end: 0,
    confidencePairs: confidencePairs([
      ['fish', 0.9],
      ['shark', 0.7],
      ['great white shark', 0.4],
      ['bird', 0.2],
    ]),
    features: features(),
  });
  const right = new Track(TRACK_ID, {
    begin: 0,
    end: 0,
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
      ['rock', 0.95],
      ['fish', 0.9],
      ['great white shark', 0.4],
      ['bird', 0.2],
    ]);
  });

  it('removes types from the complete logical vector and synchronizes every camera', () => {
    const fixture = makeTwoCameraStore();
    const result = fixture.store.removeTypes(TRACK_ID, ['shark', 'bird']);

    expectSynchronizedWrite(fixture, result, [
      ['rock', 0.95],
      ['fish', 0.9],
      ['great white shark', 0.4],
    ]);
  });

  it('produces the same removal result for either camera insertion order', () => {
    const removeFish = (cameraOrder: string[]) => {
      const store = new CameraStore({ markChangesPending: vi.fn() });
      store.removeCamera('singleCam');
      cameraOrder.forEach((cameraName) => store.addCamera(cameraName));
      const vectors: Record<string, [string, number][]> = {
        left: [['fish', 0.9]],
        right: [['rock', 0.8]],
      };
      cameraOrder.forEach((cameraName) => {
        store.camMap.value.get(cameraName)?.trackStore.insert(new Track(TRACK_ID, {
          confidencePairs: confidencePairs(vectors[cameraName]),
          features: features(),
        }), { imported: true });
      });
      const result = store.removeTypes(TRACK_ID, ['fish']);
      expect(store.getTrackAll(TRACK_ID).map((track) => track.confidencePairs))
        .toEqual(cameraOrder.map(() => [['rock', 0.8]]));
      return result;
    };

    expect(removeFish(['left', 'right'])).toEqual([['rock', 0.8]]);
    expect(removeFish(['right', 'left'])).toEqual([['rock', 0.8]]);
  });

  it('cleans group membership when an empty classification deletes the logical track', () => {
    const fixture = makeTwoCameraStore();
    fixture.left.setConfidencePairs([['fish', 0.9]]);
    fixture.right.setConfidencePairs([['rock', 0.9]]);
    fixture.store.camMap.value.forEach(({ groupStore }) => {
      groupStore.insert(new Group(3, {
        members: {
          [TRACK_ID]: { ranges: [[0, 0]] },
          99: { ranges: [[0, 0]] },
        },
      }), { imported: true });
    });
    fixture.markChangesPending.mockClear();

    const result = fixture.store.removeTypes(TRACK_ID, ['fish', 'rock']);
    expect(result).toEqual([]);

    fixture.store.camMap.value.forEach(({ trackStore, groupStore }) => {
      expect(trackStore.getPossible(TRACK_ID)).toBeUndefined();
      expect(groupStore.get(3).memberIds).toEqual([99]);
      expect(groupStore.trackMap.get(TRACK_ID)).toEqual(new Set());
    });
    expect(fixture.markChangesPending.mock.calls.filter(([change]) => change.action === 'delete'))
      .toHaveLength(2);
  });

  it('cleans stale group membership in a camera without a track replica', () => {
    const fixture = makeTwoCameraStore();
    fixture.left.setConfidencePairs([['fish', 0.9]]);
    fixture.store.camMap.value.forEach(({ groupStore }) => {
      groupStore.insert(new Group(3, {
        members: {
          [TRACK_ID]: { ranges: [[0, 0]] },
          99: { ranges: [[0, 0]] },
        },
      }), { imported: true });
    });
    fixture.store.camMap.value.get('right')?.trackStore.remove(TRACK_ID, true);
    fixture.markChangesPending.mockClear();

    expect(fixture.store.removeTrackPair(TRACK_ID, 'fish')).toEqual([]);

    fixture.store.camMap.value.forEach(({ trackStore, groupStore }) => {
      expect(trackStore.getPossible(TRACK_ID)).toBeUndefined();
      expect(groupStore.get(3).memberIds).toEqual([99]);
      expect(groupStore.trackMap.get(TRACK_ID)).toEqual(new Set());
    });
    expect(fixture.markChangesPending.mock.calls.filter(([change]) => change.action === 'delete'))
      .toHaveLength(1);
  });

  it('deletes a final pair through the single-pair command', () => {
    const fixture = makeTwoCameraStore();
    fixture.left.setConfidencePairs([['fish', 0.9]]);
    fixture.right.setConfidencePairs([['fish', 0.9]]);
    fixture.markChangesPending.mockClear();

    expect(fixture.store.removeTrackPair(TRACK_ID, 'fish')).toEqual([]);
    expect(fixture.store.getTrackAll(TRACK_ID)).toEqual([]);
    expect(fixture.markChangesPending.mock.calls.map(([change]) => change.action))
      .toEqual(['delete', 'delete']);
  });

  it('does not notify replicas for a no-op classification command', () => {
    const fixture = makeTwoCameraStore();
    fixture.right.setConfidencePairs(fixture.left.confidencePairs);
    fixture.markChangesPending.mockClear();

    expect(fixture.store.removeTrackPair(TRACK_ID, 'not-present')).toEqual([
      ['fish', 0.9],
      ['shark', 0.7],
      ['great white shark', 0.4],
      ['bird', 0.2],
    ]);
    expect(fixture.markChangesPending).not.toHaveBeenCalled();
  });

  it('keeps group commands separate from colliding track ids across cameras', () => {
    const fixture = makeTwoCameraStore();
    fixture.store.camMap.value.forEach(({ trackStore, groupStore }) => {
      trackStore.insert(new Track(3, {
        confidencePairs: [['track-type', 1]],
        features: features(),
      }), { imported: true });
      groupStore.insert(new Group(3, {
        confidencePairs: [['group-type', 0.5]],
        members: {},
      }), { imported: true });
    });
    fixture.markChangesPending.mockClear();

    fixture.store.setGroupType(3, 'renamed-group', 0.7, 'group-type');
    expect(fixture.store.removeGroupTypes(3, ['renamed-group'])).toEqual([]);

    fixture.store.camMap.value.forEach(({ trackStore, groupStore }) => {
      expect(trackStore.get(3).confidencePairs).toEqual([['track-type', 1]]);
      expect(groupStore.get(3).confidencePairs).toEqual([]);
    });
    expect(fixture.markChangesPending).toHaveBeenCalledTimes(4);
  });

  it('uses the first configured camera for any-track reads', () => {
    const fixture = makeTwoCameraStore();

    expect(fixture.store.getAnyTrack(TRACK_ID)).toBe(fixture.left);
    expect(fixture.store.getAnyPossibleTrack(TRACK_ID)).toBe(fixture.left);
  });

  it('resets canonical camera order when a new dataset reverses existing cameras', () => {
    const fixture = makeTwoCameraStore();
    expect(fixture.store.getAnyTrack(TRACK_ID)).toBe(fixture.left);

    fixture.store.clearAll();
    fixture.store.setCameraOrder(['right', 'left']);
    const reloadedRight = new Track(TRACK_ID, {
      confidencePairs: [['new-right', 1]],
      features: features(),
    });
    const reloadedLeft = new Track(TRACK_ID, {
      confidencePairs: [['new-left', 1]],
      features: features(),
    });
    fixture.store.camMap.value.get('right')?.trackStore.insert(reloadedRight, { imported: true });
    fixture.store.camMap.value.get('left')?.trackStore.insert(reloadedLeft, { imported: true });

    expect(Array.from(fixture.store.camMap.value.keys())).toEqual(['right', 'left']);
    expect(fixture.store.getAnyTrack(TRACK_ID)).toBe(reloadedRight);
    expect(fixture.store.getTrackProjection(TRACK_ID).confidencePairs).toEqual([['new-right', 1]]);
  });

  it('returns unknown when an imported track has no confidence pairs', () => {
    const fixture = makeTwoCameraStore();
    fixture.left.setConfidencePairs([]);
    fixture.right.setConfidencePairs([]);

    expect(fixture.store.getTrackProjectionForSorted(TRACK_ID).getType()).toBe('unknown');
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

  it('answers canSplit over the merged logical range', () => {
    const markChangesPending = vi.fn();
    const store = new CameraStore({ markChangesPending });
    const trackFeatures = features();
    trackFeatures[4] = { frame: 4, keyframe: true, bounds: [0, 0, 1, 1] };
    const track = new Track(TRACK_ID, {
      begin: 0,
      end: 4,
      confidencePairs: [['fish', 0.8]],
      features: trackFeatures,
    });
    store.camMap.value.get('singleCam')?.trackStore.insert(track, { imported: true });

    const projection = store.getTrackProjection(TRACK_ID);

    [0, 1, 4, 5].forEach((frame) => {
      expect(projection.canSplit(frame)).toBe(track.canSplit(frame));
    });
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
    expect(projection.confidencePairs).toEqual([['fish', 0.7]]);
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

  it('re-projects from the new canonical camera after a reorder', () => {
    const { store } = makeTwoCameraStore();
    const before = store.getTrackProjection(TRACK_ID);
    store.setCameraOrder(['right', 'left']);
    const after = store.getTrackProjection(TRACK_ID);
    expect(after).not.toBe(before);
    expect(after.confidencePairs).toEqual(confidencePairs([['rock', 0.95], ['shark', 0.1]]));
  });
});

describe('CameraStore classification divergence', () => {
  it('finds exact vector differences only when an id exists in multiple cameras', () => {
    const store = new CameraStore({ markChangesPending: vi.fn() });
    store.removeCamera('singleCam');
    store.addCamera('left');
    store.addCamera('right');
    const insert = (cameraName: string, id: number, pairs: [string, number][]) => {
      store.camMap.value.get(cameraName)?.trackStore.insert(new Track(id, {
        confidencePairs: confidencePairs(pairs),
        features: features(),
      }), { imported: true });
    };
    insert('left', 9, [['fish', 0.8], ['bird', 0.2]]);
    insert('right', 9, [['fish', 0.8], ['bird', 0.2]]);
    insert('left', 4, [['fish', 0.8], ['bird', 0.2]]);
    insert('right', 4, [['bird', 0.2], ['fish', 0.8]]);
    insert('left', 2, [['fish', 0.8]]);
    insert('right', 2, [['fish', 0.7]]);
    insert('left', 1, [['left only', 1]]);

    expect(store.divergentClassificationTrackIds()).toEqual([2, 4]);
  });

  it('formats one bounded, sorted dataset warning', () => {
    expect(formatDivergentClassificationWarning([])).toBeNull();
    expect(formatDivergentClassificationWarning([5, 2])).toBe(
      '2 tracks have divergent per-camera classifications (tracks 2, 5)',
    );
    expect(formatDivergentClassificationWarning([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1])).toBe(
      '11 tracks have divergent per-camera classifications (tracks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, …)',
    );
  });
});

describe('CameraStore track editor commands', () => {
  it('writes notes and attributes to every replica through canonical tracks', () => {
    const fixture = makeTwoCameraStore();

    fixture.store.setTrackNotes(TRACK_ID, 'reviewed');
    fixture.store.setTrackAttribute(TRACK_ID, 'quality', 'high');
    fixture.store.setTrackFirstFeatureAttribute(TRACK_ID, 'occluded', true);

    [fixture.left, fixture.right].forEach((track) => {
      expect(track.features[track.begin].notes).toEqual(['reviewed']);
      expect(track.attributes.quality).toBe('high');
      expect(track.features[track.begin].attributes?.occluded).toBe(true);
    });
    expect(fixture.markChangesPending).toHaveBeenCalledTimes(6);
    expect(fixture.markChangesPending.mock.calls.map(([change]) => change.cameraName))
      .toEqual(['left', 'right', 'left', 'right', 'left', 'right']);
  });

  it('writes frame attributes to every replica at the declared frame', () => {
    const fixture = makeTwoCameraStore();

    fixture.store.setTrackFeatureAttribute(TRACK_ID, 0, 'reviewed', true);

    expect(fixture.left.features[0].attributes?.reviewed).toBe(true);
    expect(fixture.right.features[0].attributes?.reviewed).toBe(true);
    expect(fixture.markChangesPending.mock.calls.map(([change]) => change.cameraName))
      .toEqual(['left', 'right']);
  });

  it('targets geometry commands to one named camera', () => {
    const fixture = makeTwoCameraStore();

    fixture.store.toggleTrackInterpolation(TRACK_ID, 0, 'right');

    expect(fixture.left.features[0].interpolate).toBeUndefined();
    expect(fixture.right.features[0].interpolate).toBe(true);
    expect(fixture.markChangesPending.mock.calls.map(([change]) => change.cameraName))
      .toEqual(['right']);
  });
});
