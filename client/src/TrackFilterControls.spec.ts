/// <reference types="vitest" />
import { nextTick, ref } from 'vue';
import Track, { Feature } from './track';
import TrackFilterControls from './TrackFilterControls';
import GroupFilterControls from './GroupFilterControls';
import type { MarkChangesPendingFilter } from './BaseFilterControls';
import CameraStore from './CameraStore';
import { AnnotationId } from './BaseAnnotation';
import useSave from '../dive-common/use/useSave';
import { clientSettings } from '../dive-common/store/settings';
import { TypeHierarchyError } from '../dive-common/typeHierarchy';

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
    getTracks: (track: AnnotationId) => cameraStore.getTrackAll(track),
    setType: setTrackType,
    removeTypes,
  });
}

function makePairFixture(
  confidencePairs: [string, number][][],
  markPending = vi.fn(),
) {
  const cameraStore = new CameraStore({ markChangesPending: markPending });
  const trackStore = cameraStore.camMap.value.get('singleCam')?.trackStore;
  confidencePairs.forEach((pairs, id) => {
    trackStore?.insert(new Track(id, { confidencePairs: pairs, features }));
  });
  trackStore?.setEnableSorting();
  const groupFilterControls = makeGroupFilterControls(cameraStore);
  const filters = new TrackFilterControls({
    sorted: cameraStore.sortedTracks,
    remove: (id) => cameraStore.removeTracks(id),
    markChangesPending: markPending,
    groupFilterControls,
    lookupGroups: cameraStore.lookupGroups,
    getTrack: (id, camera = 'singleCam') => cameraStore.getTrack(id, camera),
    getTracks: (id) => cameraStore.getTrackAll(id),
    setType: (id, type, confidence, current) => (
      cameraStore.setTrackType(id, type, confidence, current)
    ),
    removeTypes: (id, types) => cameraStore.removeTypes(id, types),
  });
  return { cameraStore, filters, markPending };
}

