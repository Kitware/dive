/// <reference types="vitest" />
import Track, { TrackData } from '../track';
import { isSuppressedAttributeValue, hasSuppressionAttribute } from './suppression';

function makeTrack(overrides: Partial<TrackData> = {}): Track {
  return Track.fromJSON({
    attributes: {},
    begin: 0,
    end: 0,
    confidencePairs: [['seal', 0.9]],
    features: [
      {
        frame: 0,
        bounds: [0, 0, 10, 10],
        keyframe: true,
        interpolate: false,
      },
    ],
    meta: {},
    id: 1,
    ...overrides,
  });
}

describe('isSuppressedAttributeValue', () => {
  it('accepts common truthy flag spellings', () => {
    expect(isSuppressedAttributeValue(true)).toBe(true);
    expect(isSuppressedAttributeValue(1)).toBe(true);
    expect(isSuppressedAttributeValue('true')).toBe(true);
    expect(isSuppressedAttributeValue('True')).toBe(true);
    expect(isSuppressedAttributeValue('ON')).toBe(true);
    expect(isSuppressedAttributeValue('yes')).toBe(true);
    expect(isSuppressedAttributeValue(' 1 ')).toBe(true);
  });

  it('rejects falsy or unrelated values', () => {
    expect(isSuppressedAttributeValue(false)).toBe(false);
    expect(isSuppressedAttributeValue(0)).toBe(false);
    expect(isSuppressedAttributeValue('false')).toBe(false);
    expect(isSuppressedAttributeValue('off')).toBe(false);
    expect(isSuppressedAttributeValue('')).toBe(false);
    expect(isSuppressedAttributeValue(undefined)).toBe(false);
    expect(isSuppressedAttributeValue(null)).toBe(false);
    expect(isSuppressedAttributeValue({})).toBe(false);
  });
});

describe('hasSuppressionAttribute', () => {
  it('is disabled when no suppression type is configured', () => {
    const track = makeTrack({ attributes: { Suppressed: true } });
    expect(hasSuppressionAttribute(track, 0, undefined)).toBe(false);
    expect(hasSuppressionAttribute(track, 0, '')).toBe(false);
  });

  it('reads a track-level attribute named after the suppression type', () => {
    const track = makeTrack({ attributes: { Suppressed: true } });
    expect(hasSuppressionAttribute(track, 0, 'Suppressed')).toBe(true);
    expect(hasSuppressionAttribute(track, 0, 'OtherName')).toBe(false);
  });

  it('reads a detection-level attribute on the frame', () => {
    const track = makeTrack({
      features: [
        {
          frame: 0,
          bounds: [0, 0, 10, 10],
          keyframe: true,
          interpolate: false,
          attributes: { Suppressed: 'true' },
        },
      ],
    });
    expect(hasSuppressionAttribute(track, 0, 'Suppressed')).toBe(true);
  });

  it('falls back to the previous keyframe on interpolated frames', () => {
    const track = makeTrack({
      begin: 0,
      end: 10,
      features: [
        {
          frame: 0,
          bounds: [0, 0, 10, 10],
          keyframe: true,
          interpolate: true,
          attributes: { Suppressed: true },
        },
        {
          frame: 10,
          bounds: [10, 10, 20, 20],
          keyframe: true,
          interpolate: true,
        },
      ],
    });
    expect(hasSuppressionAttribute(track, 5, 'Suppressed')).toBe(true);
  });

  it('is false for an unflagged detection', () => {
    const track = makeTrack();
    expect(hasSuppressionAttribute(track, 0, 'Suppressed')).toBe(false);
  });
});
