import { describe, expect, it } from 'vitest';

import proposeRegistrationFrames from './autoRegisterSelection';

describe('proposeRegistrationFrames', () => {
  it('spreads candidates across every temporal bin (no single-scene bias)', () => {
    const frames = proposeRegistrationFrames({
      counts: [1200, 1200],
      bins: 12,
      perBin: 2,
    });
    expect(frames.length).toBe(24);
    // Every 100-frame bin contributes exactly its share: a scene-rich
    // stretch can never supply all the candidates.
    for (let bin = 0; bin < 12; bin += 1) {
      const inBin = frames.filter((f) => f >= bin * 100 && f < (bin + 1) * 100);
      expect(inBin.length).toBe(2);
    }
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
  });

  it('spans only the shortest camera', () => {
    const frames = proposeRegistrationFrames({
      counts: [1000, 300],
      bins: 10,
      perBin: 1,
    });
    expect(Math.max(...frames)).toBeLessThan(300);
    expect(frames.length).toBe(10);
  });

  it('ranks within a bin by inter-camera timestamp skew', () => {
    // Two cameras, 10 frames, one bin: frame 6 is perfectly synced, frame 3
    // is close, everything else is badly skewed.
    const base = 1_700_000_000;
    const camA = Array.from({ length: 10 }, (_, i) => base + i);
    const camB = camA.map((t, i) => {
      if (i === 6) return t;
      if (i === 3) return t + 0.1;
      return t + 5;
    });
    const frames = proposeRegistrationFrames({
      counts: [10, 10],
      timestamps: [camA, camB],
      bins: 1,
      perBin: 2,
      maxSkewSeconds: 0.5,
    });
    expect(frames).toEqual([3, 6]);
  });

  it('drops candidates whose skew exceeds the threshold entirely', () => {
    const base = 1_700_000_000;
    const camA = Array.from({ length: 4 }, (_, i) => base + i);
    const camB = camA.map((t) => t + 10); // hopeless sync everywhere
    const frames = proposeRegistrationFrames({
      counts: [4, 4],
      timestamps: [camA, camB],
      bins: 1,
      perBin: 2,
      maxSkewSeconds: 0.5,
    });
    expect(frames).toEqual([]);
  });

  it('falls back to even spread for frames without timestamps', () => {
    const frames = proposeRegistrationFrames({
      counts: [100, 100],
      timestamps: [
        Array.from({ length: 100 }, () => undefined),
        Array.from({ length: 100 }, () => undefined),
      ],
      bins: 2,
      perBin: 2,
    });
    expect(frames.length).toBe(4);
    expect(frames.filter((f) => f < 50).length).toBe(2);
    expect(frames.filter((f) => f >= 50).length).toBe(2);
  });

  it('handles degenerate inputs', () => {
    expect(proposeRegistrationFrames({ counts: [0, 10], bins: 5, perBin: 2 })).toEqual([]);
    expect(proposeRegistrationFrames({ counts: [], bins: 5, perBin: 2 })).toEqual([]);
    // More bins than frames: every frame proposed once.
    const tiny = proposeRegistrationFrames({ counts: [3, 3], bins: 12, perBin: 2 });
    expect(tiny).toEqual([0, 1, 2]);
  });
});
