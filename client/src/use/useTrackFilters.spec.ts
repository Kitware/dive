/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi from '@vue/composition-api';
import Track, { Feature } from '../track';
import useTrackFilters from './useTrackFilters';
import useTrackStore from './useTrackStore';

Vue.use(CompositionApi);

const removeTrack = () => null;
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

function makeTrackStore() {
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
  const ts = useTrackStore({ markChangesPending: () => null });
  ts.insertTrack(t0);
  ts.insertTrack(t1);
  ts.insertTrack(t2);
  return ts;
}

describe('useTrackFilters', () => {
  it('updateTypeName', () => {
    const { sortedTracks } = makeTrackStore();
    const tf = useTrackFilters({ sortedTracks, removeTrack, markChangesPending });
    tf.setConfidenceFilters({ baz: 0.1, bar: 0.2 });
    tf.updateTypeName({ currentType: 'foo', newType: 'baz' });
    expect(tf.confidenceFilters.value).toEqual({ baz: 0.1, bar: 0.2 });
    expect(tf.allTypes.value).toEqual(['baz', 'bar']);
    tf.updateTypeName({ currentType: 'baz', newType: 'newtype' });
    expect(tf.allTypes.value).toEqual(['newtype', 'bar']);
    expect(tf.confidenceFilters.value).toEqual({ bar: 0.2, newtype: 0.1 });
  });

  it('deleteType', () => {
    const { sortedTracks } = makeTrackStore();
    const tf = useTrackFilters({ sortedTracks, removeTrack, markChangesPending });
    tf.setConfidenceFilters({ baz: 0.1, bar: 0.2 });
    tf.deleteType('bar'); // delete type only deletes the defaultType, doesn't touch tracks.
    expect(sortedTracks.value).toHaveLength(3);
    expect(tf.allTypes.value).toEqual(['foo', 'bar', 'baz']);
    expect(tf.confidenceFilters.value).toEqual({ baz: 0.1 });
  });

  it('removeTypeTrack', async () => {
    const { sortedTracks } = makeTrackStore();
    const sypRemoveTrack = jest.fn();
    const tf = useTrackFilters({ sortedTracks, removeTrack: sypRemoveTrack, markChangesPending });
    tf.removeTypeTracks(['bar']);
    expect(tf.allTypes.value).toEqual(['foo', 'bar', 'baz']);
    expect(sypRemoveTrack).not.toHaveBeenCalled();
    tf.removeTypeTracks(['baz']);
    expect(tf.allTypes.value).toEqual(['foo', 'bar', 'baz']);
    expect(sypRemoveTrack).toHaveBeenCalledTimes(1);
  });
});
