/// <reference types="vitest" />
import fs from 'fs-extra';
import { cloneDeep } from 'lodash';
import { parseFrameTimestamp, strNumericCompare } from './sharedUtils';

/** Matches tests in python utilities */
const testTuple: string[][][] = fs.readJSONSync('../testutils/imagesort.spec.json');

describe('sharedUtils', () => {
  it('sorts based on numeric extracted values', () => {
    testTuple.forEach(([input, expected]) => {
      const copy = cloneDeep(input);
      expect(input.sort(strNumericCompare)).toEqual(expected);
      expect(input.sort(strNumericCompare)).not.toEqual(copy);
    });
  });

  describe('parseFrameTimestamp', () => {
    it('parses a YYYYMMDD_HHMMSS datestamp', () => {
      expect(parseFrameTimestamp('left_20230615_143022.png')).toBe(1686839422);
    });

    it('parses a datestamp with a fractional-second suffix', () => {
      expect(parseFrameTimestamp('left_20230615_143022.500.png')).toBe(1686839422.5);
    });

    it('parses a bare epoch-milliseconds filename', () => {
      expect(parseFrameTimestamp('img_1719843225123.tif')).toBeCloseTo(1719843225.123, 6);
    });

    it('parses a bare epoch-seconds filename', () => {
      expect(parseFrameTimestamp('img_1719843225.tif')).toBe(1719843225);
    });

    it('returns undefined for a plain sequential filename', () => {
      expect(parseFrameTimestamp('img_00001.png')).toBeUndefined();
    });

    it('returns undefined for a short frame-counter filename', () => {
      expect(parseFrameTimestamp('frame042.tif')).toBeUndefined();
    });

    it('returns undefined for an implausible-range digit run', () => {
      expect(parseFrameTimestamp('img_0000000001.png')).toBeUndefined();
    });

    it('is extension-agnostic (same stem, different extension)', () => {
      expect(parseFrameTimestamp('left_20230615_143022.tif'))
        .toBe(parseFrameTimestamp('left_20230615_143022.png'));
    });
  });
});
