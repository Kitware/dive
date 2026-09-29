<script lang="ts">
import {
  ref, onMounted, onBeforeUnmount, defineComponent, watch, PropType,
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
  useHandler,
  useTrackViewerSettingsStore,
  useSelectedTrackId,
  useTrackStyleManager,
} from 'vue-media-annotator/provides';
import { ViewUtils } from './trackUtils';
import TrackManager from './TrackManager';
import useTrackDrawer from './useTrackDrawer';
import { noOp, smoothBounds } from './utils';
import { useOrientationMarkerWidget } from './useOrientationMarkerWidget';
import { useLabelDrawer } from './useLabelDrawer';
import useSceneGuides from './useSceneGuides';
import { RigCalibration } from './sceneGuides';
import { Vec3 } from './positions';
import { nearestOutline, Point2 } from './picking';
import { injectAggregateController } from '../annotators/useMediaController';

const TRACK_FONT = 'bold 14px sans-serif';
const SELECTED_FONT = 'bold 18px sans-serif';
const GUIDE_FONT = '12px sans-serif';
// Screen pixels: how near a click must land, and how far a press may travel
// before it counts as a drag of the view
const PICK_TOLERANCE = 10;
const CLICK_TRAVEL = 4;

export default defineComponent({
  name: 'TrackViewer',

  props: {
    controlsHeight: {
      type: Number,
      required: true,
    },
    /** The stereo rig, to draw its cameras; the left one alone shows without it. */
    calibration: {
      type: Object as PropType<RigCalibration | null>,
      default: null,
    },
  },

  setup(props) {
    const orientationMarkerWidget = useOrientationMarkerWidget();
    const trackViewerSettingsStore = useTrackViewerSettingsStore();

    const {
      onlyShowSelectedTrack,
      cameraParallelProjection,
      detectionGlyphSize,
      cubeAxesBounds,
      adjustCubeAxesBoundsManually,
      showAxesBox,
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
    const sceneGuides = useSceneGuides(renderer);
    let frameView = noOp;
    const resetView = () => {
      frameView();
      viewUtils.rerender();
    };

    const mediaController = injectAggregateController();

    const selectedTrackIdRef = useSelectedTrackId();
    const trackStyleManager = useTrackStyleManager();
    const handler = useHandler();
    const { frame: frameRef } = mediaController.value;

    let vtkContainerResizeObserver: ResizeObserver | null = null;

    const { initialize: initializeTrackDrawer, visibleShapes } = useTrackDrawer({
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
      sceneGuides.labels().forEach(({ position, text, color }) => {
        drawLabels(new Map([[position, text]]), { color, font: GUIDE_FONT });
      });

      const selectedId = selectedTrackIdRef.value;
      const positionToLabel = new Map<Vec3, string>();
      if (!onlyShowSelectedTrack.value) {
        const frameTracker = trackManager.getFrameTracker(frameRef.value);
        frameTracker?.detectionActors.forEach((actor, idx) => {
          if (frameTracker.trackIds[idx] !== selectedId) {
            positionToLabel.set(actor.getPosition() as Vec3, String(frameTracker.trackIds[idx]));
          }
        });
      }
      drawLabels(positionToLabel, { color: 'white', font: TRACK_FONT });

      // Drawn last so the selected track's label is never covered
      const selectedActor = selectedId === null
        ? undefined : trackManager.getTrack(selectedId)?.detectionsMap.get(frameRef.value);
      if (selectedActor) {
        drawLabels(new Map([[selectedActor.getPosition() as Vec3, String(selectedId)]]), {
          color: trackStyleManager.stateStyles.selected.color,
          font: SELECTED_FONT,
        });
      }
    };

    /** Where a point is drawn in the pane, or null when it is behind the viewer. */
    const toScreen = function toScreen(position: Vec3): Point2 | null {
      if (!renderer.value || !openglRenderWindow.value) {
        return null;
      }
      const camera = renderer.value.getActiveCamera();
      const eye = camera.getPosition();
      const direction = camera.getDirectionOfProjection();
      const ahead = position.reduce(
        (sum, value, axis) => sum + (value - eye[axis]) * direction[axis],
        0,
      );
      if (ahead <= 0) {
        return null;
      }
      const display = openglRenderWindow.value.worldToDisplay(...position, renderer.value);
      return [display[0], viewportDimensions.value.height - display[1]];
    };

    const trackAt = function trackAt(event: MouseEvent) {
      const bounds = vtkContainer.value?.getBoundingClientRect();
      if (!bounds) {
        return null;
      }
      const outlines = visibleShapes().map(({ trackId, points }) => ({
        id: trackId,
        points: points.map(toScreen).filter((point): point is Point2 => point !== null),
      }));
      return nearestOutline(
        outlines,
        [event.clientX - bounds.left, event.clientY - bounds.top],
        PICK_TOLERANCE,
      );
    };

    let pressed: Point2 | null = null;
    const onPointerDown = function onPointerDown(event: PointerEvent) {
      pressed = event.button === 0 ? [event.clientX, event.clientY] : null;
    };
    // A press that does not move selects the track under it; one that moves turns the view
    const onPointerUp = function onPointerUp(event: PointerEvent) {
      const start = pressed;
      pressed = null;
      if (!start
        || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > CLICK_TRAVEL) {
        return;
      }
      const trackId = trackAt(event);
      if (trackId !== null) {
        handler.trackSelect(trackId, false);
      }
    };
    const onPointerMove = function onPointerMove(event: PointerEvent) {
      if (vtkContainer.value && event.buttons === 0) {
        vtkContainer.value.style.cursor = trackAt(event) === null ? '' : 'pointer';
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
      vtkContainer.value!.addEventListener('pointerdown', onPointerDown);
      vtkContainer.value!.addEventListener('pointerup', onPointerUp);
      vtkContainer.value!.addEventListener('pointermove', onPointerMove);
      renderWindowInteractor.setInteractorStyle(vtkInteractorStyleTrackballCamera.newInstance());

      renderWindowInteractor.onAnimation(drawCurrentFrameDetectionLabels);

      renderer.value = vtkRenderer.newInstance({
        background: [0, 0, 0],
      });
      const { labelTextCanvas } = initializeLabelDrawer();
      // Initialize the openglRenderWindow original size

      vtkContainer.value!.appendChild(labelTextCanvas);
      renderWindow.addRenderer(renderer.value);

      const camera = renderer.value.getActiveCamera();
      /**
       * Positions are in the left camera's frame (x right, y down, z forward).
       * The view looks down the depth axis like the cameras do, from just
       * behind and above the rig so the rig itself stays in sight.
       */
      frameView = () => {
        if (!renderer.value) {
          return;
        }
        camera.setFocalPoint(0, 0, 0);
        camera.setPosition(0, -0.35, -1);
        camera.setViewUp(0, -1, 0);
        renderer.value.resetCamera(sceneGuides.extent());
        // resetCamera fits the bounding sphere, which leaves a wide margin, and
        // looking down on the floor leaves the top of the view empty
        camera.dolly(1.9);
        camera.setWindowCenter(0, -0.2);
        renderer.value.resetCameraClippingRange();
      };

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
      cubeAxes.setVisibility(showAxesBox.value);

      const dataBounds = () => smoothBounds(viewUtils.sceneBounds() ?? [1, -1, 1, -1, 1, -1]);

      let guidesKey = '';
      let framedRig = '';
      let framedData = false;
      const updateGuides = function updateGuides() {
        const sceneBounds = viewUtils.sceneBounds();
        const rigKey = JSON.stringify(props.calibration);
        const key = JSON.stringify(sceneBounds) + rigKey;
        if (key === guidesKey) {
          return;
        }
        // The first positions to appear, or a new rig, change what there is to frame
        const reframe = guidesKey === '' || rigKey !== framedRig
          || (sceneBounds !== null) !== framedData;
        guidesKey = key;
        framedRig = rigKey;
        framedData = sceneBounds !== null;
        sceneGuides.build(sceneBounds, props.calibration);
        if (reframe) {
          frameView();
        }
      };

      viewUtils.rerender = debounce((resetCamera = false) => {
        if (!renderWindow || renderWindow.isDeleted() || !renderer.value) {
          // pass
        } else {
          updateGuides();
          if (!adjustCubeAxesBoundsManually.value) {
            cubeAxes.setDataBounds(dataBounds());
          }
          if (resetCamera) {
            renderer.value.resetCamera(sceneGuides.extent());
          }
          drawCurrentFrameDetectionLabels();
          renderWindow.render();
        }
      }, 10);

      watch(() => props.calibration, () => viewUtils.rerender());
      watch(showAxesBox, (show) => {
        cubeAxes.setVisibility(show);
        viewUtils.rerender();
      });

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
      viewUtils.rerender();
    });

    onBeforeUnmount(() => {
      viewUtils.rerender = noOp;
      frameView = noOp;
      vtkContainer.value?.removeEventListener('pointerdown', onPointerDown);
      vtkContainer.value?.removeEventListener('pointerup', onPointerUp);
      vtkContainer.value?.removeEventListener('pointermove', onPointerMove);
      sceneGuides.clear();
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
      resetView,
    };
  },
});
</script>

<template>
  <div class="track-viewer">
    <div
      ref="vtkContainer"
      class="vtk-container"
      :style="`--controls-height: ${controlsHeight}px`"
    />
    <v-tooltip left>
      <template #activator="{ on }">
        <v-btn
          class="vtk-reset"
          icon
          small
          dark
          v-on="on"
          @click="resetView"
        >
          <v-icon>mdi-restore</v-icon>
        </v-btn>
      </template>
      <span>Reset view</span>
    </v-tooltip>
    <div
      v-if="positionedTrackCount === 0"
      class="vtk-empty"
    >
      No detections have a 3D position yet. Stereo measurement adds one.
    </div>
  </div>
</template>

<style>
.track-viewer {
  position: relative;
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
}

/* Canvases are taken out of flow so the pane, not the render size, sets the layout. */
.vtk-container {
  position: relative;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.vtk-reset {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(0, 0, 0, 0.6);
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
