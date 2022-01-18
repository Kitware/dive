// Reference used because of https://github.com/Microsoft/TypeScript/issues/28502
/// <reference types="resize-observer-browser" />
import geo from 'geojs';
import {
  ref, reactive, onMounted, onBeforeUnmount, provide, toRef, Ref, UnwrapRef,
} from '@vue/composition-api';

import { use } from '../../provides';
import type { MediaController } from './mediaControllerType';

const MediaControllerSymbols: Record<string, symbol> = { default: Symbol('media-controller') };

export function injectMediaController(camera = 'default') {
  if (MediaControllerSymbols[camera] === undefined) {
    throw new Error(`Camera ${camera} was not found in the media Controller Symbols`);
  }
  return use<MediaController>(MediaControllerSymbols[camera]);
}

interface MediaControllerReactiveData {
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
  observer: null;
  cursor: string;
  imageCursor: string;
  originalBounds: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
}

export default function useMediaController() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const geoViewers: Record<string, Ref<any>> = { default: ref(undefined) };
  const containers: Record<string, Ref<HTMLElement | undefined>> = { default: ref(undefined) };
  const imageCursors: Record<string, Ref<HTMLElement | undefined>> = { default: ref(undefined) };
  const cameras: [string] = ['default'];
  const datas: Record<string, UnwrapRef<MediaControllerReactiveData>> = {
    default: reactive({
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
      observer: null,
      cursor: 'default',
      imageCursor: '',
      originalBounds: {
        left: 0,
        top: 0,
        bottom: 1,
        right: 1,
      },
    }),
  };

  function addCamera(camera = 'default') {
    geoViewers[camera] = ref(undefined);
    containers[camera] = ref(undefined);
    imageCursors[camera] = ref(undefined);
    if (cameras.indexOf(camera) === -1) {
      cameras.push(camera);
    }
    MediaControllerSymbols[camera] = Symbol(`media-controller-${camera}`);
    datas[camera] = reactive({
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
      observer: null,
      cursor: 'default',
      imageCursor: '',
      originalBounds: {
        left: 0,
        top: 0,
        bottom: 1,
        right: 1,
      },
    });
  }

  function onResize() {
    cameras.forEach((camera) => {
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
        });
      }
    });
  }

  function resetZoom() {
    cameras.forEach((camera) => {
      const geoViewerRef = geoViewers[camera];
      const data = datas[camera];
      const zoomAndCenter = geoViewerRef.value.zoomAndCenterFromBounds(
        data.originalBounds, 0,
      );
      geoViewerRef.value.zoom(zoomAndCenter.zoom);
      geoViewerRef.value.center(zoomAndCenter.center);
    });
  }

  function toggleLockedCamera() {
    cameras.forEach((camera) => {
      const data = datas[camera];
      data.lockedCamera = !data.lockedCamera;
    });
  }

  function resetMapDimensions(width: number, height: number, margin = 0.3) {
    cameras.forEach((camera) => {
      const geoViewerRef = geoViewers[camera];
      const containerRef = containers[camera];
      const data = datas[camera];
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
      geoViewerRef.value.clampBoundsX(true);
      geoViewerRef.value.clampBoundsY(true);
      geoViewerRef.value.clampZoom(true);
      resetZoom();
    });
  }

  let observer: ResizeObserver | null = null;
  onMounted(() => {
    cameras.forEach((camera) => {
      const containerRef = containers[camera].value;
      if (containerRef) {
        observer = new ResizeObserver(onResize);
        observer.observe(containerRef);
      } else {
        throw new Error('Container was missing, could not register observer');
      }
    });
  });
  onBeforeUnmount(() => {
    cameras.forEach((camera) => {
      const containerRef = containers[camera].value;

      if (containerRef && observer !== null) {
        observer.unobserve(containerRef);
      } else {
        throw new Error('Container or observer was missing');
      }
    });
  });

  /**
   * This secondary initialization wrapper solves a sort of
   * chicken-and-egg problem, allowing the function consumer to use
   * the state above to construct the dependencies for the methods below.
   */
  function initialize(camera = ' default', {
    seek, play, pause, setVolume, setSpeed,
  }: {
    seek(frame: number): void;
    play(): void;
    pause(): void;
    setVolume(level: number): void;
    setSpeed(level: number): void;
  }) {
    function setCursor(newCursor: string) {
      datas[camera].cursor = `${newCursor}`;
    }

    function setImageCursor(newCursor: string) {
      datas[camera].imageCursor = `${newCursor}`;
    }

    function centerOn(coords: { x: number; y: number; z: number }) {
      geoViewers[camera].value.center(coords);
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
    }

    function prevFrame() {
      const targetFrame = datas[camera].frame - 1;
      if (targetFrame >= 0) {
        seek(targetFrame);
      }
    }

    function nextFrame() {
      const targetFrame = datas[camera].frame + 1;
      if (targetFrame <= datas[camera].maxFrame) {
        seek(targetFrame);
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
      currentTime: toRef(datas[camera], 'currentTime'),
      playing: toRef(datas[camera], 'playing'),
      frame: toRef(datas[camera], 'frame'),
      flick: toRef(datas[camera], 'flick'),
      filename: toRef(datas[camera], 'filename'),
      lockedCamera: toRef(datas[camera], 'lockedCamera'),
      duration: toRef(datas[camera], 'duration'),
      volume: toRef(datas[camera], 'volume'),
      maxFrame: toRef(datas[camera], 'maxFrame'),
      speed: toRef(datas[camera], 'speed'),
      syncedFrame: toRef(datas[camera], 'syncedFrame'),
      prevFrame,
      nextFrame,
      play,
      pause,
      seek,
      resetZoom,
      toggleLockedCamera,
      centerOn,
      setCursor,
      setImageCursor,
      setVolume,
      setSpeed,
    };

    provide(MediaControllerSymbols[camera], mediaController);

    return {
      cursorHandler,
      initializeViewer,
      mediaController,
    };
  }

  return {
    containers,
    datas,
    geoViewers,
    imageCursors,
    initialize,
    onResize,
    resetMapDimensions,
    addCamera,
  };
}
