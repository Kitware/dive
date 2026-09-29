/* eslint-disable import/prefer-default-export */

import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { Ref } from 'vue';

interface LabelDrawerParams {
  renderer: Ref<vtkRenderer | undefined>;
  viewportDimensions: Ref<{
    width: number;
    height: number;
  }>;
  openglRenderWindow: Ref<vtkOpenGLRenderWindow | undefined>;
}

export function useLabelDrawer({
  renderer,
  viewportDimensions,
  openglRenderWindow,
}: LabelDrawerParams) {
  let labelTextCanvas: HTMLCanvasElement | null = null;
  let labelTextContext: CanvasRenderingContext2D | null = null;

  const initialize = function initialize() {
    labelTextCanvas = document.createElement('canvas');
    labelTextCanvas.style.position = 'absolute';
    labelTextCanvas.style.top = '0';
    labelTextCanvas.style.right = '0';
    labelTextCanvas.style.bottom = '0';
    labelTextCanvas.style.left = '0';
    labelTextContext = labelTextCanvas.getContext('2d');

    return {
      labelTextCanvas,
    };
  };
  const clearLabelContext = function clearLabelContext() {
    if (!labelTextContext) {
      throw new Error('Please initialize the drawer first.');
    }

    labelTextContext.clearRect(
      0,
      0,
      viewportDimensions.value.width,
      viewportDimensions.value.height,
    );
  };
  /** Draws on top of what is already there; callers clear the canvas first. */
  const drawLabels = function drawLabels(
    positionToLabel: Map<[number, number, number], string>,
    { color, font }: { color: string; font: string },
  ) {
    if (!labelTextContext) {
      throw new Error('Please initialize the drawer first.');
    }

    const camera = renderer.value!.getActiveCamera();
    const eye = camera.getPosition();
    const direction = camera.getDirectionOfProjection();

    positionToLabel.forEach((label, position) => {
      // Points behind the viewer would otherwise project mirrored onto the view
      const ahead = position.reduce(
        (sum, value, axis) => sum + (value - eye[axis]) * direction[axis],
        0,
      );
      if (ahead <= 0) {
        return;
      }
      const displayCoordinates = openglRenderWindow.value!.worldToDisplay(
        ...position,
        renderer.value!,
      );
      const x = displayCoordinates[0];
      const y = viewportDimensions.value.height - displayCoordinates[1];
      labelTextContext!.font = font;
      labelTextContext!.textAlign = 'center';
      labelTextContext!.textBaseline = 'middle';
      labelTextContext!.lineWidth = 3;
      labelTextContext!.strokeStyle = 'black';
      labelTextContext!.strokeText(label, x, y);
      labelTextContext!.fillStyle = color;
      labelTextContext!.fillText(label, x, y);
    });
  };

  return {
    initialize,
    drawLabels,
    clearLabelContext,
  };
}
