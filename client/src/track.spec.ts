/// <reference types="jest" />
import Vue from 'vue';
import CompositionApi from '@vue/composition-api';
import Track, { ConfidencePair, TrackData } from './track';
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
    expect(() => track.setFeature({
      frame: 4,
    })).toThrow('must be called with keyframe');
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

  it('Indexing Types', () => {
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
    expect(t.getType()).toEqual(['foo', 1]);
    expect(t.getType(1)).toEqual(['bar', 0.9]);
    expect(t.getType(0)).toEqual(['foo', 1.0]);
    expect(() => t.getType(-1)).toThrow('Index Error: The requested confidencePairs index does not exist.');
    t.setType('newType');
    expect(t.getType()).toEqual(['newType', 1]);
    // Testing type out of range
    expect(() => t.getType(1)).toThrow('Index Error: The requested confidencePairs index does not exist.');
    t.setType('lowType', 0.25);
    expect(t.getType()).toEqual(['lowType', 0.25]);
    expect(() => t.getType(20)).toThrow('Index Error: The requested confidencePairs index does not exist.');
  });

  it('merges tracks', () => {
    const track0tmpl: TrackData = {
      begin: 0,
      end: 10,
      attributes: {
        a: 'a',
      },
      confidencePairs: [
        ['a', 0.1],
        ['b', 0.2],
      ],
      features: [
        {
          frame: 0,
          bounds: [0, 0, 0, 0],
          attributes: { a1: 'a1' },
        },
        {
          frame: 10,
          bounds: [10, 10, 10, 10],
        },
      ],
      meta: {},
      trackId: 0,
    };
    const track1tmpl: TrackData = {
      begin: 2,
      end: 12,
      attributes: {
        a: 'b',
      },
      confidencePairs: [
        ['a', 0.2],
        ['c', 0.3],
      ],
      features: [
        {
          frame: 2,
          bounds: [2, 2, 2, 2],
          interpolate: true,
          attributes: { a1: 'b1' },
        },
        {
          frame: 10,
          interpolate: true,
          bounds: [11, 11, 11, 11],
          attributes: { a1: 'b1' },
        },
      ],
      meta: {},
      trackId: 0,
    };
    const track0 = Track.fromJSON(track0tmpl);
    track0.merge([Track.fromJSON(track1tmpl)]);
    expect(track0.attributes).toEqual({ a: 'a' });
    expect(track0.begin).toBe(0);
    expect(track0.end).toBe(10);
    expect(track0.getFeature(0)[0]?.bounds).toEqual([0, 0, 0, 0]);
    expect(track0.getFeature(10)[0]?.bounds).toEqual([10, 10, 10, 10]);
    expect(track0.getFeature(10)[0]?.attributes).toBeUndefined();
    expect(track0.getFeature(10)[0]?.interpolate).toBeFalsy();
    expect(track0.trackId).toBe(0);
    expect(track0.featureIndex.length).toBe(3);
  });
});

describe('trackExceedsThreshold', () => {
  it('correctly determine if a confidence pair set exceeds any thresholds', () => {
    const pairs: ConfidencePair[] = [
      ['foo', 0.05],
      ['bar', 0.1],
      ['baz', 0.1000001],
    ];
    expect(Track.trackExceedsThreshold(pairs, {
      default: 0.1,
    })).toEqual([
      ['bar', 0.1],
      ['baz', 0.1000001],
    ]);
    expect(Track.trackExceedsThreshold(pairs, {
      default: 2,
    })).toEqual([]);
    expect(Track.trackExceedsThreshold(pairs, {
      default: 0.1,
      baz: 0.2,
    })).toEqual([
      ['bar', 0.1],
    ]);
    expect(Track.trackExceedsThreshold(pairs, {
      bar: 0.2,
    })).toEqual([
      ['foo', 0.05],
      ['baz', 0.1000001],
    ]);
  });
  it('other edge cases', () => {
    expect(Track.trackExceedsThreshold([], {})).toEqual([]);
    expect(Track.trackExceedsThreshold([['foo', 1]], {})).toEqual([['foo', 1]]);
    expect(Track.trackExceedsThreshold([['foo', 0]], {})).toEqual([['foo', 0]]);
  });
});
