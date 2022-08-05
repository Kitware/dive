<script lang="ts">
import {
  ref, onMounted, onBeforeUnmount, defineComponent, toRef,
} from '@vue/composition-api';

import '@kitware/vtk.js/Rendering/Profiles/Glyph';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';

import vtkAxesActor from '@kitware/vtk.js/Rendering/Core/AxesActor';
import vtkOrientationMarkerWidget from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore no declaration file
import vtkCubeAxesActor from '@kitware/vtk.js/Rendering/Core/CubeAxesActor';
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import {
  useSelectedTrackId,
} from 'vue-media-annotator/provides';
import { debounce } from '@kitware/vtk.js/macros';
import { RGBColor } from '@kitware/vtk.js/types';
import TrackManager from './TrackManager';
import useTrackDrawer from './useTrackDrawer';
import { injectAggregateController } from '../annotators/useMediaController';
import { Feature, ViewUtils } from './trackUtils';

function setInteractiveMarkerWidget(
  renderWindow: vtkRenderWindow|null,
): vtkOrientationMarkerWidget|null {
  if (!renderWindow) {
    return null;
  }

  const axes = vtkAxesActor.newInstance();
  const orientationWidget = vtkOrientationMarkerWidget.newInstance({
    actor: axes,
    interactor: renderWindow.getInteractor(),
  });
  orientationWidget.setEnabled(true);
  orientationWidget.setViewportCorner(
    vtkOrientationMarkerWidget.Corners.BOTTOM_LEFT,
  );
  orientationWidget.setViewportSize(0.15);
  orientationWidget.setMinPixelSize(100);
  orientationWidget.setMaxPixelSize(300);

  return orientationWidget;
}

export default defineComponent({
  name: 'TrackViewer',

  props: {
    controlsHeight: {
      type: Number,
      required: true,
    },
    onlyShowSelectedTrack: {
      type: Boolean,
      required: true,
    },
  },

  setup(props) {
    const onlyShowSelectedTrack = toRef(props, 'onlyShowSelectedTrack');

    // Initialize the data structure to keep track of every tracks present in the 3d view
    const trackManager = new TrackManager();
    const vtkContainer = ref(null);
    let fullScreenRenderWindow: vtkFullScreenRenderWindow|null = null;
    const rotationMatrixTransform = vtkMatrixBuilder.buildFromDegree().rotateZ(-90);
    let renderer: vtkRenderer|null = null;
    let renderWindow: vtkRenderWindow|null = null;
    let orientationWidget: vtkOrientationMarkerWidget|null = null;

    const drawFeature = function drawFeature(
      sphereSource: vtkSphereSource,
      points: vtkPoints,
      lines: vtkCellArray,
      trackColor: [number, number, number],
      { x, y, z }: { x: number; y: number; z: number},
      idx: number,
    ) {
      points.setPoint(
        idx,
        x,
        y,
        z,
      );

      if (idx > 0) {
        // eslint-disable-next-line no-param-reassign
        lines.getData()[idx] = idx - 1;
        // eslint-disable-next-line no-param-reassign
        lines.getData()[idx + 1] = idx;
      }

      const pointMapper = vtkMapper.newInstance();
      pointMapper.setInputConnection(sphereSource.getOutputPort());

      const pointActor = vtkActor.newInstance();

      pointActor.setUserMatrix(rotationMatrixTransform.getMatrix());
      pointActor.setPosition(x, y, z);
      pointActor.setMapper(pointMapper);
      pointActor.getProperty().setColor(...trackColor);
      pointActor.setVisibility(false);

      if (renderer) {
        renderer.addActor(pointActor);
      }

      return pointActor;
    };
    const viewUtils: ViewUtils = {
      rerender: () => undefined,
      createTrackActors(trackColor: RGBColor, features: Array<Feature>) {
        const numberOfFeatures = features.length;

        // One point stands for one detection
        const points = vtkPoints.newInstance();
        const pd = vtkPolyData.newInstance();

        const mapper = vtkMapper.newInstance();
        const trackActor = vtkActor.newInstance();
        const trackActorProperty = trackActor.getProperty();
        points.setNumberOfPoints(numberOfFeatures);

        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore bad typing rules
        const lines = vtkCellArray.newInstance({ size: numberOfFeatures + 1 });
        lines.getData()[0] = numberOfFeatures;

        // We uses a sphere to represents a detection in space
        const sphereSource = vtkSphereSource.newInstance();
        sphereSource.setRadius(0.003);
        sphereSource.setThetaResolution(20);

        const frameDetections: [number, vtkActor][] = features
          .map((feature, idx) => {
            const featureActor = drawFeature(sphereSource, points, lines, trackColor, feature, idx);
            return [feature.frameNumber, featureActor];
          });

        pd.setPoints(points);

        mapper.setInputData(pd);
        rotationMatrixTransform.apply(points.getData());
        pd.setLines(lines);

        trackActorProperty.setColor(...trackColor);
        trackActorProperty.setLineWidth(3);
        trackActor.setMapper(mapper);

        if (renderer) {
          renderer.addActor(trackActor);
        }

        return {
          trackActor,
          frameDetections,
        };
      },
    };

    const {
      onSelectedTrackChange,
      onFrameChange,
      initializeTracks,
    } = useTrackDrawer(trackManager, onlyShowSelectedTrack, viewUtils);

    const mediaController = injectAggregateController();

    const selectedTrackIdRef = useSelectedTrackId();
    const { frame } = mediaController.value;

    onMounted(() => {
      if (fullScreenRenderWindow) {
        return;
      }

      fullScreenRenderWindow = vtkFullScreenRenderWindow.newInstance({
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore rootContainer is not declared but exists
        rootContainer: vtkContainer.value,
        background: [0, 0, 0],
      });

      renderer = fullScreenRenderWindow.getRenderer();
      const camera = renderer.getActiveCamera();

      // trying to turn off shadows
      renderer.getLights()[0].setShadowAttenuation(0);
      renderWindow = renderer.getRenderWindow();
      const cubeAxes = vtkCubeAxesActor.newInstance();
      cubeAxes.setCamera(camera);

      viewUtils.rerender = debounce(() => {
        if (!renderWindow || !renderer) {
          throw new Error('Render window or renderer does not exists.');
        }
        renderer.removeActor(cubeAxes);
        const bounds = renderer.computeVisiblePropBounds();
        cubeAxes.setDataBounds(bounds);
        renderer.addActor(cubeAxes);
        renderWindow.render();
      }, 10);

      orientationWidget = setInteractiveMarkerWidget(renderWindow);
      initializeTracks();

      const bounds = renderer.computeVisiblePropBounds();
      cubeAxes.setDataBounds(bounds);
      renderer.addActor(cubeAxes);

      onFrameChange(frame.value, undefined);
      onSelectedTrackChange(selectedTrackIdRef.value, undefined);
    });

    onBeforeUnmount(() => {
      if (fullScreenRenderWindow) fullScreenRenderWindow.delete();
      if (orientationWidget) orientationWidget.delete();
      fullScreenRenderWindow = null;
      orientationWidget = null;
    });

    return {
      vtkContainer,
    };
  },
});
</script>

<template>
  <div
    ref="vtkContainer"
    class="vtk-container"
    :style="`--controls-height: ${controlsHeight}px`"
  />
</template>

<style>
.vtk-container div {
  max-height: calc(100% - var(--controls-height));
}
</style>
