// Reference used because of https://github.com/Microsoft/TypeScript/issues/28502
/// <reference types="resize-observer-browser" />
import geo, { GeoEvent } from 'geojs';
import {
  ref, reactive, provide, toRef, Ref, UnwrapRef, computed,
} from '@vue/composition-api';
import { map, over } from 'lodash';

import Vue from 'vue';
import { use } from '../../provides';
import type { AggregateMediaController, MediaController } from './mediaControllerType';

const AggregateControllerSymbol = Symbol('aggregate-controller');
const CameraInitializerSymbol = Symbol('camera-initializer');
const bus = new Vue();
let allowCameraTrigger = true; // Used to prevent infinite loop on Camera Sync

interface MediaControllerReactiveData {
  cameraName: string;
  ready: boolean;
  playing: boolean;
  frame: number;
  flick: number;
  filename: string;
  lockedCamera: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  speed: number;
  maxFrame: number;
  syncedFrame: number;
  cursor: string;
  imageCursor: string;
  originalBounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

interface CameraInitializerReturn {
  state: UnwrapRef<MediaControllerReactiveData>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  geoViewer: Ref<any>;
  container: Ref<HTMLElement | undefined>;
  imageCursor: Ref<HTMLElement | undefined>;
  cursorHandler: {
    handleMouseLeave: () => void;
    handleMouseEnter: () => void;
    handleMouseMove: (evt: MouseEvent) => void;
  };
  initializeViewer: (width: number, height: number) => void;
  mediaController: MediaController;
}

type CameraInitializerFunc = (cameraName: string, {
  seek, play, pause, setVolume, setSpeed,
}: {
  seek(frame: number): void;
  play(): void;
  pause(): void;
  setVolume(level: number): void;
  setSpeed(level: number): void;
}) => CameraInitializerReturn;

export function injectAggregateController() {
  return use<Ref<AggregateMediaController>>(AggregateControllerSymbol);
}

export function injectCameraInitializer() {
  return use<CameraInitializerFunc>(CameraInitializerSymbol);
}

export function useMediaController() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let geoViewers: Record<string, Ref<any>> = {};
  let containers: Record<string, Ref<HTMLElement | undefined>> = {};
  let imageCursors: Record<string, Ref<HTMLElement | undefined>> = {};
  const cameras: Ref<symbol[]> = ref([]);
  let subControllers: MediaController[] = [];
  let state: Record<string, UnwrapRef<MediaControllerReactiveData>> = {};
  let cameraControllerSymbols: Record<string, symbol> = {};
  const synchronizeCameras: Ref<boolean> = ref(false);
  function clear() {
    geoViewers = {};
    containers = {};
    imageCursors = {};
    cameras.value = [];
    subControllers = [];
    state = {};
    cameraControllerSymbols = {};
  }

  function getController(camera?: string) {
    if (cameras.value.length === 0) {
      throw new Error('no camera controllers currently exist');
    }
    if (camera === undefined) {
      return subControllers[0];
    }
    const found = subControllers.find((c) => c.cameraName.value === camera);
    if (!found) {
      throw new Error('no controller found for that camera');
    }
    return found;
  }

  /**
   * onResize resets the zoom of a camera when its window size changes.
   */
  function onResize() {
    subControllers.forEach((mc) => {
      const camera = cameraControllerSymbols[mc.cameraName.value].toString();
      const geoViewerRef = geoViewers[camera];
      const containerRef = containers[camera];
      if (geoViewerRef.value === undefined || containerRef.value === undefined) {
        return;
      }
      const size = containerRef.value.getBoundingClientRect();
      const mapSize = geoViewerRef.value.size();
      if (size.width !== mapSize.width || size.height !== mapSize.height) {
        window.requestAnimationFrame(() => {
          geoViewerRef.value.size(size);
          mc.resetZoom();
        });
      }
    });
  }

  function toggleLockedCamera() {
    cameras.value.forEach((camera) => {
      const data = state[camera.toString()];
      data.lockedCamera = !data.lockedCamera;
    });
  }

  function toggleSynchronizeCameras(val: boolean) {
    synchronizeCameras.value = val;
  }

  bus.$on('pan', (camEvent: {camera: string; event: GeoEvent}) => {
    const activeMap = geoViewers[camEvent.camera]?.value;
    if (activeMap !== undefined && synchronizeCameras.value) {
      allowCameraTrigger = false;
      Object.entries(geoViewers).forEach(([camera, geoViewer]) => {
        if (geoViewer.value && camera !== camEvent.camera) {
          geoViewer.value.pan(camEvent.event.screenDelta);
        }
      });
      allowCameraTrigger = true;
    }
  });

