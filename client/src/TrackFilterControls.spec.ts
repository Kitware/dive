/// <reference types="vitest" />
import { nextTick, ref } from 'vue';
import Track, { Feature } from './track';
import TrackFilterControls from './TrackFilterControls';
import GroupFilterControls from './GroupFilterControls';
import type { MarkChangesPendingFilter } from './BaseFilterControls';
import CameraStore from './CameraStore';
import { AnnotationId } from './BaseAnnotation';
import useSave from '../dive-common/use/useSave';

const apiMocks = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  saveDetections: vi.fn(),
  saveAttributes: vi.fn(),
  saveAttributeTrackFilters: vi.fn(),
}));

vi.mock('dive-common/apispec', async (importOriginal) => {
  const actual = await importOriginal<typeof import('dive-common/apispec')>();
  return {
    ...actual,
    useApi: () => apiMocks,
  };
});

const markChangesPending = () => null;

/**
 * Tracks need to be initialized with features
 * in order to broadcast notifications
 */
const features: Feature[] = [
  {
    frame: 0,
    bounds: [1, 2, 3, 4],
    head: [1, 2],
    keyframe: true,
  },
];

function makeCameraStore() {
  const cameraStore = new CameraStore({ markChangesPending });
  const t0 = new Track(0, {
    confidencePairs: [['foo', 0.5], ['bar', 0.4]],
    features,
  });
  const t1 = new Track(2, {
    confidencePairs: [['foo', 0.9], ['baz', 0.2]],
    features,
  });
  const t2 = new Track(200, {
    confidencePairs: [['bar', 1], ['baz', 0.8]],
    features,
  });
  const trackStore = cameraStore.camMap.value.get('singleCam')?.trackStore;
  if (trackStore) {
    trackStore.insert(t0);
    trackStore.insert(t1);
    trackStore.insert(t2);
    trackStore.setEnableSorting();
  }
  return cameraStore;
}

function makeGroupFilterControls(store: CameraStore) {
  const setTrackType = (
    id: AnnotationId,
    newType: string,
    confidenceVal?: number,
    currentType?: string,
  ) => {
    store.setTrackType(id, newType, confidenceVal, currentType);
  };
  const removeTypes = (id: AnnotationId, types: string[]) => store.removeTypes(id, types);
  const remove = (id: AnnotationId) => {
    store.removeGroups(id);
  };
  return new GroupFilterControls({
    sorted: store.sortedGroups,
    remove,
    markChangesPending,
    setType: setTrackType,
    removeTypes,
  });
}

function makeTrackFilterControls(markPending: MarkChangesPendingFilter = markChangesPending) {
  const cameraStore = makeCameraStore();
  const groupFilterControls = makeGroupFilterControls(cameraStore);
  const setTrackType = (
    id: AnnotationId,
    newType: string,
    confidenceVal?: number,
    currentType?: string,
  ) => {
    cameraStore.setTrackType(id, newType, confidenceVal, currentType);
  };
  const removeTypes = (id: AnnotationId, types: string[]) => cameraStore.removeTypes(id, types);

  const remove = (id: AnnotationId) => {
    cameraStore.removeTracks(id);
  };

  return new TrackFilterControls({
    sorted: cameraStore.sortedTracks,
    remove,
    markChangesPending: markPending,
    groupFilterControls,
    lookupGroups: cameraStore.lookupGroups,
    getTrack: (track: AnnotationId, camera = 'singleCam') => (cameraStore.getTrack(track, camera)),
    setType: setTrackType,
    removeTypes,
  });
}

