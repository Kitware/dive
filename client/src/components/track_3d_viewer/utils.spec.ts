import { smoothBounds } from './utils';

describe('smoothBounds', () => {
  it('centers a cube of the largest extent on each axis', () => {
    expect(smoothBounds([-400, 600, 0, 200, 1500, 3500]))
      .toEqual([-900, 1100, -900, 1100, 1500, 3500]);
  });

  it('falls back to a unit cube when nothing is visible', () => {
    expect(smoothBounds([1, -1, 1, -1, 1, -1])).toEqual([-1, 1, -1, 1, -1, 1]);
  });
});
