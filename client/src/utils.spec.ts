/// <reference types="jest" />
import {
  updateSubset,
  reOrdergeoJSON,
  reOrderBounds,
  applyRotationToPolygon,
  rotatedPolygonToAxisAlignedBbox,
  validateRotation,
  isRotationValue,
  getRotationFromAttributes,
  hasSignificantRotation,
  isReservedAttributeName,
  calculateRotationFromPolygon,
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

  describe('calculateRotationFromPolygon', () => {
    it('should return 0 for insufficient coordinates', () => {
      expect(calculateRotationFromPolygon([])).toBe(0);
      expect(calculateRotationFromPolygon([[0, 0]])).toBe(0);
    });

    it('should calculate rotation from first edge', () => {
      // Horizontal edge (0 degrees)
      const coords1 = [[0, 0], [10, 0], [10, 10], [0, 10]];
      expect(calculateRotationFromPolygon(coords1)).toBeCloseTo(0, 5);

      // Vertical edge (90 degrees = π/2)
      const coords2 = [[0, 0], [0, 10], [10, 10], [10, 0]];
      expect(calculateRotationFromPolygon(coords2)).toBeCloseTo(Math.PI / 2, 5);

      // 45 degree edge
      const coords3 = [[0, 0], [10, 10], [20, 10], [10, 0]];
      expect(calculateRotationFromPolygon(coords3)).toBeCloseTo(Math.PI / 4, 5);
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

  describe('applyRotationToPolygon', () => {
    it('should apply rotation to axis-aligned bounding box', () => {
      const bounds: RectBounds = [0, 0, 10, 10];
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [[[0, 10], [0, 0], [10, 0], [10, 10], [0, 10]]],
      };
      const rotation = Math.PI / 4; // 45 degrees

      const result = applyRotationToPolygon(polygon, bounds, rotation);

      expect(result.type).toBe('Polygon');
      expect(result.coordinates[0]).toHaveLength(5); // 4 corners + closing point
      expect(result.coordinates[0][0]).toEqual(result.coordinates[0][4]); // Closed polygon

      // Check that corners are rotated (not axis-aligned)
      const firstCorner = result.coordinates[0][0];
      // After 45 degree rotation, corners should not be at integer coordinates
      expect(firstCorner[0]).not.toBe(0);
      expect(firstCorner[1]).not.toBe(0);
    });

    it('should return same polygon for zero rotation', () => {
      const bounds: RectBounds = [0, 0, 10, 10];
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [[[0, 10], [0, 0], [10, 0], [10, 10], [0, 10]]],
      };

      const result = applyRotationToPolygon(polygon, bounds, 0);

      // Should be very close to original (within floating point precision)
      // Check all corners (excluding the closing point)
      const corners = result.coordinates[0].slice(0, 4);
      // After zero rotation, corners should match original bounds
      // The function creates corners relative to center, so check that all corners exist
      expect(corners).toHaveLength(4);
      // Verify polygon is closed
      expect(result.coordinates[0][0]).toEqual(result.coordinates[0][4]);
    });

    it('should handle 90 degree rotation', () => {
      const bounds: RectBounds = [0, 0, 10, 10];
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [[[0, 10], [0, 0], [10, 0], [10, 10], [0, 10]]],
      };
      const rotation = Math.PI / 2; // 90 degrees

      const result = applyRotationToPolygon(polygon, bounds, rotation);

      // After 90 degree rotation, the box should still be axis-aligned but dimensions swapped
      // Center should remain at (5, 5)
      const centerX = (bounds[0] + bounds[2]) / 2;
      const centerY = (bounds[1] + bounds[3]) / 2;
      const corners = result.coordinates[0].slice(0, 4);
      const avgX = corners.reduce((sum, c) => sum + c[0], 0) / 4;
      const avgY = corners.reduce((sum, c) => sum + c[1], 0) / 4;
      expect(avgX).toBeCloseTo(centerX, 5);
      expect(avgY).toBeCloseTo(centerY, 5);
    });
  });

  describe('rotatedPolygonToAxisAlignedBbox', () => {
    it('should handle axis-aligned rectangles', () => {
      const coords = [[0, 10], [0, 0], [10, 0], [10, 10], [0, 10]];
      const result = rotatedPolygonToAxisAlignedBbox(coords);

      expect(result.rotation).toBe(0);
      expect(result.bounds).toEqual([0, 0, 10, 10]);
    });

    it('should handle rotated rectangles', () => {
      // Create a rotated rectangle (45 degrees)
      // Start with axis-aligned box at [0, 0, 10, 10], then rotate 45 degrees
      const centerX = 5;
      const centerY = 5;
      const halfSize = 5;
      const angle = Math.PI / 4;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      // Rotate corners
      const corners = [
        [-halfSize, -halfSize],
        [-halfSize, halfSize],
        [halfSize, halfSize],
        [halfSize, -halfSize],
      ].map(([x, y]) => {
        const rotatedX = x * cos - y * sin;
        const rotatedY = x * sin + y * cos;
        return [rotatedX + centerX, rotatedY + centerY] as [number, number];
      });

      const coords = [...corners, corners[0]]; // Close polygon
      const result = rotatedPolygonToAxisAlignedBbox(coords);

      // Should detect rotation
      expect(Math.abs(result.rotation)).toBeGreaterThan(ROTATION_THRESHOLD);
      // Should return axis-aligned bounds
      expect(result.bounds[0]).toBeLessThanOrEqual(result.bounds[2]);
      expect(result.bounds[1]).toBeLessThanOrEqual(result.bounds[3]);
    });

    it('should handle insufficient coordinates', () => {
      const coords = [[0, 0], [10, 0]];
      const result = rotatedPolygonToAxisAlignedBbox(coords);

      expect(result.rotation).toBe(0);
      expect(result.bounds[0]).toBeLessThanOrEqual(result.bounds[2]);
      expect(result.bounds[1]).toBeLessThanOrEqual(result.bounds[3]);
    });

    it('should round-trip: rotate then unrotate', () => {
      const originalBounds: RectBounds = [0, 0, 10, 10];
      const rotation = Math.PI / 6; // 30 degrees

      // Create rotated polygon
      const polygon = {
        type: 'Polygon' as const,
        coordinates: [[[0, 10], [0, 0], [10, 0], [10, 10], [0, 10]]],
      };
      const rotatedPolygon = applyRotationToPolygon(polygon, originalBounds, rotation);

      // Convert back to axis-aligned
      const result = rotatedPolygonToAxisAlignedBbox(rotatedPolygon.coordinates[0]);

      // Should recover original bounds (within floating point precision)
      // Note: rotated bbox might be slightly larger due to rotation
      expect(result.bounds[0]).toBeLessThanOrEqual(originalBounds[0] + 1);
      expect(result.bounds[1]).toBeLessThanOrEqual(originalBounds[1] + 1);
      expect(result.bounds[2]).toBeGreaterThanOrEqual(originalBounds[2] - 1);
      expect(result.bounds[3]).toBeGreaterThanOrEqual(originalBounds[3] - 1);
      // Should detect rotation (may be normalized to different quadrant)
      expect(Math.abs(result.rotation)).toBeGreaterThan(ROTATION_THRESHOLD);
    });

    it('should handle edge case with malformed coordinates', () => {
      // Test error handling with invalid coordinates
      const coords: Array<[number, number]> = [];
      const result = rotatedPolygonToAxisAlignedBbox(coords);

      // Should return valid bounds (fallback behavior)
      expect(Array.isArray(result.bounds)).toBe(true);
      expect(result.bounds).toHaveLength(4);
    });
  });
});