describe('useAnnotationFilters', () => {
  afterEach(() => {
    clientSettings.typeSettings.preventCascadeTypes = false;
  });

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
    tf.setTypeHierarchy({ foo: 'root' });
    tf.updateTypeName({ currentType: 'root', newType: 'heading' });

    const expected = { typeHierarchy: { foo: 'heading' } };
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
    tf.setTypeHierarchy({ foo: 'root' });
    tf.updateTypeName({ currentType: 'root', newType: 'heading' });
    const expected = { typeHierarchy: { foo: 'heading' } };
    expect(saveControls.pendingSaveCount.value).toBe(1);
    let rejectParent = true;
    apiMocks.saveConfig.mockImplementation(async (id: string) => {
      if (id === datasetId && rejectParent) {
        rejectParent = false;
        throw new Error('parent save failed');
      }
    });

    const firstPatch = tf.typeHierarchySavePatch();
    expect(saveControls.pendingSaveCount.value).toBe(1);
    await expect(saveControls.save(firstPatch)).rejects.toThrow('parent save failed');
    expect(tf.typeHierarchySavePatch()).toEqual(expected);

    const retryPatch = tf.typeHierarchySavePatch();
    expect(retryPatch).toEqual(firstPatch);
    expect(saveControls.pendingSaveCount.value).toBe(1);
    await saveControls.save(retryPatch);
    expect(apiMocks.saveConfig.mock.calls).toEqual([
      [`${datasetId}/left`, {}],
      [`${datasetId}/right`, {}],
      [datasetId, expected],
      [datasetId, expected],
    ]);

    tf.markTypeHierarchyPersisted();
    expect(saveControls.pendingSaveCount.value).toBe(0);
    expect(tf.typeHierarchySavePatch()).toEqual({});
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

  it('returns the caller fallback without recomputing flat pair selection', () => {
    const { cameraStore, filters } = makePairFixture([
      [['root', 0.1], ['leaf', 0.9]],
    ]);
    const track = cameraStore.getTrack(0);
    filters.checkedTypes.value = [];
    filters.setConfidenceFilters({ default: 1 });
    filters.disableAnnotationFilters.value = true;
    expect(filters.displayPairIndex(track, 1)).toBe(1);
    expect(filters.displayPairIndex(track, -1)).toBe(-1);
  });

  it('preserves the complete flat filter matrix', () => {
    const { filters } = makePairFixture([
      [['top', 0.5], ['fallback', 0.8]],
      [],
    ]);
    filters.setConfidenceFilters({ top: 0.5, fallback: 0.8, default: 0.1 });
    filters.checkedTypes.value = ['top', 'fallback'];
    expect(filters.filteredAnnotations.value.map(({ context }) => context.confidencePairIndex))
      .toEqual([0, -1]);

    filters.checkedTypes.value = ['fallback'];
    expect(filters.filteredAnnotations.value.map(({ context }) => context.confidencePairIndex))
      .toEqual([1, -1]);

    const cascadeFixture = makePairFixture([
      [['top', 0.5], ['fallback', 0.8]],
    ]).filters;
    cascadeFixture.setConfidenceFilters({ top: 0.5, fallback: 0.8, default: 0.1 });
    cascadeFixture.checkedTypes.value = ['top', 'fallback'];
    clientSettings.typeSettings.preventCascadeTypes = true;
    expect(cascadeFixture.filteredAnnotations.value).toHaveLength(0);
    cascadeFixture.setConfidenceFilters({ top: 0.49, fallback: 0.8, default: 0.1 });
    expect(cascadeFixture.filteredAnnotations.value.map(({ context }) => context.confidencePairIndex))
      .toEqual([0]);

    cascadeFixture.disableAnnotationFilters.value = true;
    expect(cascadeFixture.filteredAnnotations.value.map(({ context }) => context.confidencePairIndex))
      .toEqual([0]);
  });

  it('selects deepest qualifying hierarchy pairs for monotone and non-monotone scores', () => {
    const { cameraStore, filters } = makePairFixture([
      [['root', 0.9], ['child', 0.8], ['leaf', 0.7]],
      [['root', 0.2], ['child', 0.9], ['leaf', 0.6]],
    ]);
    filters.setTypeHierarchy({ leaf: 'child', child: 'root' });
    filters.setConfidenceFilters({ default: 0.5 });
    expect(filters.displayPairIndex(cameraStore.getTrack(0), 0)).toBe(2);
    expect(filters.displayPairIndex(cameraStore.getTrack(1), 0)).toBe(2);

    filters.setConfidenceFilters({ leaf: 0.7, default: 0.5 });
    expect(filters.displayPairIndex(cameraStore.getTrack(0), 0)).toBe(2);
    filters.setConfidenceFilters({ leaf: 0.71, default: 0.5 });
    expect(filters.displayPairIndex(cameraStore.getTrack(0), 0)).toBe(1);
  });

  it('rolls up unchecked leaves and ignores Prevent Cascade in hierarchy mode', () => {
    const { cameraStore, filters } = makePairFixture([
      [['root', 0.9], ['child', 0.8], ['leaf', 0.7]],
    ]);
    filters.setTypeHierarchy({ leaf: 'child', child: 'root' });
    filters.checkedTypes.value = ['root', 'child'];
    clientSettings.typeSettings.preventCascadeTypes = false;
    const withoutPrevent = filters.displayPairIndex(cameraStore.getTrack(0), 0);
    clientSettings.typeSettings.preventCascadeTypes = true;
    expect(filters.displayPairIndex(cameraStore.getTrack(0), 0)).toBe(withoutPrevent);
    expect(withoutPrevent).toBe(1);
  });

  it('uses pair zero for the active-hierarchy disabled-filter bypass', () => {
    const { cameraStore, filters } = makePairFixture([[['root', 0.1], ['leaf', 0.9]]]);
    filters.setTypeHierarchy({ leaf: 'root' });
    filters.checkedTypes.value = [];
    filters.disableAnnotationFilters.value = true;
    expect(filters.displayPairIndex(cameraStore.getTrack(0), -1)).toBe(0);
  });

  it('excludes empty and entirely non-passing hierarchy vectors without inventing a pair', () => {
    const { cameraStore, filters } = makePairFixture([[], [['root', 0.1]]]);
    filters.setTypeHierarchy({ leaf: 'root' });
    filters.setConfidenceFilters({ default: 0.5 });
    expect(filters.displayPairIndex(cameraStore.getTrack(0), 0)).toBe(-1);
    expect(filters.displayPairIndex(cameraStore.getTrack(1), 0)).toBe(-1);
    expect(filters.filteredAnnotations.value).toEqual([]);

    filters.disableAnnotationFilters.value = true;
    expect(filters.displayPairIndex(cameraStore.getTrack(0), 0)).toBe(-1);
    expect(filters.filteredAnnotations.value.map(({ annotation, context }) => ({
      id: annotation.id,
      confidencePairIndex: context.confidencePairIndex,
    }))).toEqual([{ id: 1, confidencePairIndex: 0 }]);
  });

  it('compiles only when hierarchy content changes', () => {
    const { filters } = makePairFixture([[['root', 1]]]);
    filters.setTypeHierarchy({ leaf: 'root' });
    const firstIndex = filters.hierarchyIndex.value;
    filters.setConfidenceFilters({ default: 0.9 });
    filters.checkedTypes.value = ['root'];
    expect(filters.hierarchyIndex.value).toBe(firstIndex);
    filters.setTypeHierarchy({ leaf: 'root' });
    expect(filters.hierarchyIndex.value).toBe(firstIndex);
    filters.setTypeHierarchy({ leaf: 'root', fin: 'root' });
    expect(filters.hierarchyIndex.value).not.toBe(firstIndex);
  });

  it('keeps hierarchy-only members out of configured style persistence', () => {
    const { filters } = makePairFixture([[['leaf', 1]]]);
    filters.importTypes(['configured'], false);
    filters.setTypeHierarchy({ leaf: 'heading' });
    expect(filters.allTypes.value).toEqual(['leaf', 'configured', 'heading']);
    expect(filters.usedPlusConfiguredTypes.value).toEqual(['leaf', 'configured']);
    expect(filters.checkedTypes.value).toEqual(expect.arrayContaining(['heading']));
    filters.setTypeHierarchy(undefined);
    expect(filters.allTypes.value).toEqual(['leaf', 'configured']);
    expect(filters.checkedTypes.value).not.toContain('heading');
  });

  it('does not recheck an unchecked hierarchy member when style promotion configures it', () => {
    const { filters } = makePairFixture([[['leaf', 1]]]);
    filters.setTypeHierarchy({ leaf: 'heading' });
    filters.updateCheckedTypes(['leaf']);
    filters.importTypes(['heading'], false);
    expect(filters.configuredTypes.value).toContain('heading');
    expect(filters.checkedTypes.value).toEqual(['leaf']);
  });

  it('preserves an unchecked used type when hierarchy loading makes it a member', () => {
    const { filters } = makePairFixture([[['leaf', 1]]]);
    filters.updateCheckedTypes([]);
    filters.setTypeHierarchy({ leaf: 'heading' });
    expect(filters.checkedTypes.value).toEqual(['heading']);
  });

  it('keeps generic group type imports checkbox-neutral', () => {
    const cameraStore = makeCameraStore();
    const groupFilters = makeGroupFilterControls(cameraStore);
    groupFilters.updateCheckedTypes([]);
    groupFilters.importTypes(['unused group'], false);
    expect(groupFilters.allTypes.value).toContain('unused group');
    expect(groupFilters.checkedTypes.value).toEqual([]);
  });

  it('preserves flat track and group configured-only rename behavior', () => {
    const { filters } = makePairFixture([[['used', 0.8]]]);
    filters.importTypes(['unused'], false);
    filters.updateTypeName({ currentType: 'unused', newType: 'renamed' });
    expect(filters.configuredTypes.value).not.toContain('unused');
    expect(filters.configuredTypes.value).not.toContain('renamed');

    const cameraStore = makeCameraStore();
    const groupFilters = makeGroupFilterControls(cameraStore);
    groupFilters.importTypes(['unused group'], false);
    groupFilters.updateTypeName({ currentType: 'unused group', newType: 'renamed group' });
    expect(groupFilters.configuredTypes.value).not.toContain('unused group');
    expect(groupFilters.configuredTypes.value).not.toContain('renamed group');
  });

  it('rewrites hierarchy, annotations, configured types, filters, and checks on rename', () => {
    const markPending = vi.fn();
    const { cameraStore, filters } = makePairFixture([[['leaf', 0.8], ['root', 0.7]]], markPending);
    filters.importTypes(['leaf'], false);
    filters.setConfidenceFilters({ leaf: 0.4, default: 0.1 });
    filters.setTypeHierarchy({ leaf: 'root' });
    markPending.mockClear();
    filters.updateTypeName({ currentType: 'leaf', newType: 'fin' });
    expect(filters.typeHierarchy.value).toEqual({ fin: 'root' });
    expect(cameraStore.getTrack(0).confidencePairs).toEqual([['fin', 0.8], ['root', 0.7]]);
    expect(filters.configuredTypes.value).toEqual(['fin']);
    expect(filters.confidenceFilters.value).toEqual({ fin: 0.4, default: 0.1 });
    expect(filters.checkedTypes.value).toContain('fin');
    expect(filters.typeHierarchySavePatch()).toEqual({ typeHierarchy: { fin: 'root' } });
  });

  it('does not configure a hierarchy-only heading during a name-only rename', () => {
    const { filters } = makePairFixture([[['leaf', 1]]]);
    filters.setTypeHierarchy({ leaf: 'heading' });
    filters.updateTypeName({ currentType: 'heading', newType: 'renamed heading' });
    expect(filters.typeHierarchy.value).toEqual({ leaf: 'renamed heading' });
    expect(filters.allTypes.value).toEqual(['leaf', 'renamed heading']);
    expect(filters.usedPlusConfiguredTypes.value).toEqual(['leaf']);
  });

  it('renames without collapsing, reordering, or rescoring a confidence-1 vector', () => {
    const { cameraStore, filters } = makePairFixture([
      [['leaf', 1], ['root', 0.8], ['other', 0.2]],
    ]);
    filters.setTypeHierarchy({ leaf: 'root' });
    filters.updateTypeName({ currentType: 'leaf', newType: 'fin' });
    expect(cameraStore.getTrack(0).confidencePairs).toEqual([
      ['fin', 1], ['root', 0.8], ['other', 0.2],
    ]);
  });

  it('preserves each camera confidence vector while renaming exact occurrences', () => {
    const { cameraStore, filters } = makePairFixture([
      [['leaf', 1], ['root', 0.8]],
    ]);
    cameraStore.addCamera('right');
    cameraStore.camMap.value.get('right')?.trackStore.insert(new Track(0, {
      confidencePairs: [['other', 0.6], ['leaf', 0.4]],
      features,
    }));
    filters.setTypeHierarchy({ leaf: 'root' });
    filters.updateTypeName({ currentType: 'leaf', newType: 'fin' });
    expect(cameraStore.getTrack(0, 'singleCam').confidencePairs).toEqual([
      ['fin', 1], ['root', 0.8],
    ]);
    expect(cameraStore.getTrack(0, 'right').confidencePairs).toEqual([
      ['other', 0.6], ['fin', 0.4],
    ]);
  });

  it('rejects invalid hierarchy renames before any mutation or pending event', () => {
    const markPending = vi.fn();
    const { cameraStore, filters } = makePairFixture([[['leaf', 0.8]]], markPending);
    filters.setTypeHierarchy({ leaf: 'root' });
    markPending.mockClear();
    expect(() => filters.updateTypeName({ currentType: 'leaf', newType: 'root' }))
      .toThrow(TypeHierarchyError);
    expect(filters.typeHierarchy.value).toEqual({ leaf: 'root' });
    expect(cameraStore.getTrack(0).confidencePairs).toEqual([['leaf', 0.8]]);
    expect(markPending).not.toHaveBeenCalled();
  });

  it('rejects a rename when one track already has both names', () => {
    const markPending = vi.fn();
    const { cameraStore, filters } = makePairFixture([
      [['leaf', 0.8], ['fin', 0.7]],
    ], markPending);
    filters.setTypeHierarchy({ leaf: 'root' });
    markPending.mockClear();
    expect(() => filters.updateTypeName({ currentType: 'leaf', newType: 'fin' }))
      .toThrow('track 0 already contains both "leaf" and "fin"');
    expect(cameraStore.getTrack(0).confidencePairs).toEqual([['leaf', 0.8], ['fin', 0.7]]);
    expect(markPending).not.toHaveBeenCalled();
  });

  it('rejects a collision in another camera before changing any stored vector', () => {
    const markPending = vi.fn();
    const { cameraStore, filters } = makePairFixture([
      [['leaf', 1], ['root', 0.8]],
    ], markPending);
    cameraStore.addCamera('right');
    cameraStore.camMap.value.get('right')?.trackStore.insert(new Track(0, {
      confidencePairs: [['leaf', 0.6], ['fin', 0.5]],
      features,
    }));
    filters.setTypeHierarchy({ leaf: 'root' });
    markPending.mockClear();

    expect(() => filters.updateTypeName({ currentType: 'leaf', newType: 'fin' }))
      .toThrow('track 0 already contains both "leaf" and "fin"');
    expect(cameraStore.getTrack(0, 'singleCam').confidencePairs).toEqual([
      ['leaf', 1], ['root', 0.8],
    ]);
    expect(cameraStore.getTrack(0, 'right').confidencePairs).toEqual([
      ['leaf', 0.6], ['fin', 0.5],
    ]);
    expect(filters.typeHierarchy.value).toEqual({ leaf: 'root' });
    expect(markPending).not.toHaveBeenCalled();
  });

  it('clears settings for unused parents and leaves hierarchy state unchanged', () => {
    const markPending = vi.fn();
    const { filters } = makePairFixture([[['used', 1]]], markPending);
    filters.importTypes(['leaf'], false);
    filters.setConfidenceFilters({ leaf: 0.4, default: 0.1 });
    filters.setTypeHierarchy({ leaf: 'parent', parent: 'root' });
    markPending.mockClear();
    const hierarchyBefore = { ...filters.typeHierarchy.value };
    const checkedBefore = [...filters.checkedTypes.value];
    expect(filters.deleteType('parent')).toBe(true);
    expect(filters.deleteType('leaf')).toBe(true);
    expect(filters.typeHierarchy.value).toEqual(hierarchyBefore);
    expect(filters.configuredTypes.value).not.toContain('leaf');
    expect(filters.confidenceFilters.value).not.toHaveProperty('leaf');
    expect(filters.checkedTypes.value).toEqual(checkedBefore);
    expect(markPending).toHaveBeenCalledTimes(2);
  });

  it('blocks deleting a type that only a collapse-hidden camera still uses', () => {
    const markPending = vi.fn();
    const { cameraStore, filters } = makePairFixture([
      [['fish', 0.9], ['tuna', 0.7]],
    ], markPending);
    cameraStore.addCamera('right');
    cameraStore.camMap.value.get('right')?.trackStore.insert(new Track(0, {
      confidencePairs: [['shark', 1]],
      features,
    }));
    filters.importTypes(['tuna'], false);
    filters.setConfidenceFilters({ tuna: 0.4, default: 0.1 });
    filters.setTypeHierarchy({ tuna: 'fish' });
    markPending.mockClear();

    expect(filters.usedTypes.value).toEqual(['shark']);
    expect(filters.typeInUseOnAnyCamera('tuna')).toBe(true);
    expect(filters.deleteType('tuna')).toBe(false);
    expect(filters.typeHierarchy.value).toEqual({ tuna: 'fish' });
    expect(filters.configuredTypes.value).toContain('tuna');
    expect(filters.confidenceFilters.value).toHaveProperty('tuna', 0.4);
    expect(filters.checkedTypes.value).toContain('tuna');
    expect(markPending).not.toHaveBeenCalled();
  });

  it('keeps hierarchy active after clearing the final leaf settings', () => {
    const { filters } = makePairFixture([[['used', 1]]]);
    filters.setTypeHierarchy({ leaf: 'root' });
    expect(filters.deleteType('leaf')).toBe(true);
    expect(filters.hierarchyActive.value).toBe(true);
    expect(filters.typeHierarchy.value).toEqual({ leaf: 'root' });
    expect(filters.typeHierarchySavePatch()).toEqual({});
  });
});
