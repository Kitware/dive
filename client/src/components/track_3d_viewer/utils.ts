/* eslint-disable import/prefer-default-export */

import { Bounds, RGBColor } from '@kitware/vtk.js/types';

export function float2rgb(color: RGBColor): RGBColor {
  return [color[0] * 255, color[1] * 255, color[2] * 255];
}

export function smoothBounds(bounds: Bounds): Bounds {
  const [xmin, xmax, ymin, ymax, zmin, zmax] = bounds;

  const min = Math.min(xmin, ymin, zmin);
  const max = Math.max(xmax, ymax, zmax);

  return [
    min, max,
    min, max,
    min, max,
  ];
}
