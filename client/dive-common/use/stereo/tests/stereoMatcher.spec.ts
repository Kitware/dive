import { describe, expect, it } from 'vitest';
import {
  fallBackStereoMethod, stereoFallbackMethod, STEREO_FALLBACK_NOTE,
} from '../stereoMatcher';

describe('falling back from a stereo method that cannot run', () => {
  it('drops every model-based method to template matching, which has nothing below it', () => {
    expect(stereoFallbackMethod('foundation')).toBe('ncc');
    expect(stereoFallbackMethod('dino')).toBe('ncc');
    expect(stereoFallbackMethod('ncc')).toBeNull();
  });

  it('names the new method and says so in the message', () => {
    expect(fallBackStereoMethod('foundation', 'The higher quality stereo model could not be loaded.')).toEqual({
      method: 'ncc',
      message: `The higher quality stereo model could not be loaded. ${STEREO_FALLBACK_NOTE}`,
    });
  });

  it('leaves the fastest method alone and reports the failure as it is', () => {
    expect(fallBackStereoMethod('ncc', 'Matching failed.')).toEqual({ method: 'ncc', message: 'Matching failed.' });
  });
});
