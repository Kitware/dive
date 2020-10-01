/// <reference types="jest" />
import { updateSubset } from './utils';

describe('updateSubset', () => {
  it('should return null for identical sets', () => {
    const oldsuper = [2, 3, 10];
    const newsuper = [3, 10, 2];
    const sub = [NaN];
    expect(updateSubset(oldsuper, newsuper, sub)).toBeNull();
  });

  it('should properly add/remove items from superset', () => {
    const oldsuper = [0, 1, 2, 3];
    const newsuper = [0, 1, 2, 4];
    const sub = [1, 2, 3];
    expect(updateSubset(oldsuper, newsuper, sub)).toEqual([1, 2, 4]);
  });

  it('should ignore duplicate values', () => {
    const oldsuper = [0, 1, 2, 1, 2, 3, 10, 20];
    const newsuper = [0, 1, 1, 2, 4, 3, 3, 4];
    const sub = [1];
    expect(updateSubset(oldsuper, newsuper, sub)).toEqual([1, 4]);
  });

  it('should not care if the sub-array has values outside the superset', () => {
    const oldsuper = [1, 3, 4];
    const newsuper = [2, 3, 4];
    const sub = [100, 10000, 1];
    expect(updateSubset(oldsuper, newsuper, sub)).toEqual([100, 10000, 2]);
  });
});
