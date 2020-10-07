/// <reference types="jest" />
import { updateSubset, reOrdergeoJSON, reOrderBounds } from './utils';

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
  it('should reorder rect bounds to the same default orientation', () => {
    // Data should be formatted: xmin, ymin, xmax, ymax
    const rectBounds = [0, 5, 20, 30];
    expect(reOrderBounds([20, 30, 0, 5])).toEqual(rectBounds);
    expect(reOrderBounds([0, 30, 20, 5])).toEqual(rectBounds);
    expect(reOrderBounds([0, 5, 20, 30])).toEqual(rectBounds);
  });
  it('should reorder geoJSON rectangle no matter the order of the vertices', () => {
    const ll = [0, 0];
    const ul = [0, 5];
    const ur = [10, 5];
    const lr = [10, 0];
    //GeoJSON expects data like UL, LL, LR, UR, UL
    const rectBounds = [ul, ll, lr, ur, ul];
    expect(reOrdergeoJSON([ll, ul, ur, lr, ll])).toEqual(rectBounds);
    expect(reOrdergeoJSON([ul, ll, lr, ur, ul])).toEqual(rectBounds);
    expect(reOrdergeoJSON([ur, lr, ll, ul, ll])).toEqual(rectBounds);
    expect(reOrdergeoJSON([ll, ul, ur, lr, ll])).toEqual(rectBounds);
  });
});
