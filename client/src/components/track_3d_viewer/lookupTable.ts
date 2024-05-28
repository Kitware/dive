/* eslint-disable import/prefer-default-export */
/* eslint-disable no-console */
/* eslint-disable no-plusplus */
/* eslint-disable @typescript-eslint/ban-ts-ignore */

import vtkLookupTable from '@kitware/vtk.js/Common/Core/LookupTable';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import { float2rgb } from './utils';

export type RGBColor = [number, number, number];

export function buildLookupTable(color: RGBColor, currentFrame: number, frameCount = 10) {
  // if outside of range, opacity = 0
  const lookupTable = vtkLookupTable.newInstance();


  lookupTable.setUseBelowRangeColor(true);
  // @ts-ignore
  lookupTable.setBelowRangeColor(...color, 0);
  lookupTable.setUseAboveRangeColor(true);
  // @ts-ignore
  lookupTable.setAboveRangeColor(...color, 0);

  const size = Math.min(currentFrame + 1, frameCount);

  const range = {
    min: currentFrame - size + 1,
    max: currentFrame,
  };

  const dataArray = vtkDataArray.newInstance({
    numberOfComponents: 4,
    size: 4 * size,
    dataType: 'Uint8Array',
  });

  // if range.min === range.max there is some weird things happening
  // in the mapper during texture map generation. adding 0.01 is a hack to prevent this.
  lookupTable.setRange(range.min, range.max + 0.01);

  let alpha = 255;
  for (let i = size - 1; i >= 0; i--) {
    const tuple = [...float2rgb(color), alpha];
    dataArray.setTuple(i, tuple);
    alpha -= 20;
  }
  lookupTable.setTable(dataArray);

  return lookupTable;
}
