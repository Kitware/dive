import { createTrackProjection, TrackProjection } from './TrackProjection';
import Track, { Feature } from './track';

/**
 * The read contract a single-camera projection must answer identically to its source Track.
 * Adding a member to TrackProjection without extending this list fails the closure test below.
 */
const READ_METHODS = [
  'getType',
  'getFeature',
  'canSplit',
  'canInterpolate',
  'getNextKeyframe',
  'getPreviousKeyframe',
] as const;

const READ_PROPERTIES = [
  'id',
  'trackId',
  'meta',
  'attributes',
  'confidencePairs',
  'begin',
  'end',
  'length',
  'features',
  'featureIndex',
  'set',
] as const;

function keyframe(frame: number, interpolate: boolean): Feature {
  return {
    frame, bounds: [frame, 0, frame + 10, 10], keyframe: true, interpolate,
  };
}

function trackFrom(frames: number[], interpolate: boolean) {
  const features: Feature[] = [];
  frames.forEach((frame) => { features[frame] = keyframe(frame, interpolate); });
  return new Track(7, {
    begin: frames[0],
    end: frames[frames.length - 1],
    confidencePairs: [['fish', 0.9], ['shark', 0.4]],
    attributes: { source: 'fixture' },
    features,
  });
}

const FIXTURES: [string, () => Track][] = [
  ['contiguous keyframes', () => trackFrom([0, 1, 2], false)],
  ['gap with interpolation', () => trackFrom([0, 4], true)],
  ['gap without interpolation', () => trackFrom([0, 4], false)],
  ['single detection', () => trackFrom([0], false)],
  ['keyframe removed mid-track', () => {
    const track = trackFrom([0, 1, 2], false);
    track.toggleKeyframe(1);
    return track;
  }],
];

/** Frames spanning before, inside, on, and past the track bounds. */
const FRAMES = [-1, 0, 1, 2, 3, 4, 5];

describe('TrackProjection parity with its source Track', () => {
  it.each(FIXTURES)('answers every read method identically for %s', (_name, makeTrack) => {
    const track = makeTrack();
    const projection = createTrackProjection([track]);

    READ_PROPERTIES.forEach((property) => {
      expect({ [property]: projection[property] }).toEqual({ [property]: track[property] });
    });

    FRAMES.forEach((frame) => {
      expect({ frame, getFeature: projection.getFeature(frame) })
        .toEqual({ frame, getFeature: track.getFeature(frame) });
      expect({ frame, canSplit: projection.canSplit(frame) })
        .toEqual({ frame, canSplit: track.canSplit(frame) });
      expect({ frame, canInterpolate: projection.canInterpolate(frame) })
        .toEqual({ frame, canInterpolate: track.canInterpolate(frame) });
      expect({ frame, next: projection.getNextKeyframe(frame) })
        .toEqual({ frame, next: track.getNextKeyframe(frame) });
      expect({ frame, previous: projection.getPreviousKeyframe(frame) })
        .toEqual({ frame, previous: track.getPreviousKeyframe(frame) });
    });

    track.confidencePairs.forEach((_pair, index) => {
      expect(projection.getType(index)).toEqual(track.getType(index));
    });
  });

  it('covers every member of the projection read contract', () => {
    const projection = createTrackProjection([trackFrom([0, 1], false)]);
    const members = Object.keys(projection) as (keyof TrackProjection)[];
    const methods = members.filter((key) => typeof projection[key] === 'function');
    const properties = members.filter((key) => typeof projection[key] !== 'function');

    expect(methods.sort()).toEqual([...READ_METHODS].sort());
    expect(properties.sort()).toEqual([...READ_PROPERTIES].sort());
  });

  it('exposes no mutator or notifier from the source track', () => {
    const projection = createTrackProjection([trackFrom([0, 1], false)]);
    [
      'setFeature', 'deleteFeature', 'toggleKeyframe', 'toggleInterpolation', 'split',
      'merge', 'setType', 'setAttribute', 'setNotifier', 'notify', 'revision',
    ].forEach((key) => expect(key in projection).toBe(false));
  });

  it('shares feature lookup with Track while retaining projection-owned copies', () => {
    const track = trackFrom([0, 4], true);
    const projection = createTrackProjection([track]);

    FRAMES.forEach((frame) => {
      expect(Track.getFeatureFrom(
        track.features,
        track.featureIndex,
        track.begin,
        track.end,
        frame,
      )).toEqual(track.getFeature(frame));
    });

    const [feature] = projection.getFeature(0);
    (feature as Feature).bounds![0] = 99;
    expect(track.getFeature(0)[0]?.bounds?.[0]).toBe(0);
  });
});
