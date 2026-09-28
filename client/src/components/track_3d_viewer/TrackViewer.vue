<script lang="ts">
import {
  ref, onMounted, onBeforeUnmount, defineComponent, watch,
} from 'vue';

import '@kitware/vtk.js/Rendering/Profiles/Glyph';
import '@kitware/vtk.js/Rendering/Profiles/Geometry';

// @ts-expect-error no declaration file
import vtkCubeAxesActor from '@kitware/vtk.js/Rendering/Core/CubeAxesActor';
import vtkOpenGLRenderWindow from '@kitware/vtk.js/Rendering/OpenGL/RenderWindow';
import vtkRenderer from '@kitware/vtk.js/Rendering/Core/Renderer';
import vtkRenderWindow from '@kitware/vtk.js/Rendering/Core/RenderWindow';
import vtkRenderWindowInteractor from '@kitware/vtk.js/Rendering/Core/RenderWindowInteractor';
// @ts-expect-error no declaration file
import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera';
import { debounce } from '@kitware/vtk.js/macros';
import {
  useTrackViewerSettingsStore,
  useSelectedTrackId,
} from 'vue-media-annotator/provides';
import { ViewUtils } from './trackUtils';
import TrackManager from './TrackManager';
import useTrackDrawer from './useTrackDrawer';
import { noOp, smoothBounds } from './utils';
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
    const positionedTrackCount = ref(0);
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
      sceneBounds: () => null,
    };

    const mediaController = injectAggregateController();

    const selectedTrackIdRef = useSelectedTrackId();
    const { frame: frameRef } = mediaController.value;

    let vtkContainerResizeObserver: ResizeObserver | null = null;

    const { initialize: initializeTrackDrawer } = useTrackDrawer({
      trackManager,
      onlyShowSelectedTrack,
      detectionGlyphSize,
      positionedTrackCount,
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

      openglRenderWindow.value.setContainer(vtkContainer.value!);

      // Initialize the openglRenderWindow original size

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

      vtkContainer.value!.appendChild(labelTextCanvas);
      renderWindow.addRenderer(renderer.value);

      const camera = renderer.value.getActiveCamera();
      // Positions are in the left camera's frame (x right, y down, z forward):
      // look on from behind the rig, slightly above and to the side, so the
      // view reads like the image with depth receding into it.
      camera.setFocalPoint(0, 0, 0);
      camera.setPosition(-0.4, -0.4, -1);
      camera.setViewUp(0, -1, 0);

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

      const dataBounds = () => smoothBounds(viewUtils.sceneBounds() ?? [1, -1, 1, -1, 1, -1]);

      viewUtils.rerender = debounce((resetCamera = false) => {
        if (!renderWindow || renderWindow.isDeleted() || !renderer.value) {
          // pass
        } else {
          if (!adjustCubeAxesBoundsManually.value) {
            cubeAxes.setDataBounds(dataBounds());
          }
          drawCurrentFrameDetectionLabels();
          if (resetCamera) {
            renderer.value.resetCamera(cubeAxes.getDataBounds());
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

      // Always override the default bounds value on initialize
      const smoothedBounds = dataBounds();
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

        const { width, height } = vtkContainerEntry.contentRect;
        if (openglRenderWindow.value) openglRenderWindow.value.setSize(width, height);

        viewportDimensions.value.width = width;
        viewportDimensions.value.height = height;

        labelTextCanvas.setAttribute('width', String(width));
        labelTextCanvas.setAttribute('height', String(height));
        viewUtils.rerender();
      });
      // Observe the renderWindow container so we automatically resize the openglRenderWindow

      vtkContainerResizeObserver.observe(vtkContainer.value!);
      renderer.value.resetCamera(smoothedBounds);
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
      positionedTrackCount,
    };
  },
});
</script>

<template>
  <div
    ref="vtkContainer"
    class="vtk-container"
    :style="`--controls-height: ${controlsHeight}px`"
  >
    <div
      v-if="positionedTrackCount === 0"
      class="vtk-empty"
    >
      No detections have a 3D position yet. Stereo measurement adds one.
    </div>
  </div>
</template>

<style>
/* Canvases are taken out of flow so the pane, not the render size, sets the layout. */
.vtk-container {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.vtk-container > canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.vtk-empty {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border-radius: 4px;
  pointer-events: none;
}
</style>
