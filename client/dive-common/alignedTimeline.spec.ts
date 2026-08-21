import type { FrameImage } from './apispec';
import {
  buildAlignedTimeline, buildInverseAlignedIndex, buildOffsetTimeline, canAlign,
  computeGapGradient, computeGapSlots,
} from './alignedTimeline';

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

  it('resolves a genuinely missing frame on one camera to undefined at that slot', () => {
    const camerasFrames = {
      A: [frame(100), frame(200), frame(300)],
      B: [frame(100), frame(300)],
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

  it('pairs frames positionally when every frame shares one identical timestamp', () => {
    // Calibration-style datasets (e.g. C/L/R shots stamped with a single
    // collection timestamp) must reduce to positional pairing, not spill each
    // camera's frames into separate mostly-blank slots.
    const t = 1712495277.206341;
    const camerasFrames = {
      EO: [frame(t), frame(t), frame(t)],
      IR: [frame(t), frame(t), frame(t)],
    };
    const result = buildAlignedTimeline(camerasFrames, 0.5);
    expect(result).toEqual({
      aligned: true,
      slots: [
        { EO: 0, IR: 0 },
        { EO: 1, IR: 1 },
        { EO: 2, IR: 2 },
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

  describe('computeGapSlots', () => {
    it('returns no gaps when every camera has a frame at every slot', () => {
      const camerasFrames = {
        A: [frame(100), frame(200)],
        B: [frame(100), frame(200)],
      };
      const result = buildAlignedTimeline(camerasFrames);
      expect(result.aligned).toBe(true);
      expect(result.aligned && computeGapSlots(result.slots)).toEqual([]);
    });

    it('flags slots where any camera is missing a frame', () => {
      const camerasFrames = {
        A: [frame(100), frame(200), frame(300)],
        B: [frame(100), frame(300)],
      };
      const result = buildAlignedTimeline(camerasFrames);
      expect(result.aligned).toBe(true);
      expect(result.aligned && computeGapSlots(result.slots)).toEqual([1]);
    });
  });

  describe('computeGapGradient', () => {
    it('returns none with no gaps or a non-positive maxFrame', () => {
      expect(computeGapGradient([], 10)).toBe('none');
      expect(computeGapGradient([1], 0)).toBe('none');
      expect(computeGapGradient([1], -5)).toBe('none');
    });

    it('centers a gap band on the slider thumb position for its slot', () => {
      // Thumb for value 4 of maxFrame 8 sits at 50%; band is [43.75%, 56.25%].
      expect(computeGapGradient([4], 8)).toBe(
        'linear-gradient(to right, transparent 43.75%, #ff5252 43.75%, #ff5252 56.25%, transparent 56.25%)',
      );
    });

    it('keeps a trailing gap at slot === maxFrame visible (clamped to 100%)', () => {
      expect(computeGapGradient([8], 8)).toBe(
        'linear-gradient(to right, transparent 93.75%, #ff5252 93.75%, #ff5252 100%, transparent 100%)',
      );
    });

    it('keeps a leading gap at slot 0 visible (clamped to 0%)', () => {
      expect(computeGapGradient([0], 8)).toBe(
        'linear-gradient(to right, transparent 0%, #ff5252 0%, #ff5252 6.25%, transparent 6.25%)',
      );
    });

    it('merges consecutive gap slots into a single band', () => {
      expect(computeGapGradient([2, 3], 8)).toBe(
        'linear-gradient(to right, transparent 18.75%, #ff5252 18.75%, #ff5252 43.75%, transparent 43.75%)',
      );
    });

    it('emits one band per distinct gap run', () => {
      expect(computeGapGradient([1, 3], 8)).toBe(
        'linear-gradient(to right, '
        + 'transparent 6.25%, #ff5252 6.25%, #ff5252 18.75%, transparent 18.75%, '
        + 'transparent 31.25%, #ff5252 31.25%, #ff5252 43.75%, transparent 43.75%)',
      );
    });

    it('widens sub-minimum-width bands around their center so they stay visible', () => {
      // One slot of 1024 is ~0.098% wide -- below the 0.25% minimum, so the
      // band is widened to exactly 0.25% centered on the thumb at 50%.
      expect(computeGapGradient([512], 1024)).toBe(
        'linear-gradient(to right, transparent 49.875%, #ff5252 49.875%, #ff5252 50.125%, transparent 50.125%)',
      );
    });
  });

  describe('buildInverseAlignedIndex', () => {
    it('maps each camera\'s local frame back to its global slot', () => {
      const camerasFrames = {
        A: [frame(100), frame(200), frame(300)],
        B: [frame(100), frame(300)],
      };
      const result = buildAlignedTimeline(camerasFrames);
      expect(result.aligned).toBe(true);
      if (!result.aligned) return;
      const inverse = buildInverseAlignedIndex(result.slots);
      expect(inverse.A.get(0)).toBe(0);
      expect(inverse.A.get(1)).toBe(1);
      expect(inverse.A.get(2)).toBe(2);
      expect(inverse.B.get(0)).toBe(0);
      expect(inverse.B.get(1)).toBe(2);
      // B has no local frame 2 -- it only ever appears in slots 0 and 2.
      expect(inverse.B.get(2)).toBeUndefined();
    });
  });
});

/**
 * Fixed-rig start offsets: the case timestamps can't cover, because video
 * frames carry none. EO/IR pairs from the same fixed rig are recorded by
 * independent encoders, so one can start a fraction of a second after the
 * other; that lag is constant for the whole recording.
 */
describe('buildOffsetTimeline', () => {
  it('pairs a later-starting camera with the reference instant', () => {
    // B starts 2 frames later: B's frame 2 is the same instant as A's 0.
    const result = buildOffsetTimeline({ A: 5, B: 5 }, { A: 0, B: 2 });
    if (!result.aligned) throw new Error('expected aligned');
    // Slot 0 is the earliest instant ANY camera saw: B's frame 0, before A began.
    expect(result.slots[0]).toEqual({ A: undefined, B: 0 });
    expect(result.slots[2]).toEqual({ A: 0, B: 2 });
    expect(result.slots[4]).toEqual({ A: 2, B: 4 });
  });

  it('keeps the union, blanking each camera outside its own coverage', () => {
    const result = buildOffsetTimeline({ A: 3, B: 3 }, { A: 0, B: 2 });
    if (!result.aligned) throw new Error('expected aligned');
    // 2 leading slots before A starts + 3 shared + 0 trailing.
    expect(result.slots).toHaveLength(5);
    expect(computeGapSlots(result.slots)).toEqual([0, 1, 3, 4]);
    // The overlap in the middle has both cameras.
    expect(result.slots[2]).toEqual({ A: 0, B: 2 });
  });

  it('round-trips through the inverse index the resolver uses', () => {
    const result = buildOffsetTimeline({ A: 4, B: 4 }, { A: 0, B: 1 });
    if (!result.aligned) throw new Error('expected aligned');
    const inverse = buildInverseAlignedIndex(result.slots);
    // Whatever slot holds A's frame 2 must hold B's frame 3 -- the same instant.
    const slotForA2 = inverse.A.get(2) as number;
    expect(result.slots[slotForA2].B).toBe(3);
    expect(inverse.B.get(3)).toBe(slotForA2);
  });

  it('handles a negative offset (reference is the later camera)', () => {
    const result = buildOffsetTimeline({ A: 4, B: 4 }, { A: 0, B: -1 });
    if (!result.aligned) throw new Error('expected aligned');
    expect(result.slots[1]).toEqual({ A: 1, B: 0 });
  });

  it('declines when nothing needs correcting or there is no pair', () => {
    // All-zero offsets: the positional path already does this, more cheaply.
    expect(buildOffsetTimeline({ A: 5, B: 5 }, { A: 0, B: 0 })).toEqual({ aligned: false });
    // A camera with no frames loaded can't be aligned against.
    expect(buildOffsetTimeline({ A: 5, B: 0 }, { A: 0, B: 2 })).toEqual({ aligned: false });
    expect(buildOffsetTimeline({ A: 5 }, { A: 3 })).toEqual({ aligned: false });
  });

  it('treats a missing camera entry as no offset', () => {
    // A is absent from the offsets map, so it behaves as A: 0 -- identical to
    // { A: 0, B: 1 }: one leading slot for B's frame 0, then the pairs.
    const result = buildOffsetTimeline({ A: 3, B: 3 }, { B: 1 });
    if (!result.aligned) throw new Error('expected aligned');
    expect(result.slots[0]).toEqual({ A: undefined, B: 0 });
    expect(result.slots[1]).toEqual({ A: 0, B: 1 });
  });
});
