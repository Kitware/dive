/* eslint-disable import/prefer-default-export */
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkAppendPolyData from '@kitware/vtk.js/Filters/General/AppendPolyData';
import vtkArrowSource from '@kitware/vtk.js/Filters/Sources/ArrowSource';
import type vtkAxesActor from '@kitware/vtk.js/Rendering/Core/AxesActor';
import vtkCylinderSource from '@kitware/vtk.js/Filters/Sources/CylinderSource';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkCamera from '@kitware/vtk.js/Rendering/Core/Camera';
import vtkInteractiveOrientationWidget from '@kitware/vtk.js/Widgets/Widgets3D/InteractiveOrientationWidget';
import vtkOrientationMarkerWidget from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
import vtkWidgetManager from '@kitware/vtk.js/Widgets/Core/WidgetManager';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';
import type { Vector3 } from '@kitware/vtk.js/types';
import { ref } from 'vue';

const getMajorAxisFromViewUp = function getMajorAxisFromViewUp(
  viewUp: Vector3,
  idxA: number,
  idxB: number,
): Vector3 {
  const axis: Vector3 = [0, 0, 0];
  const idx = Math.abs(viewUp[idxA]) > Math.abs(viewUp[idxB]) ? idxA : idxB;
  const value = viewUp[idx] > 0 ? 1 : -1;
  axis[idx] = value;
  return axis;
};

const AXIS_RADIUS = 0.03;

function colored(polyData: vtkPolyData, color: [number, number, number]) {
  const count = polyData.getPoints().getNumberOfPoints();
  const values = new Uint8Array(3 * count);
  for (let i = 0; i < count; i += 1) {
    values.set(color, 3 * i);
  }
  polyData.getPointData().setScalars(vtkDataArray.newInstance({
    name: 'color', numberOfComponents: 3, values,
  }));
  return polyData;
}

/**
 * The three axes as plain bars through the center: which way x and z run says
 * nothing about the scene. Only y carries an arrow, pointing up, because y
 * grows downward in the cameras' frame and "up" is worth marking.
 */
function buildAxes() {
  const bar = (direction: Vector3) => vtkCylinderSource.newInstance({
    direction, height: 1, radius: AXIS_RADIUS, resolution: 60,
  }).getOutputData();
  const up = vtkArrowSource.newInstance({
    direction: [0, -1, 0],
    tipResolution: 60,
    tipRadius: 0.1,
    tipLength: 0.2,
    shaftResolution: 60,
    shaftRadius: AXIS_RADIUS,
  }).getOutputData();
  // The tip makes the arrow lopsided; center its length on the origin so the
  // three axes cross in the middle
  const points = up.getPoints().getData();
  const [, , yMin, yMax] = up.getPoints().getBounds();
  for (let i = 1; i < points.length; i += 3) {
    points[i] -= (yMin + yMax) / 2;
  }

  const source = vtkAppendPolyData.newInstance();
  source.setInputData(colored(bar([1, 0, 0]), [255, 0, 0]));
  source.addInputData(colored(up, [255, 255, 0]));
  source.addInputData(colored(bar([0, 0, 1]), [0, 128, 0]));
  const mapper = vtkMapper.newInstance();
  mapper.setInputConnection(source.getOutputPort());
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  return actor;
}

export function useOrientationMarkerWidget() {
  const previousVisibility = ref(false);

  const widgetManager = vtkWidgetManager.newInstance();
  const axes = buildAxes();
  const orientationMarkerWidget = vtkOrientationMarkerWidget.newInstance({
    // The widget only needs something to draw; its typings name two actors
    actor: axes as unknown as vtkAxesActor,
  });

  const interactiveOrientationWidget = vtkInteractiveOrientationWidget.newInstance();

  const enable = function enable(
    interactor: vtkRenderWindowInteractor,
    camera: vtkCamera,
    onOrientationChanged: () => void,
  ) {
    orientationMarkerWidget.setInteractor(interactor);
    orientationMarkerWidget.setEnabled(true);
    // Clear of the axes, which meet at the bottom left of the opening view
    orientationMarkerWidget.setViewportCorner(vtkOrientationMarkerWidget.Corners.TOP_LEFT);
    orientationMarkerWidget.setViewportSize(0.15);
    orientationMarkerWidget.setMinPixelSize(100);
    orientationMarkerWidget.setMaxPixelSize(300);

    const widgetRenderer = orientationMarkerWidget.getRenderer();
    widgetManager.setRenderer(widgetRenderer);

    interactiveOrientationWidget.placeWidget(axes.getBounds());
    interactiveOrientationWidget.setBounds(axes.getBounds());
    interactiveOrientationWidget.setPlaceFactor(1);

    const viewWidget = widgetManager.addWidget(interactiveOrientationWidget);

    if (!viewWidget) {
      throw new Error('Failed to add widget to view.');
    }

    // @ts-expect-error it exists
    viewWidget.onOrientationChange(({ direction }) => {
      const focalPoint = camera.getFocalPoint();
      const position = camera.getPosition();
      const viewUp = camera.getViewUp();

      const distance = Math.sqrt(vtkMath.distance2BetweenPoints(position, focalPoint));

      // Put the camera orthogonally compared with the clicked cube's face
      camera.setPosition(
        focalPoint[0] + direction[0] * distance,
        focalPoint[1] + direction[1] * distance,
        focalPoint[2] + direction[2] * distance,
      );

      // Set the viewup on the camera so the cube appears aligned with the ground
      if (direction[0]) {
        camera.setViewUp(getMajorAxisFromViewUp(viewUp, 1, 2));
      }
      if (direction[1]) {
        camera.setViewUp(getMajorAxisFromViewUp(viewUp, 0, 2));
      }
      if (direction[2]) {
        camera.setViewUp(getMajorAxisFromViewUp(viewUp, 0, 1));
      }

      orientationMarkerWidget.updateMarkerOrientation();
      widgetManager.enablePicking();
      onOrientationChanged();
    });

    previousVisibility.value = true;
  };

  const disable = function disable() {
    orientationMarkerWidget.delete();
    widgetManager.removeWidget(interactiveOrientationWidget);
    widgetManager.delete();
    axes.delete();
  };

  return {
    enable,
    disable,
  };
}
