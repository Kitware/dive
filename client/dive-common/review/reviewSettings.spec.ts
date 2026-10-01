import { describe, expect, it } from 'vitest';
import { normalizeReviewSettings } from './reviewSettings';

describe('normalizeReviewSettings', () => {
  it('defaults activate on hover and clamps playback fps', () => {
    expect(normalizeReviewSettings({ activateOnHover: true, playbackFps: 1 })).toEqual({
      activateOnHover: true,
      playbackFps: 1,
    });
    expect(normalizeReviewSettings({ activateOnHover: false, playbackFps: 4.6 })).toEqual({
      activateOnHover: false,
      playbackFps: 5,
    });
    expect(normalizeReviewSettings({ activateOnHover: undefined as unknown as boolean, playbackFps: 120 })).toEqual({
      activateOnHover: true,
      playbackFps: 60,
    });
    expect(normalizeReviewSettings({ activateOnHover: true, playbackFps: Number.NaN })).toEqual({
      activateOnHover: true,
      playbackFps: 1,
    });
  });
});
