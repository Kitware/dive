/* eslint-disable import/prefer-default-export */
import vtkAxesActor from '@kitware/vtk.js/Rendering/Core/AxesActor';
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

export function useOrientationMarkerWidget() {
  const previousVisibility = ref(false);

  const widgetManager = vtkWidgetManager.newInstance();
  const axes = vtkAxesActor.newInstance();
  const orientationMarkerWidget = vtkOrientationMarkerWidget.newInstance({
    actor: axes,
  });

  const interactiveOrientationWidget = vtkInteractiveOrientationWidget.newInstance();

  const enable = function enable(
    interactor: vtkRenderWindowInteractor,
    camera: vtkCamera,
    onOrientationChanged: () => void,
  ) {
    orientationMarkerWidget.setInteractor(interactor);
    orientationMarkerWidget.setEnabled(true);
    orientationMarkerWidget.setViewportCorner(vtkOrientationMarkerWidget.Corners.BOTTOM_LEFT);
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
