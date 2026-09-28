import { Ref } from 'vue';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import { Bounds3, Vec3 } from './positions';
import {
  floorGrid, rigBaseline, rigCameras, RigCalibration,
} from './sceneGuides';

export interface GuideLabel {
  position: Vec3;
  text: string;
}

type Segment = [Vec3, Vec3];

const GRID_COLOR: Vec3 = [0.3, 0.3, 0.3];
const DEPTH_AXIS_COLOR: Vec3 = [0.3, 0.75, 0.35];
const RIG_COLOR: Vec3 = [1, 1, 1];
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

/** Draws the stereo rig and a floor grid, and lists the labels that go with them. */
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

    const grid = floorGrid(bounds, rigPoints);
    const [xFirst, xLast] = [grid.xs[0], grid.xs[grid.xs.length - 1]];
    const [zFirst, zLast] = [grid.zs[0], grid.zs[grid.zs.length - 1]];
    const gridSegments: Segment[] = [
      ...grid.xs.filter((x) => x !== 0)
        .map((x): Segment => [[x, grid.y, zFirst], [x, grid.y, zLast]]),
      ...grid.zs.map((z): Segment => [[xFirst, grid.y, z], [xLast, grid.y, z]]),
    ];
    // The line under the left camera's optical axis stands out as the depth axis
    const depthAxis: Segment[] = xFirst <= 0 && xLast >= 0
      ? [[[0, grid.y, zFirst], [0, grid.y, zLast]]] : [];
    const rigSegments = cameras.flatMap(({ center, corners }) => corners.flatMap(
      (corner, i): Segment[] => [[center, corner], [corner, corners[(i + 1) % corners.length]]],
    ));

    actors = [
      lineActor(gridSegments, GRID_COLOR, 1),
      lineActor(depthAxis, DEPTH_AXIS_COLOR, 2),
      lineActor(rigSegments, RIG_COLOR, 2),
    ];
    actors.forEach((actor) => renderer.value?.addActor(actor));

    // Labels sit just outside the grid so they stay clear of its lines and of each other
    const gap = 0.4 * grid.step;
    labels = [
      ...grid.zs.filter((z) => z > 0).map((z) => ({
        position: [xFirst - gap, grid.y, z] as Vec3,
        text: z.toLocaleString(),
      })),
      { position: [0, grid.y, zLast + 2 * gap] as Vec3, text: 'Z (depth)' },
      { position: [xLast + gap, grid.y, zFirst] as Vec3, text: 'X' },
      ...cameras.map(({ name, center }) => ({
        position: center,
        text: name.charAt(0).toUpperCase() + name.slice(1),
      })),
    ];

    const ys = [bounds[2], grid.y, ...rigPoints.map((point) => point[1])];
    extent = [xFirst, xLast, Math.min(...ys), Math.max(...ys), zFirst, zLast];
  };

  return {
    build,
    clear,
    labels: () => labels,
    /** Everything worth framing: the data, the grid under it and the rig. */
    extent: () => extent,
  };
}
