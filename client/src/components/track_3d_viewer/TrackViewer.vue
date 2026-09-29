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
import { ballAt, Point2 } from './picking';
import { injectAggregateController } from '../annotators/useMediaController';

const TRACK_FONT = 'bold 14px sans-serif';
const SELECTED_FONT = 'bold 18px sans-serif';
const GUIDE_FONT = '12px sans-serif';
// Screen pixels: the least a ball measures for picking, and how far a press
// may travel before it counts as a drag of the view
const MINIMUM_PICK_RADIUS = 6;
const CLICK_TRAVEL = 4;
// Degrees the view turns for each press of a rotate button
const ROTATE_STEP = 15;

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
    /**
     * Turns the scene about the vertical through what the view looks at:
     * -1 counter-clockwise as seen from above, 1 clockwise.
     */
    const rotateView = (direction: number) => {
      if (!renderer.value) {
        return;
      }
      const camera = renderer.value.getActiveCamera();
      // The scene turning one way is the viewer circling it the other way
      camera.azimuth(direction * ROTATE_STEP);
      camera.orthogonalizeViewUp();
      renderer.value.resetCameraClippingRange();
      viewUtils.rerender();
    };

    const mediaController = injectAggregateController();

    const selectedTrackIdRef = useSelectedTrackId();
    const trackStyleManager = useTrackStyleManager();
    const handler = useHandler();
    const { frame: frameRef } = mediaController.value;

    let vtkContainerResizeObserver: ResizeObserver | null = null;

    const { initialize: initializeTrackDrawer, visibleBalls } = useTrackDrawer({
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
      // A ball's size on screen is how far its edge lands from its center
      const up = renderer.value?.getActiveCamera().getViewUp() ?? [0, 1, 0];
      const balls = visibleBalls().flatMap(({ trackId, center, radius }) => {
        const middle = toScreen(center);
        const edge = toScreen(center.map((value, axis) => value + radius * up[axis]) as Vec3);
        return middle && edge ? [{
          id: trackId,
          center: middle,
          radius: Math.hypot(edge[0] - middle[0], edge[1] - middle[1]),
        }] : [];
      });
      return ballAt(
        balls,
        [event.clientX - bounds.left, event.clientY - bounds.top],
        MINIMUM_PICK_RADIUS,
      );
    };

    let pressed: Point2 | null = null;
    const onPointerDown = function onPointerDown(event: PointerEvent) {
      pressed = event.button === 0 ? [event.clientX, event.clientY] : null;
    };
    // A press that does not move selects the track under it, or clears the
    // selection over empty space; one that moves turns the view
    const onPointerUp = function onPointerUp(event: PointerEvent) {
      const start = pressed;
      pressed = null;
      if (!start
        || Math.hypot(event.clientX - start[0], event.clientY - start[1]) > CLICK_TRAVEL) {
        return;
      }
      const trackId = trackAt(event);
      if (trackId !== selectedTrackIdRef.value) {
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
        // looking down on the grid leaves the top of the view empty. It fits
        // the height only, so a narrow pane needs to stand further back.
        const { width, height } = viewportDimensions.value;
        const aspect = height > 0 ? width / height : 1;
        camera.dolly(1.9 * Math.min(1, aspect / 1.6));
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
      resetView,
      rotateView,
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
    <v-btn
      class="vtk-button vtk-reset"
      icon
      small
      dark
      title="Reset view"
      @click="resetView"
    >
      <v-icon>mdi-image-filter-center-focus</v-icon>
    </v-btn>
    <v-btn
      class="vtk-button vtk-rotate-left"
      icon
      small
      dark
      title="Rotate left"
      @click="rotateView(-1)"
    >
      <v-icon>mdi-rotate-left</v-icon>
    </v-btn>
    <v-btn
      class="vtk-button vtk-rotate-right"
      icon
      small
      dark
      title="Rotate right"
      @click="rotateView(1)"
    >
      <v-icon>mdi-rotate-right</v-icon>
    </v-btn>
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

.vtk-button {
  position: absolute;
  background: rgba(0, 0, 0, 0.6);
}

.vtk-reset {
  top: 8px;
  right: 8px;
}

.vtk-rotate-left {
  bottom: 8px;
  left: 8px;
}

.vtk-rotate-right {
  bottom: 8px;
  right: 8px;
}

.vtk-container > canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}
</style>
