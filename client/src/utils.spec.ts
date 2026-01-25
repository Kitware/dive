/// <reference types="jest" />
import {
  updateSubset,
  reOrdergeoJSON,
  reOrderBounds,
  validateRotation,
  isRotationValue,
  getRotationFromAttributes,
  hasSignificantRotation,
  isReservedAttributeName,
  isAxisAligned,
  ROTATION_THRESHOLD,
  ROTATION_ATTRIBUTE_NAME,
} from './utils';
import type { RectBounds } from './utils';

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

describe('Rotation utilities', () => {
  describe('validateRotation', () => {
    it('should return undefined for undefined input', () => {
      expect(validateRotation(undefined)).toBeUndefined();
    });

    it('should return undefined for null input', () => {
      expect(validateRotation(null)).toBeUndefined();
    });

    it('should return undefined for NaN', () => {
      expect(validateRotation(NaN)).toBeUndefined();
    });

    it('should return undefined for Infinity', () => {
      expect(validateRotation(Infinity)).toBeUndefined();
      expect(validateRotation(-Infinity)).toBeUndefined();
    });

    it('should normalize large rotation values to [-π, π]', () => {
      expect(validateRotation(3 * Math.PI)).toBeCloseTo(Math.PI, 5);
      expect(validateRotation(-3 * Math.PI)).toBeCloseTo(-Math.PI, 5);
      expect(validateRotation(2 * Math.PI + 0.5)).toBeCloseTo(0.5, 5);
    });

    it('should return undefined for values below threshold', () => {
      expect(validateRotation(0)).toBeUndefined();
      expect(validateRotation(ROTATION_THRESHOLD / 2)).toBeUndefined();
      expect(validateRotation(-ROTATION_THRESHOLD / 2)).toBeUndefined();
    });

    it('should return normalized value for significant rotation', () => {
      expect(validateRotation(Math.PI / 4)).toBeCloseTo(Math.PI / 4, 5);
      expect(validateRotation(-Math.PI / 4)).toBeCloseTo(-Math.PI / 4, 5);
    });
  });

  describe('isRotationValue', () => {
    it('should return true for valid numbers', () => {
      expect(isRotationValue(0)).toBe(true);
      expect(isRotationValue(Math.PI)).toBe(true);
      expect(isRotationValue(-1.5)).toBe(true);
    });

    it('should return false for NaN', () => {
      expect(isRotationValue(NaN)).toBe(false);
    });

    it('should return false for Infinity', () => {
      expect(isRotationValue(Infinity)).toBe(false);
      expect(isRotationValue(-Infinity)).toBe(false);
    });

    it('should return false for non-numbers', () => {
      expect(isRotationValue('0')).toBe(false);
      expect(isRotationValue(null)).toBe(false);
      expect(isRotationValue(undefined)).toBe(false);
      expect(isRotationValue({})).toBe(false);
    });
  });

  describe('getRotationFromAttributes', () => {
    it('should return rotation value when present', () => {
      const attrs = { [ROTATION_ATTRIBUTE_NAME]: Math.PI / 4 };
      expect(getRotationFromAttributes(attrs)).toBeCloseTo(Math.PI / 4, 5);
    });

    it('should return undefined when attributes is undefined', () => {
      expect(getRotationFromAttributes(undefined)).toBeUndefined();
    });

    it('should return undefined when rotation is not present', () => {
      const attrs = { other: 'value' };
      expect(getRotationFromAttributes(attrs)).toBeUndefined();
    });

    it('should return undefined for invalid rotation values', () => {
      const attrs1 = { [ROTATION_ATTRIBUTE_NAME]: NaN };
      const attrs2 = { [ROTATION_ATTRIBUTE_NAME]: Infinity };
      const attrs3 = { [ROTATION_ATTRIBUTE_NAME]: 'not a number' };
      expect(getRotationFromAttributes(attrs1)).toBeUndefined();
      expect(getRotationFromAttributes(attrs2)).toBeUndefined();
      expect(getRotationFromAttributes(attrs3)).toBeUndefined();
    });
  });

  describe('hasSignificantRotation', () => {
    it('should return false for undefined', () => {
      expect(hasSignificantRotation(undefined)).toBe(false);
    });

    it('should return false for null', () => {
      expect(hasSignificantRotation(null)).toBe(false);
    });

    it('should return false for zero', () => {
      expect(hasSignificantRotation(0)).toBe(false);
    });

    it('should return false for values below threshold', () => {
      expect(hasSignificantRotation(ROTATION_THRESHOLD / 2)).toBe(false);
      expect(hasSignificantRotation(-ROTATION_THRESHOLD / 2)).toBe(false);
    });

    it('should return true for values above threshold', () => {
      expect(hasSignificantRotation(ROTATION_THRESHOLD * 2)).toBe(true);
      expect(hasSignificantRotation(-ROTATION_THRESHOLD * 2)).toBe(true);
      expect(hasSignificantRotation(Math.PI / 4)).toBe(true);
    });
  });

  describe('isReservedAttributeName', () => {
    it('should return true for reserved detection attributes', () => {
      expect(isReservedAttributeName('rotation', 'detection')).toBe(true);
      expect(isReservedAttributeName('userModified', 'detection')).toBe(true);
    });

    it('should return false for non-reserved detection attributes', () => {
      expect(isReservedAttributeName('customAttr', 'detection')).toBe(false);
      expect(isReservedAttributeName('userCreated', 'detection')).toBe(false);
    });

    it('should return true for reserved track attributes', () => {
      expect(isReservedAttributeName('userCreated', 'track')).toBe(true);
    });

    it('should return false for non-reserved track attributes', () => {
      expect(isReservedAttributeName('rotation', 'track')).toBe(false);
      expect(isReservedAttributeName('customAttr', 'track')).toBe(false);
    });
  });

  describe('isAxisAligned', () => {
    it('should return true for insufficient coordinates', () => {
      expect(isAxisAligned([])).toBe(true);
      expect(isAxisAligned([[0, 0]])).toBe(true);
      expect(isAxisAligned([[0, 0], [1, 0]])).toBe(true);
    });

    it('should return true for axis-aligned rectangles', () => {
      const coords = [[0, 0], [0, 10], [10, 10], [10, 0]];
      expect(isAxisAligned(coords)).toBe(true);
    });

    it('should return false for rotated rectangles', () => {
      // 45 degree rotation
      const coords = [[0, 0], [5, 5], [10, 0], [5, -5]];
      expect(isAxisAligned(coords)).toBe(false);
    });
  });
});
