import { Bounds, RGBColor } from '@kitware/vtk.js/types';

export const noOp = () => undefined;

export function float2rgb(color: RGBColor): RGBColor {
  return [color[0] * 255, color[1] * 255, color[2] * 255];
}

/**
 * A cube around the data: every axis spans the largest extent, centered on its
 * own range, so positions far from the origin still fill the view.
 */
export function smoothBounds(bounds: Bounds): Bounds {
  const [xmin, xmax, ymin, ymax, zmin, zmax] = bounds;
  const half = Math.max(xmax - xmin, ymax - ymin, zmax - zmin) / 2;
  if (!(half > 0)) {
    return [-1, 1, -1, 1, -1, 1];
  }
  const [x, y, z] = [(xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2];
  return [
    x - half, x + half,
    y - half, y + half,
    z - half, z + half,
  ];
}