  bus.$on('zoom', (camEvent: {camera: string; event: GeoEvent}) => {
    const activeMap = geoViewers[camEvent.camera]?.value;
    if (activeMap !== undefined && synchronizeCameras.value) {
      allowCameraTrigger = false;
      Object.entries(geoViewers).forEach(([camera, geoViewer]) => {
        if (geoViewer.value && camera !== camEvent.camera) {
          geoViewer.value.zoom(activeMap.zoom());
        }
      });
      allowCameraTrigger = true;
    }
  });
  /**
   * This secondary initialization wrapper solves a sort of
   * chicken-and-egg problem, allowing the function consumer to use
   * the state above to construct the dependencies for the methods below.
   */
  function initialize(cameraName: string, {
    seek: _seek, play: _play, pause: _pause, setVolume: _setVolume, setSpeed: _setSpeed,
  }: {
    seek(frame: number): void;
    play(): void;
    pause(): void;
    setVolume(level: number): void;
    setSpeed(level: number): void;
  }) {
    const cameraSymbol = Symbol(`media-controller-${cameraName}`);
    cameraControllerSymbols[cameraName] = cameraSymbol;
    const camera = cameraSymbol.toString();
    geoViewers[camera] = ref(undefined);
    containers[camera] = ref(undefined);
    imageCursors[camera] = ref(undefined);

    state[camera] = reactive({
      cameraName,
      ready: false,
      playing: false,
      frame: 0,
      flick: 0,
      filename: '',
      lockedCamera: false,
      currentTime: 0,
      duration: 0,
      volume: 0,
      speed: 1.0,
      maxFrame: 0,
      syncedFrame: 0,
      cursor: 'default',
      imageCursor: '',
      originalBounds: {
        left: 0,
        top: 0,
        bottom: 1,
        right: 1,
      },
    });

    function setCursor(newCursor: string) {
      state[camera].cursor = `${newCursor}`;
    }

    function setImageCursor(newCursor: string) {
      state[camera].imageCursor = `${newCursor}`;
    }

    function centerOn(coords: { x: number; y: number; z: number }) {
      geoViewers[camera].value.center(coords);
    }

    function resetZoom() {
      const geoViewerRef = geoViewers[camera];
      const data = state[camera];
      const zoomAndCenter = geoViewerRef.value.zoomAndCenterFromBounds(
        data.originalBounds, 0,
      );
      geoViewerRef.value.zoom(zoomAndCenter.zoom);
      geoViewerRef.value.center(zoomAndCenter.center);
    }

    function resetMapDimensions(width: number, height: number, margin = 0.3) {
      const geoViewerRef = geoViewers[camera];
      const containerRef = containers[camera];
      const data = state[camera];
      geoViewerRef.value.bounds({
        left: 0,
        top: 0,
        bottom: height,
        right: width,
      });
      const params = geo.util.pixelCoordinateParams(
        containerRef.value, width, height, width, height,
      );
      const { right, bottom } = params.map.maxBounds;
      data.originalBounds = params.map.maxBounds;
      geoViewerRef.value.maxBounds({
        left: 0 - (right * margin),
        top: 0 - (bottom * margin),
        right: right * (1 + margin),
        bottom: bottom * (1 + margin),
      });
      geoViewerRef.value.zoomRange({
        // do not set a min limit so that bounds clamping determines min
        min: -Infinity,
        // 4x zoom max
        max: 4,
      });
      if (Object.keys(geoViewers).length === 1) {
        geoViewerRef.value.clampBoundsX(true);
        geoViewerRef.value.clampBoundsY(true);
        geoViewerRef.value.clampZoom(true);
      } else {
        geoViewerRef.value.clampBoundsX(false);
        geoViewerRef.value.clampBoundsY(false);
        geoViewerRef.value.clampZoom(false);
      }
      resetZoom();
    }

    function initializeViewer(width: number, height: number) {
      const params = geo.util.pixelCoordinateParams(
        containers[camera].value, width, height, width, height,
      );
      geoViewers[camera].value = geo.map(params.map);
      resetMapDimensions(width, height);
      const interactorOpts = geoViewers[camera].value.interactor().options();
      interactorOpts.keyboard.focusHighlight = false;
      interactorOpts.keyboard.actions = {};
      interactorOpts.click.cancelOnMove = 5;

      interactorOpts.actions = [
        interactorOpts.actions[0],
        // The action below is needed to have GeoJS use the proper handler
        // with cancelOnMove for right clicks
        {
          action: geo.geo_action.select,
          input: { right: true },
          name: 'button edit',
          owner: 'geo.MapInteractor',
        },
        // The action below adds middle mouse button click to panning
        // It allows for panning while in the process of polygon editing or creation
        {
          action: geo.geo_action.pan,
          input: 'middle',
          modifiers: { shift: false, ctrl: false },
          owner: 'geo.mapInteractor',
          name: 'button pan',

        },
        interactorOpts.actions[2],
        interactorOpts.actions[6],
        interactorOpts.actions[7],
        interactorOpts.actions[8],
        interactorOpts.actions[9],
      ];
      // Set > 2pi to disable rotation
      interactorOpts.zoomrotateMinimumRotation = 7;
      interactorOpts.zoomAnimation = {
        enabled: false,
      };
      interactorOpts.momentum = {
        enabled: false,
      };
      interactorOpts.wheelScaleY = 0.2;
      geoViewers[camera].value.interactor().options(interactorOpts);

      //Add in bus control synchronization for cameras
      geoViewers[camera].value.geoOn(geo.event.pan, (e: GeoEvent) => {
        // Only trigger if not handling other camera interactions.
        if (allowCameraTrigger) {
          bus.$emit('pan', { camera: camera.toString(), event: e });
        }
      });
      geoViewers[camera].value.geoOn(geo.event.zoom, (e: GeoEvent) => {
        // Only trigger if not handling other camera interactions.
        if (allowCameraTrigger) {
          bus.$emit('zoom', { camera: camera.toString(), event: e });
        }
      });
    }

    function prevFrame() {
      const targetFrame = state[camera].frame - 1;
      if (targetFrame >= 0) {
        _seek(targetFrame);
      }
    }

    function nextFrame() {
      const targetFrame = state[camera].frame + 1;
      if (targetFrame <= state[camera].maxFrame) {
        _seek(targetFrame);
      }
    }

    const imageCursorRef = imageCursors[camera];

    const cursorHandler = {
      handleMouseLeave() {
        if (imageCursorRef.value) {
          imageCursorRef.value.style.display = 'none';
        }
      },
      handleMouseEnter() {
        if (imageCursorRef.value) {
          imageCursorRef.value.style.display = 'block';
        }
      },
      handleMouseMove(evt: MouseEvent) {
        const offsetX = evt.clientX + 10;
        const offsetY = evt.clientY - 25;
        window.requestAnimationFrame(() => {
          if (imageCursorRef.value) {
            imageCursorRef.value.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
          }
        });
      },
    };

    const mediaController: MediaController = {
      geoViewerRef: geoViewers[camera],
      cameraName: toRef(state[camera], 'cameraName'),
      cameras: ref([]),
      currentTime: toRef(state[camera], 'currentTime'),
      playing: toRef(state[camera], 'playing'),
      frame: toRef(state[camera], 'frame'),
      flick: toRef(state[camera], 'flick'),
      filename: toRef(state[camera], 'filename'),
      lockedCamera: toRef(state[camera], 'lockedCamera'),
      duration: toRef(state[camera], 'duration'),
      volume: toRef(state[camera], 'volume'),
      maxFrame: toRef(state[camera], 'maxFrame'),
      speed: toRef(state[camera], 'speed'),
      syncedFrame: toRef(state[camera], 'syncedFrame'),
      prevFrame,
      nextFrame,
      play: _play,
      pause: _pause,
      seek: _seek,
      resetZoom,
      toggleLockedCamera,
      centerOn,
      setCursor,
      setImageCursor,
      setVolume: _setVolume,
      setSpeed: _setSpeed,
      getController,
      resetMapDimensions,
      toggleSynchronizeCameras,
      cameraSync: synchronizeCameras,

    };

    subControllers.push(mediaController);
    cameras.value.push(cameraSymbol);

    return {
      state: state[camera],
      geoViewer: geoViewers[camera],
      container: containers[camera],
      imageCursor: imageCursors[camera],
      cursorHandler,
      initializeViewer,
      mediaController,
    };
  }

