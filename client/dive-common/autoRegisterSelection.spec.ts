import { describe, expect, it } from 'vitest';

import proposeRegistrationFrames from './autoRegisterSelection';

describe('proposeRegistrationFrames', () => {
  it('spreads frames evenly across the whole dataset', () => {
    const frames = proposeRegistrationFrames({ counts: [1200, 1200], count: 12 });
    expect(frames).toEqual([50, 150, 250, 350, 450, 550, 650, 750, 850, 950, 1050, 1150]);
  });

  it('spans only the shortest camera', () => {
    const frames = proposeRegistrationFrames({ counts: [1000, 300], count: 10 });
    expect(Math.max(...frames)).toBeLessThan(300);
    expect(frames.length).toBe(10);
  });

  it('spreads rather than clustering when every frame is perfectly synced', () => {
    const base = 1_700_000_000;
    const stamps = Array.from({ length: 1200 }, (_, i) => base + i);
    const frames = proposeRegistrationFrames({
      counts: [1200, 1200],
      timestamps: [stamps, [...stamps]],
      count: 12,
    });
    expect(frames).toEqual([50, 150, 250, 350, 450, 550, 650, 750, 850, 950, 1050, 1150]);
  });

  it('excludes frames whose skew exceeds the threshold and spreads over the rest', () => {
    const base = 1_700_000_000;
    const camA = Array.from({ length: 10 }, (_, i) => base + i);
    const camB = camA.map((t, i) => (i < 5 ? t + 5 : t));
    const frames = proposeRegistrationFrames({
      counts: [10, 10],
      timestamps: [camA, camB],
      count: 5,
      maxSkewSeconds: 0.5,
    });
    expect(frames).toEqual([5, 6, 7, 8, 9]);
  });

  it('returns nothing when every frame is out of sync', () => {
    const base = 1_700_000_000;
    const camA = Array.from({ length: 4 }, (_, i) => base + i);
    const camB = camA.map((t) => t + 10);
    expect(proposeRegistrationFrames({
      counts: [4, 4], timestamps: [camA, camB], count: 2, maxSkewSeconds: 0.5,
    })).toEqual([]);
  });

  it('keeps frames whose skew is unknowable', () => {
    const frames = proposeRegistrationFrames({
      counts: [100, 100],
      timestamps: [
        Array.from({ length: 100 }, () => undefined),
        Array.from({ length: 100 }, () => undefined),
      ],
      count: 4,
    });
    expect(frames).toEqual([12, 37, 62, 87]);
  });

  it('handles degenerate inputs', () => {
    expect(proposeRegistrationFrames({ counts: [0, 10], count: 5 })).toEqual([]);
    expect(proposeRegistrationFrames({ counts: [], count: 5 })).toEqual([]);
    expect(proposeRegistrationFrames({ counts: [10, 10], count: 0 })).toEqual([]);
    expect(proposeRegistrationFrames({ counts: [3, 3], count: 12 })).toEqual([0, 1, 2]);
  });
});
