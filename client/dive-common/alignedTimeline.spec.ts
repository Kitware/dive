import type { FrameImage } from './apispec';
import { buildAlignedTimeline, canAlign } from './alignedTimeline';

function frame(timestamp?: number): FrameImage {
  return { url: `url-${timestamp}`, filename: `frame-${timestamp}.png`, timestamp };
}

describe('alignedTimeline', () => {
  it('aligns when every camera has a timestamp on every frame', () => {
    const camerasFrames = {
      A: [frame(100), frame(200), frame(300)],
      B: [frame(100), frame(200), frame(300)],
    };
    expect(canAlign(camerasFrames)).toBe(true);
    const result = buildAlignedTimeline(camerasFrames);
    expect(result).toEqual({
      aligned: true,
      slots: [
        { A: 0, B: 0 },
        { A: 1, B: 1 },
        { A: 2, B: 2 },
      ],
    });
  });

  it('falls back when any single frame anywhere is missing a timestamp', () => {
    const camerasFrames = {
      A: [frame(100), frame(undefined)],
      B: [frame(100), frame(200)],
    };
    expect(canAlign(camerasFrames)).toBe(false);
    expect(buildAlignedTimeline(camerasFrames)).toEqual({ aligned: false });
  });

  it('resolves a genuine out-of-tolerance gap on one camera to undefined at that slot', () => {
    const camerasFrames = {
      A: [frame(100), frame(200), frame(300)],
      B: [frame(100.1), frame(300.2)],
    };
    const result = buildAlignedTimeline(camerasFrames);
    expect(result).toEqual({
      aligned: true,
      slots: [
        { A: 0, B: 0 },
        { A: 1, B: undefined },
        { A: 2, B: 1 },
      ],
    });
  });

  it('merges cameras with clock drift within tolerance into one slot', () => {
    const camerasFrames = {
      A: [frame(100), frame(200), frame(300)],
      B: [frame(100.45), frame(200.4), frame(300.3)],
    };
    const result = buildAlignedTimeline(camerasFrames, 0.5);
    expect(result).toEqual({
      aligned: true,
      slots: [
        { A: 0, B: 0 },
        { A: 1, B: 1 },
        { A: 2, B: 2 },
      ],
    });
  });

  it('splits two same-camera frames within one tolerance window into separate slots', () => {
    const camerasFrames = {
      A: [frame(100), frame(100.2)],
      B: [frame(100.1)],
    };
    const result = buildAlignedTimeline(camerasFrames, 0.5);
    expect(result).toEqual({
      aligned: true,
      slots: [
        { A: 0, B: 0 },
        { A: 1, B: undefined },
      ],
    });
  });

  it('disqualifies a dataset with an empty-array (e.g. video-backed) camera', () => {
    const camerasFrames = {
      A: [] as FrameImage[],
      B: [frame(100)],
    };
    expect(canAlign(camerasFrames)).toBe(false);
    expect(buildAlignedTimeline(camerasFrames)).toEqual({ aligned: false });
  });

  it('disqualifies datasets with fewer than two cameras', () => {
    const camerasFrames = {
      A: [frame(100), frame(200)],
    };
    expect(canAlign(camerasFrames)).toBe(false);
    expect(buildAlignedTimeline(camerasFrames)).toEqual({ aligned: false });
  });
});
