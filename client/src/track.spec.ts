/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi from '@vue/composition-api';
import Track, { TrackData } from './track';
import { RectBounds } from './utils';

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
      trackId: 1,
    };
    const t = Track.fromJSON(itrack);
    expect(t).toBeInstanceOf(Track);
    expect(t.begin).toBe(0);
    expect(t.end).toBe(100);
    expect(t.confidencePairs).toHaveLength(2);
  });

  it('should correct its begin and end based on setFeature', () => {
    const track = new Track(0, {
      meta: {},
      begin: 0,
      end: 0,
    });
    const feature = {
      frame: 1,
      bounds: [1, 2, 3, 4] as RectBounds,
      keyframe: true,
    };
    track.setFeature(feature);
    const f0 = track.getFeature(0);
    const f1 = track.getFeature(1);
    expect(f0).toStrictEqual([null, feature, null]);
    expect(f1).toStrictEqual([feature, feature, feature]);
    expect(track.begin).toBe(1);
    expect(track.end).toBe(1);
  });

  it('should correctly reset begin and end on firstFeature', () => {
    const track = new Track(0, {
      meta: {},
      begin: 8,
      end: 8,
    });
    const feature = {
      frame: 3,
      bounds: [1, 2, 3, 4] as RectBounds,
      keyframe: true,
    };
    track.setFeature(feature);
    const f2 = track.getFeature(2);
    const f3 = track.getFeature(3);
    const f4 = track.getFeature(4);
    expect(f2).toStrictEqual([null, feature, null]);
    expect(f3).toStrictEqual([feature, feature, feature]);
    expect(f4).toStrictEqual([null, null, feature]);
    expect(track.begin).toBe(3);
    expect(track.end).toBe(3);
  });

  it('should fail to initialize with non-sparse array', () => {
    const features = [
      { frame: 1, bounds: [1, 2, 3, 4] as RectBounds, keyframe: true },
    ];
    expect(() => new Track(1, {
      meta: {},
      begin: 1,
      end: 1,
      features,
      confidencePairs: [['foo', 1]],
    })).toThrowError();
  });
});
