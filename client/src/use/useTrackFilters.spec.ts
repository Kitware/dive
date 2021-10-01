/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi, { computed } from '@vue/composition-api';
import Track from '../track';
import useTrackFilters from './useTrackFilters';

Vue.use(CompositionApi);

const sortedTracks = computed(() => ([
  new Track(0, {
    confidencePairs: [['foo', 0.5], ['bar', 0.4]],
  }),
  new Track(2, {
    confidencePairs: [['foo', 0.9], ['baz', 0.2]],
  }),
  new Track(200, {
    confidencePairs: [['bar', 1], ['baz', 0.8]],
  }),
]));

const removeTrack = () => null;
const markChangesPending = () => null;

describe('useTrackFilters', () => {
  it('renames tracks', () => {
    const tf = useTrackFilters({ sortedTracks, removeTrack, markChangesPending });
    tf.updateTypeName({ currentType: 'foo', newType: 'baz' });
    expect(tf.allTypes.value).toEqual(['baz', 'bar']);
  });
});
