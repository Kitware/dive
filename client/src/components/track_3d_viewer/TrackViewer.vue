<script lang="ts">
import {
  ref, onMounted, onBeforeUnmount, defineComponent, watch,
} from '@vue/composition-api';

import '@kitware/vtk.js/Rendering/Profiles/Glyph';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore no declaration file
import vtkCubeAxesActor from '@kitware/vtk.js/Rendering/Core/CubeAxesActor';
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore no declaration file
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore no declaration file
import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import { debounce } from '@kitware/vtk.js/macros';
import {
  useTrackViewerSettingsStore,
  useSelectedTrackId,
} from 'vue-media-annotator/provides';
import { ViewUtils } from './trackUtils';
import TrackManager from './TrackManager';
import useTrackDrawer from './useTrackDrawer';
import { smoothBounds } from './utils';
import { noOp } from './misc';
import { useOrientationMarkerWidget } from './useOrientationMarkerWidget';
import { useLabelDrawer } from './useLabelDrawer';
import { injectAggregateController } from '../annotators/useMediaController';

export default defineComponent({
  name: 'TrackViewer',

  props: {
    controlsHeight: {
      type: Number,
      required: true,
    },
  },

  setup() {
    const orientationMarkerWidget = useOrientationMarkerWidget();
    const trackViewerSettingsStore = useTrackViewerSettingsStore();

    const {
      onlyShowSelectedTrack,
      cameraParallelProjection,
      detectionGlyphSize,
      cubeAxesBounds,
      adjustCubeAxesBoundsManually,
    } = trackViewerSettingsStore;

    const renderer = ref<vtkRenderer>();
    const viewportDimensions = ref({
      height: 0,
      width: 0,
    });

    // Initialize the data structure to keep track of every tracks present in the 3d view
    const trackManager = new TrackManager();
    const vtkContainer = ref<HTMLDivElement>();

    let renderWindow: vtkRenderWindow | undefined;
    let renderWindowInteractor: vtkRenderWindowInteractor | undefined;
    const openglRenderWindow = ref<vtkOpenGLRenderWindow>();

    const viewUtils: ViewUtils = {
      rerender: noOp,
    };

    const mediaController = injectAggregateController();

    const selectedTrackIdRef = useSelectedTrackId();
    const { frame: frameRef } = mediaController.value;

    let vtkContainerResizeObserver: ResizeObserver | null = null;


    const { initialize: initializeTrackDrawer } = useTrackDrawer({
      trackManager,
      onlyShowSelectedTrack,
      detectionGlyphSize,
      viewUtils,
      renderer,
    });


    const { initialize: initializeLabelDrawer, drawLabels, clearLabelContext } = useLabelDrawer({
      renderer,
      viewportDimensions,
      openglRenderWindow,
    });

    const drawCurrentFrameDetectionLabels = function drawCurrentFrameDetectionLabels() {
      clearLabelContext();

      if (!onlyShowSelectedTrack.value) {
        const frameTracker = trackManager.getFrameTracker(frameRef.value);
        if (frameTracker) {
          const positionToLabel = new Map();
          frameTracker.detectionActors.forEach((actor, idx) => {
            positionToLabel.set(actor.getPosition(), frameTracker.trackIds[idx]);
          });
          drawLabels(positionToLabel);
        }
      } else if (selectedTrackIdRef.value) {
        const trackTracker = trackManager.getTrack(selectedTrackIdRef.value);
        if (trackTracker) {
          const frameDetectionActor = trackTracker.detectionsMap.get(frameRef.value);
          if (frameDetectionActor) {
            const positionToLabel = new Map();
            positionToLabel.set(frameDetectionActor.getPosition(), selectedTrackIdRef.value);
            drawLabels(positionToLabel);
          }
        }
      }
    };

    onMounted(() => {
      renderWindow = vtkRenderWindow.newInstance();

      openglRenderWindow.value = vtkOpenGLRenderWindow.newInstance();
      renderWindow.addView(openglRenderWindow.value);
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      openglRenderWindow.value.setContainer(vtkContainer.value!);

      // Initialize the openglRenderWindow original size
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const { width, height } = vtkContainer.value!.getBoundingClientRect();
      openglRenderWindow.value.setSize(width, height);
      viewportDimensions.value.width = width;
      viewportDimensions.value.height = height;
      renderWindowInteractor = vtkRenderWindowInteractor.newInstance();
      renderWindowInteractor.setView(openglRenderWindow.value);
      renderWindowInteractor.initialize();
      renderWindowInteractor.bindEvents(vtkContainer.value);
      renderWindowInteractor.setInteractorStyle(vtkInteractorStyleTrackballCamera.newInstance());

      renderWindowInteractor.onAnimation(drawCurrentFrameDetectionLabels);

      renderer.value = vtkRenderer.newInstance({
        background: [0.5, 0.5, 0.5],
      });
      const { labelTextCanvas } = initializeLabelDrawer();
      // Initialize the openglRenderWindow original size
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      vtkContainer.value!.appendChild(labelTextCanvas);
      renderWindow.addRenderer(renderer.value);

      const camera = renderer.value.getActiveCamera();

      watch(cameraParallelProjection, (parProjection) => {
        if (!renderer.value) {
          throw new Error('vtkRenderer instance not found.');
        }
        renderer.value.getActiveCamera().setParallelProjection(parProjection);
        // renderer.value.resetCamera();
        viewUtils.rerender();
      }, {
        immediate: true,
      });

      // trying to turn off shadows
      const light = renderer.value.getLights()[0];

      if (light) {
        light.setShadowAttenuation(0);
      }

      const cubeAxes = vtkCubeAxesActor.newInstance();
      cubeAxes.setCamera(camera);

      viewUtils.rerender = debounce((resetCamera = false) => {
        if (!renderWindow || renderWindow.isDeleted() || !renderer.value) {
          // pass
        } else {
          if (!adjustCubeAxesBoundsManually.value) {
            renderer.value.removeActor(cubeAxes);
            const bounds = renderer.value.computeVisiblePropBounds();
            const smoothedBounds = smoothBounds(bounds);
            cubeAxes.setDataBounds(smoothedBounds);
            renderer.value.addActor(cubeAxes);
          }
          drawCurrentFrameDetectionLabels();
          if (resetCamera) {
            renderer.value.resetCamera();
          }
          renderWindow.render();
        }
      }, 10);

      orientationMarkerWidget.enable(
        renderWindow.getInteractor(),
        renderer.value.getActiveCamera(),
        viewUtils.rerender,
      );

      // Initial track drawing
      initializeTrackDrawer();

      const bounds = renderer.value.computeVisiblePropBounds();
      // Always override the default bounds value on initialize
      const smoothedBounds = smoothBounds(bounds);
      cubeAxes.setDataBounds(smoothedBounds);

      cubeAxesBounds.value = {
        xrange: smoothedBounds.slice(0, 2) as [number, number],
        yrange: smoothedBounds.slice(2, 4) as [number, number],
        zrange: smoothedBounds.slice(4, 6) as [number, number],
      };

      watch(cubeAxesBounds, (newRanges) => {
        cubeAxes.setDataBounds([
          ...newRanges.xrange,
          ...newRanges.yrange,
          ...newRanges.zrange,
        ]);
        viewUtils.rerender();
      }, {
        deep: true,
      });

      renderer.value.addActor(cubeAxes);

      vtkContainerResizeObserver = new ResizeObserver((entries: readonly ResizeObserverEntry[]) => {
        const vtkContainerEntry = entries[0];
        // eslint-disable-next-line no-shadow
        const { width, height } = vtkContainerEntry.contentRect;
        if (openglRenderWindow.value) openglRenderWindow.value.setSize(width, height);

        viewportDimensions.value.width = width;
        viewportDimensions.value.height = height;

        labelTextCanvas.setAttribute('width', String(width));
        labelTextCanvas.setAttribute('height', String(height));
        viewUtils.rerender();
      });
      // Observe the renderWindow container so we automatically resize the openglRenderWindow
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      vtkContainerResizeObserver.observe(vtkContainer.value!);
      renderer.value.resetCamera();
      viewUtils.rerender();
    });

    onBeforeUnmount(() => {
      viewUtils.rerender = noOp;
      // Stop observing for resize
      if (vtkContainerResizeObserver) vtkContainerResizeObserver.disconnect();
      orientationMarkerWidget.disable();

      if (renderer.value) renderer.value.delete();
      if (openglRenderWindow.value) openglRenderWindow.value.delete();
      if (renderWindow) renderWindow.delete();

      if (renderWindowInteractor) {
        renderWindowInteractor.unbindEvents();
        renderWindowInteractor.delete();
      }
      openglRenderWindow.value = undefined;
      renderWindow = undefined;
      renderWindowInteractor = undefined;
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
.vtk-container {
  width: 100%;
  height: 100%;
}
</style>
