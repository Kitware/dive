import {
  describe, expect, it, vi,
} from 'vitest';
import StereoServerMatcher, { parseFrameKey } from './StereoServerMatcher';

const RANGE = { min: 0, max: 0 } as never;

describe('StereoServerMatcher', () => {
  it('reads the frame pair out of the transfer key', () => {
    expect(parseFrameKey('left>right@12')).toEqual({ source: 'left', target: 'right', frame: 12 });
    expect(() => parseFrameKey(undefined)).toThrow('which frame');
  });

  it('asks the server for the points of that frame and marks the misses', async () => {
    const api = {
      transferPoints: vi.fn(async () => ({
        success: true, transferredPoints: [[10, 11], [NaN, NaN]] as [number, number][], validMatches: [true, false],
      })),
      setFrame: vi.fn(async () => ({})),
    };
    const matcher = new StereoServerMatcher(api, 'foundation');
    const results = await matcher.warpPoints([[1, 2], [3, 4]], null, null, null, { range: RANGE, frameKey: 'left>right@3' });
    expect(api.transferPoints).toHaveBeenCalledWith({
      frame: 3, sourceCamera: 'left', points: [[1, 2], [3, 4]], method: 'foundation',
    });
    expect(results.map((r) => r.accepted)).toEqual([true, false]);
    expect([results[0].x, results[0].y]).toEqual([10, 11]);
    await matcher.prepare('right>left@7', null, null, null);
    expect(api.setFrame).toHaveBeenCalledWith(7, 'foundation');
  });

  it('surfaces the server reason when the warp fails', async () => {
    const api = { transferPoints: vi.fn(async () => ({ success: false, error: 'no calibration' })), setFrame: vi.fn() };
    const matcher = new StereoServerMatcher(api, 'ncc');
    await expect(matcher.warpPoints([[1, 2]], null, null, null, { range: RANGE, frameKey: 'a>b@1' })).rejects.toThrow('no calibration');
  });
});
