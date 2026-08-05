import { parseFrameLabelPresets, buildDefaultLabelTrack } from './frameLabels';

const BOUNDS: [number, number, number, number] = [0, 0, 1920, 1080];

describe('parseFrameLabelPresets', () => {
  it('collects labels in order and accepts a default', () => {
    const presets = parseFrameLabelPresets(['alpha', 'beta', 'gamma'], 'alpha');
    expect(presets.labels).toEqual(['alpha', 'beta', 'gamma']);
    expect(presets.defaultLabel).toBe('alpha');
  });

  it('accepts no default', () => {
    expect(parseFrameLabelPresets(['alpha']).defaultLabel).toBeUndefined();
  });

  it('rejects empty names, duplicates, and unknown defaults', () => {
    expect(() => parseFrameLabelPresets([''])).toThrow('may not be empty');
    expect(() => parseFrameLabelPresets(['a', 'a'])).toThrow('Duplicate frame label');
    expect(() => parseFrameLabelPresets(['a'], 'b')).toThrow('not one of the given labels');
  });
});

describe('buildDefaultLabelTrack', () => {
  it('covers every frame with interpolated full-frame keyframes', () => {
    const track = buildDefaultLabelTrack('alpha', 100, BOUNDS);
    expect([track.begin, track.end]).toEqual([0, 99]);
    expect(track.confidencePairs).toEqual([['alpha', 1]]);
    expect(track.features).toEqual([
      {
        frame: 0, bounds: BOUNDS, keyframe: true, interpolate: true,
      },
      {
        frame: 99, bounds: BOUNDS, keyframe: true, interpolate: true,
      },
    ]);
  });

  it('handles single-frame media and honors trackId', () => {
    const track = buildDefaultLabelTrack('alpha', 1, BOUNDS, 7);
    expect([track.id, track.begin, track.end]).toEqual([7, 0, 0]);
    expect(track.features).toHaveLength(1);
  });
});
