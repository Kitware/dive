/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi, { computed } from '@vue/composition-api';
import Track from '../track';
import useTrackFilters from './useTrackFilters';
import useTrackStore from './useTrackStore';

Vue.use(CompositionApi);

const removeTrack = () => null;
const markChangesPending = () => null;

function makeTrackStore() {
  const t0 = new Track(0, {
    confidencePairs: [['foo', 0.5], ['bar', 0.4]],
  });
  const t1 = new Track(2, {
    confidencePairs: [['foo', 0.9], ['baz', 0.2]],
  });
  const t2 = new Track(200, {
    confidencePairs: [['bar', 1], ['baz', 0.8]],
  });
  const ts = useTrackStore({ markChangesPending: () => null });
  ts.insertTrack(t0);
  ts.insertTrack(t1);
  ts.insertTrack(t2);
  return ts;
}

describe('useTrackFilters', () => {
  it('renames tracks', async () => {
    const { sortedTracks } = makeTrackStore();
    const tf = useTrackFilters({ sortedTracks, removeTrack, markChangesPending });
    tf.updateTypeName({ currentType: 'foo', newType: 'baz' });
    await Vue.nextTick();
    await Vue.nextTick();
    await Vue.nextTick();
    console.log(sortedTracks.value.map((t) => t.confidencePairs));
    expect(tf.allTypes.value).toEqual(['baz', 'bar']);
  });
});
