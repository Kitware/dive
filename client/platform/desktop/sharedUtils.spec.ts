/// <reference types="jest" />
import fs from 'fs-extra';
import { cloneDeep } from 'lodash';
import { strNumericCompare } from './sharedUtils';

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
});
