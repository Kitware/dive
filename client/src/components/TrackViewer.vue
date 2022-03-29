<script lang="ts">
import {
  ref, onMounted, onBeforeUnmount, defineComponent, watch,
} from '@vue/composition-api';

import '@kitware/vtk.js/Rendering/Profiles/Glyph';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

import vtkFullScreenRenderWindow from '@kitware/vtk.js/Rendering/Misc/FullScreenRenderWindow';

import vtkAxesActor from '@kitware/vtk.js/Rendering/Core/AxesActor';
import vtkOrientationMarkerWidget from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget';
import * as vtkMath from '@kitware/vtk.js/Common/Core/Math';
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import vtkPoints from '@kitware/vtk.js/Common/Core/Points';

import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import {
  Feature,
} from 'vue-media-annotator/track';

import {
  useTrackFilters,
  useSelectedTrackId,
  useTrackStyleManager,
} from 'vue-media-annotator/provides';
import { TrackWithContext } from '../BaseFilterControls';


import { injectAggregateController } from './annotators/useMediaController';

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
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    vtkOrientationMarkerWidget.Corners.BOTTOM_LEFT,
  );
  orientationWidget.setViewportSize(0.15);
  orientationWidget.setMinPixelSize(100);
  orientationWidget.setMaxPixelSize(300);

  // eslint-disable-next-line consistent-return
  return orientationWidget;
}

export default defineComponent({
  name: 'TrackViewer',

  props: {
    controlsHeight: {
      type: Number,
      required: true,
    },
  },

  setup() {
    const vtkContainer = ref(null);
    let fullScreenRenderWindow: vtkFullScreenRenderWindow|null = null;
    let renderer: vtkRenderer|null = null;
    let renderWindow: vtkRenderWindow|null = null;
    let orientationWidget: vtkOrientationMarkerWidget|null = null;

    const mediaController = injectAggregateController();
    const filteredTracksRef = useTrackFilters();
    const typeStylingRef = useTrackStyleManager();
    const selectedTrackIdRef = useSelectedTrackId();
    const { frame } = mediaController.value;
    const sphereActors = new Map<number, Array<vtkActor>>();
    const trackActors = new Map<number, vtkActor>();

    const rotationMatrixTransform = vtkMatrixBuilder.buildFromDegree().rotateZ(-90);

    const onSelectedTrackChangeFn = function onSelectedTrackChange(
      newTrackId: number|null,
      oldTrackId: number|undefined,
    ) {
      if (newTrackId) {
        // eslint-disable-next-line no-unused-expressions
        trackActors.get(newTrackId)?.getProperty().setLineWidth(5);
      }

      if (oldTrackId) {
        // eslint-disable-next-line no-unused-expressions
        trackActors.get(oldTrackId)?.getProperty().setLineWidth(3);
      }
      // eslint-disable-next-line no-unused-expressions
      renderWindow?.render();
    };

    const onFrameChangeFn = function onFrameChange(
      newFrameNumber: number,
      oldFrameNumber?: number,
    ) {
      if (!renderWindow) {
        return;
      }

      // eslint-disable-next-line no-unused-expressions
      sphereActors.get(newFrameNumber)?.forEach((sphereActor) => sphereActor.setVisibility(true));

      if (oldFrameNumber !== undefined) {
        // eslint-disable-next-line no-unused-expressions
        sphereActors
          .get(oldFrameNumber)
          ?.forEach((sphereActor) => sphereActor.setVisibility(false));
        renderWindow.render();
      }
    };

    const registerSphereActorFn = function registerSphereActor(frameId: number, actor: vtkActor) {
      if (sphereActors.has(frameId)) {
          // eslint-disable-next-line no-unused-expressions
          sphereActors.get(frameId)?.push(actor);
          return;
      }
      sphereActors.set(frameId, [actor]);
    };

    const drawFeatureFn = function drawFeature(
      sphereSource: vtkSphereSource,
      points: vtkPoints,
      lines: vtkCellArray,
      trackColor: number[],
      feature: Feature,
      idx: number,
    ) {
      const { attributes } = feature;

      if (!attributes) {
        return;
      }
      const { x, y, z } = attributes as { x: number; y: number; z: number };

      if (x === undefined || y === undefined || z === undefined) {
        return;
      }

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
      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      pointActor.getProperty().setColor(...trackColor);
      pointActor.setVisibility(false);

      registerSphereActorFn(feature.frame, pointActor);
      if (renderer) {
        renderer.addActor(pointActor);
      }
    };

    const drawTrackFn = function drawTrack(trackWithContext: TrackWithContext) {
      const track = trackWithContext.annotation;
      // One point stands for one detection
      const points = vtkPoints.newInstance();
      const pd = vtkPolyData.newInstance();

      // Get the color of the track
      const trackColor = vtkMath.hex2float(
        typeStylingRef.value.color(track.confidencePairs[0][0]),
      );

      const mapper = vtkMapper.newInstance();
      const trackActor = vtkActor.newInstance();
      const trackActorProperty = trackActor.getProperty();
      const numberOfFeatures = track.features.length;
      points.setNumberOfPoints(numberOfFeatures);

      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      const lines = vtkCellArray.newInstance({ size: numberOfFeatures + 1 });
      lines.getData()[0] = numberOfFeatures;

      // We uses a sphere to represents a detection in space
      const sphereSource = vtkSphereSource.newInstance();
      sphereSource.setRadius(0.03);
      sphereSource.setThetaResolution(20);

      track.features
        .filter((feature) => feature !== undefined)
        .forEach(drawFeatureFn.bind(null, sphereSource, points, lines, trackColor));

      pd.setPoints(points);

      mapper.setInputData(pd);
      rotationMatrixTransform.apply(points.getData());
      pd.setLines(lines);

      // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
      // @ts-ignore
      trackActorProperty.setColor(...trackColor);
      trackActorProperty.setLineWidth(3);
      trackActor.setMapper(mapper);
      trackActors.set(track.trackId, trackActor);

      if (renderer) {
        renderer.addActor(trackActor);
      }
    };

    watch(frame, onFrameChangeFn);
    // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
    // @ts-ignore
    watch(selectedTrackIdRef, onSelectedTrackChangeFn);

    onMounted(() => {
      if (fullScreenRenderWindow) {
        return;
      }

      fullScreenRenderWindow = vtkFullScreenRenderWindow.newInstance({
        // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
        // @ts-ignore
        rootContainer: vtkContainer.value,
        background: [0, 0, 0],
      });

      renderer = fullScreenRenderWindow.getRenderer();
      renderWindow = renderer.getRenderWindow();

      orientationWidget = setInteractiveMarkerWidget(renderWindow);

      filteredTracksRef.filteredAnnotations.value.forEach(drawTrackFn);

      renderer.resetCamera();
      onFrameChangeFn(frame.value, undefined);
      onSelectedTrackChangeFn(selectedTrackIdRef.value, undefined);
    });

    onBeforeUnmount(() => {
      // eslint-disable-next-line no-unused-expressions
      fullScreenRenderWindow?.delete();
      // eslint-disable-next-line no-unused-expressions
      orientationWidget?.delete();
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