  const aggregateController: Ref<AggregateMediaController> = computed(() => {
    const defaultController = getController();
    return {
      cameras: computed(() => cameras.value.map((v) => String(v))),
      maxFrame: defaultController.maxFrame,
      frame: defaultController.frame,
      seek: over(map(subControllers, 'seek')),
      nextFrame: over(map(subControllers, 'nextFrame')),
      prevFrame: over(map(subControllers, 'prevFrame')),
      volume: defaultController.volume,
      setVolume: over(map(subControllers, 'setVolume')),
      speed: defaultController.speed,
      setSpeed: over(map(subControllers, 'setSpeed')),
      lockedCamera: defaultController.lockedCamera,
      toggleLockedCamera,
      pause: over(map(subControllers, 'pause')),
      play: over(map(subControllers, 'play')),
      playing: defaultController.playing,
      resetZoom: over(map(subControllers, 'resetZoom')),
      currentTime: defaultController.currentTime,
      getController,
      toggleSynchronizeCameras,
      cameraSync: synchronizeCameras,
    };
  });

  provide(AggregateControllerSymbol, aggregateController as Ref<AggregateMediaController>);
  provide(CameraInitializerSymbol, initialize as CameraInitializerFunc);

  return {
    aggregateController,
    containers,
    state,
    geoViewers,
    imageCursors,
    initialize,
    onResize,
    clear,
  };
}
