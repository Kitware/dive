// Reference used because of https://github.com/Microsoft/TypeScript/issues/28502
/// <reference types="resize-observer-browser" />
import geo, { GeoEvent } from 'geojs';
import * as d3 from 'd3';

import Vue, {
  ref, shallowRef, reactive, provide, toRef, Ref, UnwrapRef, computed, watch,
} from 'vue';
import { map, over } from 'lodash';

import { use } from '../../provides';
import type { AggregateMediaController, AlignedFrameResolver, MediaController } from './mediaControllerType';

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
  currentTime: number;
  duration: number;
  volume: number;
  speed: number;
  maxFrame: number;
  syncedFrame: number;
  /** False when an aligned-timeline slot has no frame for this camera; pane should blank. */
  hasFrame: boolean;
  cursor: string;
  imageCursor: string;
  imageCursorEditing: boolean;
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
  initializeViewer: (width: number, height: number, tileWidth?: number,
    tileHeight?: number, isMap?: boolean, geoSpatial?: boolean) => void;
  mediaController: MediaController;
  /**
   * True whenever a global aligned timeline is driving playback (see
   * AlignedFrameResolver) -- callers should skip starting their own internal
   * frame-advance loop and rely on the aggregate controller's seek instead.
   */
  externallyDriven: Readonly<Ref<boolean>>;
}

