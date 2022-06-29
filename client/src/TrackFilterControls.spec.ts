/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi from '@vue/composition-api';
import Track, { Feature } from './track';
import TrackFilterControls from './TrackFilterControls';
import GroupFilterControls from './GroupFilterControls';
import CameraStore from './CameraStore';
import { AnnotationId } from './BaseAnnotation';

Vue.use(CompositionApi);

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
  }
  return cameraStore;
}

function makeGroupFilterControls(store: CameraStore) {
  const remove = (id: AnnotationId) => {
    store.removeGroups(id);
  };
  return new GroupFilterControls({
    sorted: store.sortedGroups,
    remove,
    markChangesPending,
  });
}

function makeTrackFilterControls() {
  const cameraStore = makeCameraStore();
  const groupFilterControls = makeGroupFilterControls(cameraStore);
  const remove = (id: AnnotationId) => {
    cameraStore.removeTracks(id);
  };
  return new TrackFilterControls({
    sorted: cameraStore.sortedTracks,
    remove,
    markChangesPending,
    groupFilterControls,
    lookupGroups: cameraStore.lookupGroups,
  });
}

describe('useAnnotationFilters', () => {
  it('updateTypeName', async () => {
    const tf = makeTrackFilterControls();
    tf.setConfidenceFilters({ baz: 0.1, bar: 0.2, default: 0.1 });
    tf.updateTypeName({ currentType: 'foo', newType: 'baz' });
    expect(tf.allTypes.value).toEqual(['baz', 'bar']);
    expect(tf.filteredAnnotations.value.filter(({ annotation }) => annotation.getType()[0] === 'baz').length).toBe(2);
    tf.updateTypeName({ currentType: 'baz', newType: 'newtype' });
    await Vue.nextTick(); // must wait a tick for confidence to settle when newtype is added.
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
