/// <reference types="jest" />

import { cloneDeep } from 'lodash';
import { strNumericCompare } from './sharedUtils';

/** Matches tests in python utilities */
const test_tuple = [
  [
    [
      'and200__1',
      '1',
      '100',
      '1000',
      '100a',
      '2',
      'first',
      'second',
      '200',
      'and3',
      'b100',
      'and30',
    ],
    [
      'first',
      'second',
      '1',
      '2',
      'and3',
      'and30',
      '100',
      '100a',
      'b100',
      '200',
      '1000',
      'and200__1',
    ],
  ],
  [
    [
      'sc2-camera3_08-03-19_14-15-21.000.avi_400005.png',
      'sc2-camera3_08-03-19_14-15-21.000.avi_400004.png',
      'sc2-camera3_08-03-19_14-15-21.000.avi_400003.png',
      'sc2-camera3_08-03-19_14-15-21.000.avi_400006.png',
    ],
    [
      'sc2-camera3_08-03-19_14-15-21.000.avi_400003.png',
      'sc2-camera3_08-03-19_14-15-21.000.avi_400004.png',
      'sc2-camera3_08-03-19_14-15-21.000.avi_400005.png',
      'sc2-camera3_08-03-19_14-15-21.000.avi_400006.png',
    ],
  ],
];

describe('sharedUtils', () => {
  it('sorts based on numeric extracted values', () => {
    test_tuple.forEach(([input, expected]) => {
      const copy = cloneDeep(input);
      expect(input.sort(strNumericCompare)).toEqual(expected);
      expect(input.sort(strNumericCompare)).not.toEqual(copy);
    });
  });
})
