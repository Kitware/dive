import { Ref } from 'vue';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import { Bounds3, Vec3 } from './positions';
import {
  depthGrid, rigBaseline, rigCameras, RigCalibration,
} from './sceneGuides';

export interface GuideLabel {
  position: Vec3;
  text: string;
  color: string;
}

type Segment = [Vec3, Vec3];

const GRID_COLOR: Vec3 = [0.3, 0.3, 0.3];
const RIG_COLOR: Vec3 = [1, 1, 1];
// The orientation cube's colors, so the two read as the same axes
const AXIS_COLORS: Record<'x' | 'y' | 'z', Vec3> = {
  x: [1, 0.25, 0.25],
  y: [1, 0.9, 0.2],
  z: [0.3, 0.85, 0.35],
};
const OPTICAL_AXIS_COLOR: Vec3 = [0.15, 0.4, 0.18];
const css = (color: Vec3) => `rgb(${color.map((value) => Math.round(255 * value)).join(',')})`;
// Shown before any position exists, in units of the rig's baseline.
const EMPTY_SCENE_DEPTHS = 10;

function lineActor(segments: Segment[], color: Vec3, width: number) {
  const points = vtkPoints.newInstance();
  points.setNumberOfPoints(segments.length * 2);
  const cells = new Uint32Array(segments.length * 3);
  segments.forEach(([from, to], i) => {
    points.setPoint(2 * i, ...from);
    points.setPoint(2 * i + 1, ...to);
    cells.set([2, 2 * i, 2 * i + 1], 3 * i);
  });
  const polyData = vtkPolyData.newInstance();
  polyData.setPoints(points);
  polyData.setLines(vtkCellArray.newInstance({ values: cells }));
  const mapper = vtkMapper.newInstance();
  mapper.setInputData(polyData);
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setColor(...color);
  actor.getProperty().setLineWidth(width);
  actor.getProperty().setLighting(false);
  return actor;
}

/** Draws the stereo rig, a grid at camera height and the axes, and lists their labels. */
export default function useSceneGuides(renderer: Ref<vtkRenderer | undefined>) {
  let actors: vtkActor[] = [];
  let labels: GuideLabel[] = [];
  let extent: Bounds3 = [-1, 1, -1, 1, 0, 1];

  const clear = function clear() {
    actors.forEach((actor) => {
      renderer.value?.removeActor(actor);
      actor.delete();
    });
    actors = [];
    labels = [];
  };

  const build = function build(sceneBounds: Bounds3 | null, calibration: RigCalibration | null) {
    clear();
    const baseline = rigBaseline(calibration) || 1;
    const bounds: Bounds3 = sceneBounds ?? [
      -baseline, baseline, -baseline, baseline, 0, EMPTY_SCENE_DEPTHS * baseline,
    ];
    const size = Math.max(bounds[1] - bounds[0], bounds[3] - bounds[2], bounds[5] - bounds[4]);
    const cameras = rigCameras(calibration, Math.max(0.6 * baseline, 0.04 * size));
    const rigPoints = cameras.flatMap(({ center, corners }) => [center, ...corners]);

    const grid = depthGrid(bounds, rigPoints);
    const [xFirst, xLast] = [grid.xs[0], grid.xs[grid.xs.length - 1]];
    const [zFirst, zLast] = [grid.zs[0], grid.zs[grid.zs.length - 1]];
    const [yTop, yBottom] = [grid.ys[0], grid.ys[grid.ys.length - 1]];
    const gridSegments: Segment[] = [
      ...grid.xs.map((x): Segment => [[x, 0, zFirst], [x, 0, zLast]]),
      ...grid.zs.map((z): Segment => [[xFirst, 0, z], [xLast, 0, z]]),
    ];
    // The left camera's optical axis, which lies in the grid
    const opticalAxis: Segment[] = xFirst < 0 && xLast > 0
      ? [[[0, 0, zFirst], [0, 0, zLast]]] : [];
    const rigSegments = cameras.flatMap(({ center, corners }) => corners.flatMap(
      (corner, i): Segment[] => [[center, corner], [corner, corners[(i + 1) % corners.length]]],
    ));
    // The three axes meet at the grid's near left corner, out of the way of the data
    const tick = 0.15 * grid.step;
    const axes: Record<'x' | 'y' | 'z', Segment[]> = {
      x: [[[xFirst, 0, zFirst], [xLast, 0, zFirst]]],
      y: [
        [[xFirst, yBottom, zFirst], [xFirst, yTop, zFirst]],
        ...grid.ys.map((y): Segment => [[xFirst - tick, y, zFirst], [xFirst + tick, y, zFirst]]),
      ],
      z: [[[xFirst, 0, zFirst], [xFirst, 0, zLast]]],
    };

    actors = [
      lineActor(gridSegments, GRID_COLOR, 1),
      lineActor(opticalAxis, OPTICAL_AXIS_COLOR, 2),
      lineActor(rigSegments, RIG_COLOR, 2),
      lineActor(axes.x, AXIS_COLORS.x, 3),
      lineActor(axes.y, AXIS_COLORS.y, 3),
      lineActor(axes.z, AXIS_COLORS.z, 3),
    ];
    actors.forEach((actor) => renderer.value?.addActor(actor));

    // Labels sit just outside the grid so they stay clear of its lines and of each other
    const gap = 0.4 * grid.step;
    const number = (value: number) => value.toLocaleString();
    labels = [
      ...grid.xs.map((x) => ({
        position: [x, 0, zFirst - gap] as Vec3, text: number(x), color: css(AXIS_COLORS.x),
      })),
      { position: [xLast + 2 * gap, 0, zFirst] as Vec3, text: 'X', color: css(AXIS_COLORS.x) },
      ...grid.ys.map((y) => ({
        position: [xFirst - gap, y, zFirst] as Vec3, text: number(y), color: css(AXIS_COLORS.y),
      })),
      {
        position: [xFirst, yTop - gap, zFirst] as Vec3, text: 'Y', color: css(AXIS_COLORS.y),
      },
      ...grid.zs.filter((z) => z !== zFirst).map((z) => ({
        position: [xFirst - gap, 0, z] as Vec3, text: number(z), color: css(AXIS_COLORS.z),
      })),
      {
        position: [xFirst, 0, zLast + 2 * gap] as Vec3,
        text: 'Z (depth)',
        color: css(AXIS_COLORS.z),
      },
      ...cameras.map(({ name, center }) => ({
        position: center,
        text: name.charAt(0).toUpperCase() + name.slice(1),
        color: css(RIG_COLOR),
      })),
    ];

    const ys = [bounds[2], bounds[3], yTop, yBottom, ...rigPoints.map((point) => point[1])];
    // Room for the labels around the grid, and for the rig behind its near edge
    extent = [
      xFirst - 3 * gap, xLast + 3 * gap,
      Math.min(...ys) - gap, Math.max(...ys) + gap,
      Math.min(zFirst - 2 * gap, ...rigPoints.map((point) => point[2])), zLast + 3 * gap,
    ];
  };

  return {
    build,
    clear,
    labels: () => labels,
    /** Everything worth framing: the data, the grid through it and the rig. */
    extent: () => extent,
  };
}