describe('useAnnotationFilters', () => {
  it('loads absent and valid hierarchy state without creating a save instruction', () => {
    const tf = makeTrackFilterControls();
    tf.setTypeHierarchy(undefined);
    expect(tf.hierarchyActive.value).toBe(false);
    expect(tf.invalidHierarchyReason.value).toBeNull();
    expect(tf.consumeLoadWarning()).toBeNull();
    expect(tf.typeHierarchySavePatch()).toEqual({});

    tf.setTypeHierarchy({ shark: 'fish', 'great white shark': 'shark' });
    expect(tf.hierarchyActive.value).toBe(true);
    expect(tf.allTypes.value).toEqual([
      'foo', 'bar', 'baz', 'great white shark', 'shark', 'fish',
    ]);
    expect(tf.checkedTypes.value).toEqual(expect.arrayContaining([
      'great white shark', 'shark', 'fish',
    ]));
    expect(tf.typeHierarchySavePatch()).toEqual({});
  });

  it('disables an invalid stored hierarchy and emits its load warning once', () => {
    const tf = makeTrackFilterControls();
    tf.setTypeHierarchy({ fish: 'fish' });

    expect(tf.hierarchyActive.value).toBe(false);
    expect(tf.invalidHierarchyReason.value).toBe('self edge "fish -> fish"');
    expect(tf.typeHierarchySavePatch()).toEqual({});
    expect(tf.consumeLoadWarning()).toBe(
      'The saved type hierarchy is invalid: self edge "fish -> fish". '
      + 'Hierarchical type selection is disabled until the configuration is corrected.',
    );
    expect(tf.consumeLoadWarning()).toBeNull();
  });

  it('re-arms hierarchy load warnings and removes stale hierarchy-only choices on reset', () => {
    const tf = makeTrackFilterControls();
    tf.setTypeHierarchy({ shark: 'fish' });
    expect(tf.checkedTypes.value).toEqual(expect.arrayContaining(['shark', 'fish']));

    tf.setTypeHierarchy(undefined);
    expect(tf.allTypes.value).toEqual(['foo', 'bar', 'baz']);
    expect(tf.checkedTypes.value).not.toEqual(expect.arrayContaining(['shark', 'fish']));

    tf.setTypeHierarchy({ fish: 'fish' });
    expect(tf.consumeLoadWarning()).not.toBeNull();
  });

  it('retains a hierarchy save patch until persistence succeeds', () => {
    const tf = makeTrackFilterControls();
    tf.setTypeHierarchy({ shark: 'fish' });
    tf.updateTypeHierarchy({ shark: 'fish', tuna: 'fish' });

    const expected = { typeHierarchy: { shark: 'fish', tuna: 'fish' } };
    expect(tf.typeHierarchySavePatch()).toEqual(expected);
    expect(tf.typeHierarchySavePatch()).toEqual(expected);
    tf.markTypeHierarchyPersisted();
    expect(tf.typeHierarchySavePatch()).toEqual({});
  });

  it('retries every multicamera hierarchy target after the parent save fails', async () => {
    const datasetId = 'multicam-dataset';
    const saveControls = useSave(ref(datasetId), ref(false));
    saveControls.removeCamera('singleCam');
    saveControls.addCamera('left');
    saveControls.addCamera('right');
    const tf = makeTrackFilterControls(
      saveControls.markChangesPending as MarkChangesPendingFilter,
    );
    tf.setTypeHierarchy({ shark: 'fish' });
    tf.updateTypeHierarchy({ shark: 'fish', tuna: 'fish' });
    const expected = { typeHierarchy: { shark: 'fish', tuna: 'fish' } };
    const visiblePendingCount = () => Math.max(
      0,
      saveControls.pendingSaveCount.value - tf.typeHierarchyPendingCountAdjustment(),
    );
    expect(saveControls.pendingSaveCount.value).toBe(1);
    expect(visiblePendingCount()).toBe(1);
    let rejectParent = true;
    apiMocks.saveConfig.mockImplementation(async (id: string) => {
      if (id === datasetId && rejectParent) {
        rejectParent = false;
        throw new Error('parent save failed');
      }
    });

    const firstPatch = tf.prepareTypeHierarchySavePatch();
    expect(saveControls.pendingSaveCount.value).toBe(1);
    expect(tf.typeHierarchyPendingCountAdjustment()).toBe(0);
    expect(visiblePendingCount()).toBe(1);
    await expect(saveControls.save(firstPatch)).rejects.toThrow('parent save failed');
    expect(tf.typeHierarchySavePatch()).toEqual(expected);

    const retryPatch = tf.prepareTypeHierarchySavePatch();
    expect(retryPatch).toEqual(firstPatch);
    expect(saveControls.pendingSaveCount.value).toBe(2);
    expect(tf.typeHierarchyPendingCountAdjustment()).toBe(1);
    expect(visiblePendingCount()).toBe(1);
    await saveControls.save(retryPatch);
    expect(apiMocks.saveConfig.mock.calls).toEqual([
      [`${datasetId}/left`, expected],
      [`${datasetId}/right`, expected],
      [datasetId, expected],
      [`${datasetId}/left`, expected],
      [`${datasetId}/right`, expected],
      [datasetId, expected],
    ]);

    tf.markTypeHierarchyPersisted();
    expect(tf.typeHierarchyPendingCountAdjustment()).toBe(0);
    expect(visiblePendingCount()).toBe(0);
    expect(tf.prepareTypeHierarchySavePatch()).toEqual({});
  });

  it('uses an explicit delete patch for a locally cleared hierarchy', () => {
    const tf = makeTrackFilterControls();
    tf.setTypeHierarchy({ shark: 'fish' });
    tf.updateTypeHierarchy(null);
    expect(tf.typeHierarchySavePatch()).toEqual({ typeHierarchy: null });
  });

  it('accepts corrected replacement and clear loads after invalid storage', () => {
    const tf = makeTrackFilterControls();
    tf.setTypeHierarchy({ fish: 'fish' });
    tf.setTypeHierarchy({ shark: 'fish' });
    expect(tf.hierarchyActive.value).toBe(true);
    expect(tf.invalidHierarchyReason.value).toBeNull();
    tf.setTypeHierarchy({});
    expect(tf.hierarchyActive.value).toBe(false);
    expect(tf.typeHierarchySavePatch()).toEqual({});
  });

  it('updateTypeName', async () => {
    const tf = makeTrackFilterControls();
    tf.setConfidenceFilters({ baz: 0.1, bar: 0.2, default: 0.1 });
    tf.updateTypeName({ currentType: 'foo', newType: 'baz' });
    expect(tf.allTypes.value).toEqual(['baz', 'bar']);
    expect(tf.filteredAnnotations.value.filter(({ annotation }) => annotation.getType() === 'baz').length).toBe(2);
    tf.updateTypeName({ currentType: 'baz', newType: 'newtype' });
    await nextTick(); // must wait a tick for confidence to settle when newtype is added.
    expect(tf.allTypes.value).toEqual(['newtype', 'bar']);
    expect(tf.filteredAnnotations.value.length).toBe(3);
    expect(tf.confidenceFilters.value).toEqual({ bar: 0.2, newtype: 0.1, default: 0.1 });
  });

  it('deleteType', () => {
    const tf = makeTrackFilterControls();
    tf.setConfidenceFilters({ baz: 0.1, bar: 0.2 });
    tf.deleteType('bar'); // delete type only deletes the defaultType, doesn't touch tracks.
    expect(tf.sorted.value).toHaveLength(3);
    expect(tf.allTypes.value).toEqual(['foo', 'bar', 'baz']);
    expect(tf.confidenceFilters.value).toEqual({ baz: 0.1 });
  });

  it('removeTypeTrack', async () => {
    const tf = makeTrackFilterControls();
    tf.removeTypeAnnotations(['bar']);
    expect(tf.allTypes.value).toEqual(['foo', 'bar', 'baz']);
    tf.removeTypeAnnotations(['baz']);
    expect(tf.allTypes.value).toEqual(['foo', 'bar', 'baz']);
  });
});
