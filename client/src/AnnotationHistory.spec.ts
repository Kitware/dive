import { cloneDeep } from 'lodash';
import AnnotationHistory from './AnnotationHistory';
import CameraStore from './CameraStore';
import Track from './track';
import Group from './Group';

function harness(limit = 100) {
  let history: AnnotationHistory;
  const changed = vi.fn();
  const cameras = new CameraStore({
    markChangesPending: (change) => {
      changed(change);
      history?.record(change);
    },
  });
  history = new AnnotationHistory(cameras, limit);
  const store = cameras.camMap.value.get('singleCam')!.trackStore;
  const groups = cameras.camMap.value.get('singleCam')!.groupStore;
  const add = (id = 1, imported = true) => {
    const track = new Track(id, {
      begin: 0,
      end: 0,
      confidencePairs: [['fish', 0.8]],
      features: [{ frame: 0, keyframe: true, bounds: [0, 0, 10, 10] }],
    });
    store.insert(track, { imported });
    return track;
  };
  return {
    cameras, store, groups, history, changed, add,
  };
}

it('restores geometry, measurements, attributes and types from an immutable snapshot', async () => {
  const h = harness();
  const track = h.add();
  track.setFeature({
    frame: 0, fishLength: 15, attributes: { length: 15 }, notes: ['original'],
  }, [{
    type: 'Feature',
    properties: { key: 'mask' },
    geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
  }]);
  const original = cloneDeep(track.serialize());
  h.history.start();
  track.setFeature({
    frame: 0, bounds: [1, 2, 20, 30], attributes: { length: 25 }, fishLength: 25,
  });
  track.setType('shark', 1);
  track.setAttribute('reviewed', true);
  await Promise.resolve();
  expect(h.history.canUndo.value).toBe(true);
  expect(h.history.undo()).toBe(true);
  expect(h.store.get(1).serialize()).toEqual(original);
  expect(h.history.undo()).toBe(false);
  // Undo re-enters the save pipeline with the restored state.
  expect(h.changed.mock.calls.at(-1)?.[0].track).toBe(h.store.get(1));
});

it('ignores empty tool activation and undoes the first real detection as a creation', async () => {
  const h = harness(); h.history.start();
  const track = h.store.add(0, 'fish', undefined, 7);
  await Promise.resolve();
  expect(h.history.canUndo.value).toBe(false);
  track.setFeature({ frame: 0, keyframe: true, bounds: [1, 1, 5, 5] });
  await Promise.resolve();
  expect(h.history.undo()).toBe(true);
  expect(h.store.getPossible(7)).toBeUndefined();
  expect(h.changed.mock.calls.at(-1)?.[0].action).toBe('delete');
});

it('restores a bulk deletion and group membership together, preserving list order', async () => {
  const h = harness(); [1, 2, 3].forEach((id) => h.add(id));
  h.groups.insert(new Group(8, {
    begin: 0,
    end: 0,
    confidencePairs: [['school', 1]],
    members: { 1: { ranges: [[0, 0]] }, 2: { ranges: [[0, 0]] } },
  }), { imported: true });
  h.history.start();
  h.store.remove(2); h.store.remove(1);
  h.groups.get(8).removeMembers([1, 2]);
  await Promise.resolve();
  h.history.undo();
  expect(h.store.annotationIds.value).toEqual([1, 2, 3]);
  expect(h.groups.get(8).memberIds).toEqual([1, 2]);
  expect(h.groups.trackMap.get(1)).toContain(8);
});

it('restores deleted frames and interval-tree bounds without changing other frames', async () => {
  const h = harness(); const track = h.add();
  track.setFeature({ frame: 10, keyframe: true, bounds: [20, 20, 30, 30] });
  const original = cloneDeep(track.serialize()); h.history.start();
  track.deleteFeature(10);
  await Promise.resolve(); h.history.undo();
  expect(h.store.get(1).serialize()).toEqual(original);
  expect(h.store.intervalTree.search([10, 10])).toContain('1');
});

it('groups asynchronous stereo results with the initiating edit and blocks undo while pending', async () => {
  const h = harness(); const track = h.add(); h.cameras.addCamera('right');
  const right = h.cameras.camMap.value.get('right')!.trackStore;
  h.history.start();
  track.setFeatureAttribute(0, 'length', 10);
  let finish!: () => void;
  const waiting = new Promise<void>((resolve) => { finish = resolve; });
  const operation = h.history.run(async () => {
    await waiting;
    right.insert(new Track(1, {
      begin: 0, end: 0, features: [{ frame: 0, keyframe: true, bounds: [1, 1, 2, 2] }],
    }));
    track.setFeatureAttribute(0, 'length', 20);
  });
  await Promise.resolve();
  expect(h.history.undo()).toBe(false);
  finish(); await operation;
  h.history.undo();
  expect(h.store.get(1).features[0].attributes?.length).toBeUndefined();
  expect(right.getPossible(1)).toBeUndefined();
  expect(h.history.undo()).toBe(false);
});

it('retains earlier edits after undo and accepts new edits instead of recording restoration', async () => {
  const h = harness(); h.add(); h.history.start();
  h.store.get(1).setType('shark', 1); await Promise.resolve();
  h.store.get(1).setType('ray', 1); await Promise.resolve();
  h.history.undo();
  expect(h.store.get(1).getType()[0]).toBe('shark');
  h.store.get(1).setType('tuna', 1); await Promise.resolve();
  h.history.undo(); h.history.undo();
  expect(h.store.get(1).getType()[0]).toBe('fish');
  expect(h.history.canUndo.value).toBe(false);
});

it('ignores no-op notifications and retains only the configured number of edits', async () => {
  const h = harness(2); const track = h.add(); h.history.start();
  track.setConfidencePairs([['fish', 0.8]]); await Promise.resolve();
  expect(h.history.canUndo.value).toBe(false);
  track.setType('one', 1); await Promise.resolve();
  track.setType('two', 1); await Promise.resolve();
  track.setType('three', 1); await Promise.resolve();
  h.history.undo(); h.history.undo();
  expect(h.history.undo()).toBe(false);
  expect(h.store.get(1).getType()[0]).toBe('one');
});

it('keeps row order when undo follows an insertion before an existing track', async () => {
  const h = harness(); h.add(1); h.add(2); h.history.start();
  h.store.insert(new Track(3, {
    begin: 0, end: 0, features: [{ frame: 0, keyframe: true, bounds: [0, 0, 5, 5] }],
  }), { afterId: 1 });
  await Promise.resolve();
  h.store.get(2).setType('shark', 1); await Promise.resolve();
  h.history.undo();
  expect(h.store.annotationIds.value).toEqual([1, 3, 2]);
  h.history.undo();
  expect(h.store.annotationIds.value).toEqual([1, 2]);
});

it('clears history and queued checkpoints when annotations are reloaded', async () => {
  const h = harness(); const track = h.add(); h.history.start();
  track.setType('shark', 1);
  h.history.reset(); h.cameras.clearAll(); h.add(20); h.history.start();
  await Promise.resolve();
  expect(h.history.undo()).toBe(false);
  expect(h.store.annotationIds.value).toEqual([20]);
});

it('releases the async undo lock on failure and can undo any partial changes', async () => {
  const h = harness(); const track = h.add(); h.history.start();
  await expect(h.history.run(async () => {
    track.setType('shark', 1);
    throw new Error('transfer failed');
  })).rejects.toThrow('transfer failed');
  expect(h.history.busy.value).toBe(0);
  h.history.undo();
  expect(h.store.get(1).getType()[0]).toBe('fish');
});
