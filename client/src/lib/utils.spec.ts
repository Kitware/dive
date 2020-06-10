/// <reference types="jest" />
import { updateSubset } from '@/lib/utils';

describe('updateSubset', () => {
  it('should return null for identical sets', () => {
    const oldarr = [2, 3, 10];
    const newarr = [3, 10, 2];
    expect(updateSubset(oldarr, newarr)).toBeNull();
  });

  it('should properly add/remove items from superset', () => {
    const oldarr = [0, 1, 2, 3];
    const newarr = [10];
    expect(updateSubset(oldarr, newarr)).toEqual([10]);
  });
});
