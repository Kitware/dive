/* eslint-disable import/prefer-default-export */
/* eslint-disable @typescript-eslint/ban-ts-ignore */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import { Ref } from '@vue/composition-api';

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
  const drawLabels = function drawLabels(positionToLabel: Map<[number, number, number], string>) {
    if (!labelTextContext) {
      throw new Error('Please initialize the drawer first.');
    }

    clearLabelContext();


    positionToLabel.forEach((label, position) => {
      const displayCoordinates = openglRenderWindow.value!.worldToDisplay(
        ...position,
        // @ts-ignore
        renderer.value,
      );
      labelTextContext!.font = 'bold 14px serif';
      labelTextContext!.textAlign = 'center';
      labelTextContext!.textBaseline = 'middle';

      labelTextContext!.fillText(
        label,
        displayCoordinates[0],
        viewportDimensions.value.height - displayCoordinates[1],
      );
    });
  };


  return {
    initialize,
    drawLabels,
    clearLabelContext,
  };
}