type CameraInitializerFunc = (cameraName: string, {
  seek, play, pause, setVolume, setSpeed,
}: {
  seek(frame: number | undefined): void;
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
  const resizeTrigger: Ref<number> = ref(0);
  // shallowRef: an AlignedFrameResolver carries nested Refs (slotCount, frameRate)
  // that must NOT be deep-reactive-converted/auto-unwrapped by a plain ref().
  const alignedFrameResolver: Ref<AlignedFrameResolver | null> = shallowRef(null);
  const alignedCurrentFrame: Ref<number> = ref(0);
  const externallyDriven = computed(() => alignedFrameResolver.value !== null);
  const alignedGapSlots = computed(() => alignedFrameResolver.value?.gapSlots.value ?? []);
  let alignedPlaybackTimer: ReturnType<typeof setTimeout> | undefined;
  const emptyControllerFrame = ref(0);
  const emptyControllerMaxFrame = ref(0);
  const emptyControllerPlaying = ref(false);
  const emptyControllerSpeed = ref(1);
  const emptyControllerVolume = ref(0);
  const emptyControllerCurrentTime = ref(0);
  const emptyControllerCameras = computed(() => [] as string[]);
  const emptyAggregateController: AggregateMediaController = {
    cameras: emptyControllerCameras,
    maxFrame: emptyControllerMaxFrame,
    frame: emptyControllerFrame,
    seek: () => {},
    nextFrame: () => {},
    prevFrame: () => {},
    volume: emptyControllerVolume,
    setVolume: () => {},
    speed: emptyControllerSpeed,
    setSpeed: () => {},
    pause: () => {},
    play: () => {},
    playing: emptyControllerPlaying,
    resetZoom: () => {},
    currentTime: emptyControllerCurrentTime,
    getController,
    toggleSynchronizeCameras,
    cameraSync: synchronizeCameras,
    resizeTrigger,
    alignedGapSlots,
    seekCameraFrame: aggregateSeekCameraFrame,
  };
  function stopAlignedPlaybackTimer() {
    if (alignedPlaybackTimer !== undefined) {
      clearTimeout(alignedPlaybackTimer);
      alignedPlaybackTimer = undefined;
    }
  }

  /**
   * Set (or clear, with null) the resolver that translates a global
   * aligned-timeline slot into each camera's own local frame index. Called
   * by Viewer.vue whenever its computed aligned timeline changes.
   */
  function setAlignedFrameResolver(resolver: AlignedFrameResolver | null) {
    stopAlignedPlaybackTimer();
    alignedFrameResolver.value = resolver;
    if (resolver) {
      // Immediately perform an aligned seek to slot 0 so that any camera with
      // no frame at that slot blanks right away, rather than continuing to
      // show its own local frame 0 until the first user-driven seek.
      alignedSeek(resolver, 0);
    } else {
      alignedCurrentFrame.value = 0;
    }
  }

  /**
   * Re-apply the current aligned slot whenever the camera roster changes
   * while a resolver is active. Annotators self-seek to their own local
   * frame 0 during init (see ImageAnnotator's init()), so a camera that
   * mounts after the resolver was installed would wrongly display its local
   * frame 0 even when the current slot has no frame for it. flush: 'post'
   * ensures this runs after the mounting annotator's own init-time seek.
   * (Watch the length via a getter: under Vue 2.7 a shallow watch on the ref
   * itself does not fire for in-place array mutation like push/splice.)
   */
  watch(() => cameras.value.length, () => {
    const resolver = alignedFrameResolver.value;
    if (resolver && cameras.value.length > 0) {
      alignedSeek(resolver, alignedCurrentFrame.value);
    }
  }, { flush: 'post' });

  function clear() {
    geoViewers = {};
    containers = {};
    imageCursors = {};
    cameras.value = [];
    subControllers = [];
    state = {};
    cameraControllerSymbols = {};
    setAlignedFrameResolver(null);
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
    let resized = false;
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
        resized = true;
        window.requestAnimationFrame(() => {
          geoViewerRef.value.size(size);
          mc.resetZoom();
        });
      }
    });
    // Trigger layer redraw after resize
    if (resized) {
      window.requestAnimationFrame(() => {
        resizeTrigger.value += 1;
      });
    }
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
    seek(frame: number | undefined): void;
    play(): void;
    pause(): void;
    setVolume(level: number): void;
    setSpeed(level: number): void;
  }) {
    // Clean up existing controller for this camera if it exists (e.g., when view mode switches)
    const existingIndex = subControllers.findIndex((c) => c.cameraName.value === cameraName);
    if (existingIndex !== -1) {
      subControllers.splice(existingIndex, 1);
      const existingSymbol = cameraControllerSymbols[cameraName];
      if (existingSymbol) {
        const existingCamera = existingSymbol.toString();
        const cameraIndex = cameras.value.indexOf(existingSymbol);
        if (cameraIndex !== -1) {
          cameras.value.splice(cameraIndex, 1);
        }
        delete geoViewers[existingCamera];
        delete containers[existingCamera];
        delete imageCursors[existingCamera];
        delete state[existingCamera];
      }
    }

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
      currentTime: 0,
      duration: 0,
      volume: 0,
      speed: 1.0,
      maxFrame: 0,
      syncedFrame: 0,
      hasFrame: true,
      cursor: 'default',
      imageCursor: '',
      imageCursorEditing: false,
      originalBounds: {
        left: 0,
        top: 0,
        bottom: 1,
        right: 1,
      },
    });

    function setCursor(newCursor: string) {
      if (state[camera]) {
        state[camera].cursor = `${newCursor}`;
      }
    }

    function setImageCursor(newCursor: string, editing = false) {
      if (state[camera]) {
        state[camera].imageCursor = `${newCursor}`;
        state[camera].imageCursorEditing = editing;
      }
    }

    function centerOn(coords: { x: number; y: number; z: number }) {
      geoViewers[camera].value.center(coords);
    }

    function transition(coords: { x: number; y: number}, duration: number, zoom?: number) {
      geoViewers[camera].value.transition({
        center: { x: coords.x, y: coords.y },
        zoom,
        duration,
        interp: d3.interpolateZoom,
      });
    }

    function resetZoom() {
      const geoViewerRef = geoViewers[camera];
      const data = state[camera];
      const zoomAndCenter = geoViewerRef.value.zoomAndCenterFromBounds(data.originalBounds, 0);
      geoViewerRef.value.zoom(zoomAndCenter.zoom);
      geoViewerRef.value.center(zoomAndCenter.center);
    }

    function resetMapDimensions(width: number, height: number, isMap = false, margin = 0.3) {
      const geoViewerRef = geoViewers[camera];
      const containerRef = containers[camera];
      const data = state[camera];
      geoViewerRef.value.bounds({
        left: 0,
        top: 0,
        bottom: height,
        right: width,
      });
      const params = geo.util.pixelCoordinateParams(containerRef.value, width, height, width, height);
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
        // 32x zoom max
        max: 32,
      });
      if (!isMap) {
        if (Object.keys(geoViewers).length === 1) {
          geoViewerRef.value.clampBoundsX(true);
          geoViewerRef.value.clampBoundsY(true);
          geoViewerRef.value.clampZoom(true);
        } else {
          geoViewerRef.value.clampBoundsX(false);
          geoViewerRef.value.clampBoundsY(false);
          geoViewerRef.value.clampZoom(false);
        }
      }
      resetZoom();
    }

    function initializeViewer(
      width: number,
      height: number,
      tileWidth: number | undefined = undefined,
      tileHeight: number | undefined = undefined,
      isMap = false,
      geoSpatial = false,
    ) {
      if (tileHeight === undefined) {
        // eslint-disable-next-line no-param-reassign
        tileHeight = height;
      }
      if (tileWidth === undefined) {
        // eslint-disable-next-line no-param-reassign
        tileWidth = width;
      }
      let params = geo.util.pixelCoordinateParams(containers[camera].value, width, height, tileWidth, tileHeight);
      if (isMap && geoSpatial) {
        params = { map: { node: containers[camera].value } };
      }
      geoViewers[camera].value = geo.map(params.map);
      if (!isMap || !geoSpatial) {
        resetMapDimensions(width, height, isMap);
      }
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
      duration: toRef(state[camera], 'duration'),
      volume: toRef(state[camera], 'volume'),
      maxFrame: toRef(state[camera], 'maxFrame'),
      speed: toRef(state[camera], 'speed'),
      syncedFrame: toRef(state[camera], 'syncedFrame'),
      hasFrame: toRef(state[camera], 'hasFrame'),
      prevFrame,
      nextFrame,
      play: _play,
      pause: _pause,
      seek: _seek,
      resetZoom,
      centerOn,
      transition,
      setCursor,
      setImageCursor,
      setVolume: _setVolume,
      setSpeed: _setSpeed,
      getController,
      resetMapDimensions,
      toggleSynchronizeCameras,
      cameraSync: synchronizeCameras,
      resizeTrigger,
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
      externallyDriven,
    };
  }

  /** Seeks every camera to its own local frame for the given global aligned-timeline slot. */
  function alignedSeek(resolver: AlignedFrameResolver, rawFrame: number) {
    const maxFrame = Math.max(0, resolver.slotCount.value - 1);
    const clamped = Math.min(Math.max(rawFrame, 0), maxFrame);
    alignedCurrentFrame.value = clamped;
    const perCamera = resolver.resolveSlot(clamped);
    subControllers.forEach((mc) => {
      mc.seek(perCamera[mc.cameraName.value]);
    });
  }

  function aggregateSeek(frame: number) {
    const resolver = alignedFrameResolver.value;
    if (resolver) {
      alignedSeek(resolver, frame);
    } else {
      subControllers.forEach((mc) => mc.seek(frame));
    }
  }

  /**
   * Seeks so that `camera` lands on its own local frame `localFrame`. Without
   * alignment, local and global frame numbers are identical (today's
   * positional broadcast), so this is just aggregateSeek. Under an aligned
   * timeline, translates through the global slot via resolveGlobalSlot so
   * every camera stays aligned; falls back to seeking only `camera` itself
   * if that local frame isn't part of any slot (shouldn't normally happen).
   */
  function aggregateSeekCameraFrame(camera: string, localFrame: number) {
    const resolver = alignedFrameResolver.value;
    if (!resolver) {
      aggregateSeek(localFrame);
      return;
    }
    const slot = resolver.resolveGlobalSlot(camera, localFrame);
    if (slot !== undefined) {
      alignedSeek(resolver, slot);
    } else {
      getController(camera).seek(localFrame);
    }
  }

  function aggregateNextFrame() {
    const resolver = alignedFrameResolver.value;
    if (resolver) {
      alignedSeek(resolver, alignedCurrentFrame.value + 1);
    } else {
      subControllers.forEach((mc) => mc.nextFrame());
    }
  }

  function aggregatePrevFrame() {
    const resolver = alignedFrameResolver.value;
    if (resolver) {
      alignedSeek(resolver, alignedCurrentFrame.value - 1);
    } else {
      subControllers.forEach((mc) => mc.prevFrame());
    }
  }

  function aggregatePause() {
    subControllers.forEach((mc) => mc.pause());
    stopAlignedPlaybackTimer();
  }

  function aggregatePlay() {
    // Each camera still flips its own `playing` UI state; when a resolver is
    // set, ImageAnnotator/VideoAnnotator skip starting their own internal
    // frame-advance loop (see externallyDriven) and this centralized tick
    // drives seeks instead.
    subControllers.forEach((mc) => mc.play());
    const resolver = alignedFrameResolver.value;
    if (!resolver) {
      return;
    }
    stopAlignedPlaybackTimer();
    const tick = () => {
      const maxFrame = Math.max(0, resolver.slotCount.value - 1);
      if (alignedCurrentFrame.value >= maxFrame) {
        aggregatePause();
        return;
      }
      alignedSeek(resolver, alignedCurrentFrame.value + 1);
      alignedPlaybackTimer = setTimeout(tick, 1000 / Math.max(1, resolver.frameRate.value));
    };
    alignedPlaybackTimer = setTimeout(tick, 1000 / Math.max(1, resolver.frameRate.value));
  }

  const aggregateController: Ref<AggregateMediaController> = computed(() => {
    if (cameras.value.length === 0) {
      // During reload the controllers are cleared before new ones are created.
      // Return a stub so watchers (e.g. LayerManager resizeTrigger) do not throw.
      return emptyAggregateController;
    }
    const defaultController = getController();
    const resolver = alignedFrameResolver.value;
    return {
      cameras: computed(() => cameras.value.map((v) => String(v))),
      maxFrame: resolver
        ? computed(() => Math.max(0, resolver.slotCount.value - 1))
        : defaultController.maxFrame,
      frame: resolver ? alignedCurrentFrame : defaultController.frame,
      seek: aggregateSeek,
      nextFrame: aggregateNextFrame,
      prevFrame: aggregatePrevFrame,
      volume: defaultController.volume,
      setVolume: over(map(subControllers, 'setVolume')),
      speed: defaultController.speed,
      setSpeed: over(map(subControllers, 'setSpeed')),
      pause: aggregatePause,
      play: aggregatePlay,
      playing: defaultController.playing,
      resetZoom: over(map(subControllers, 'resetZoom')),
      currentTime: defaultController.currentTime,
      getController,
      toggleSynchronizeCameras,
      cameraSync: synchronizeCameras,
      resizeTrigger,
      alignedGapSlots,
      seekCameraFrame: aggregateSeekCameraFrame,
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
    setAlignedFrameResolver,
  };
}
