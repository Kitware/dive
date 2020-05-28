/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi from '@vue/composition-api';
import Track, { TrackData } from './track';

Vue.use(CompositionApi);

describe('Track', () => {
  it('should create new instances from JSON', () => {
    const itrack: TrackData = {
      attributes: {},
      begin: 0,
      end: 100,
      confidencePairs: [
        ['foo', 1],
        ['bar', 0.9],
      ],
      features: [
        {
          frame: 0,
          bounds: [1, 2, 3, 4],
          head: [1, 2],
        },
      ],
      meta: {},
      trackId: '1',
    };
    const t = Track.fromJSON(itrack);
    expect(t).toBeInstanceOf(Track);
    expect(t.begin.value).toBe(0);
    expect(t.end.value).toBe(100);
    expect(t.confidencePairs.value).toHaveLength(2);
    expect(t.meta).toHaveProperty('value');
  });
});
