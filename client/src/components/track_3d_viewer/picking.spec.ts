import { ballAt } from './picking';

describe('ballAt', () => {
  const balls = [
    { id: 7, center: [100, 100] as [number, number], radius: 20 },
    { id: 0, center: [130, 100] as [number, number], radius: 20 },
    { id: 3, center: [300, 300] as [number, number], radius: 2 },
  ];

  it('picks the ball under the point, the nearest center where they overlap', () => {
    expect(ballAt(balls, [95, 100], 6)).toBe(7);
    expect(ballAt(balls, [118, 100], 6)).toBe(0);
  });

  it('gives small balls a minimum size to hit', () => {
    expect(ballAt(balls, [305, 300], 6)).toBe(3);
    expect(ballAt(balls, [308, 300], 6)).toBeNull();
  });

  it('ignores points outside every ball', () => {
    expect(ballAt(balls, [100, 125], 6)).toBeNull();
    expect(ballAt([], [0, 0], 6)).toBeNull();
  });
});
