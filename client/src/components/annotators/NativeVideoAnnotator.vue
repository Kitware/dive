<script lang="ts">
import {
  defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';
import { ipcRenderer } from 'electron';
import { ImageEnhancementOutputs } from 'vue-media-annotator/use/useImageEnhancements';
import { Flick, SetTimeFunc } from '../../use/useTimeObserver';
import { injectCameraInitializer } from './useMediaController';

/**
 * NativeVideoAnnotator renders video frames extracted on-demand via FFmpeg.
 * This allows playback of arbitrary video formats without transcoding,
 * saving disk space at the cost of potentially slower playback performance.
 *
 * The component uses a canvas element to display frames, which are fetched
 * from the backend frame extraction API.
 */
export default defineComponent({
  name: 'NativeVideoAnnotator',
  props: {
    // Path to the original video file (not a URL)
    nativeVideoPath: {
      type: String,
      required: true,
    },
    frameRate: {
      type: Number,
      required: true,
    },
    updateTime: {
      type: Function as PropType<SetTimeFunc>,
      required: true,
    },
    originalFps: {
      type: Number as PropType<number | null>,
      default: null,
    },
    camera: {
      type: String as PropType<string>,
      default: 'singleCam',
    },
    imageEnhancementOutputs: {
      type: Object as PropType<ImageEnhancementOutputs>,
      default: () => ({
        brightness: { slope: 1, intercept: 0 },
        contrast: { slope: 1, intercept: 0.5 },
        saturation: { values: 1 },
        sharpen: { kernelMatrix: '0 -1 0 -1 5 -1 0 -1 0', divisor: 1 },
      }),
    },
    isDefaultImage: {
      type: Boolean,
      default: true,
    },
  },
  setup(props) {
    const cameraInitializer = injectCameraInitializer();
    const {
      state: data,
      geoViewer,
      cursorHandler,
      imageCursor,
      container,
      initializeViewer,
      mediaController,
    } = cameraInitializer(props.camera, {
      seek,
      pause,
      play,
      setVolume,
      setSpeed,
    });

    // Canvas for rendering frames
    const frameCanvas = document.createElement('canvas');
    const frameCtx = frameCanvas.getContext('2d');

    // Video info loaded from backend
    const videoInfo = ref<{
      fps: number;
      duration: number;
      width: number;
      height: number;
      frameCount: number;
    } | null>(null);

    // Playback state
    const isPlaying = ref(false);
    let playbackInterval: number | null = null;

    // Frame loading
    const currentFrameImage = new Image();
    const frameCache = new Map<number, HTMLImageElement>();
    const MAX_CACHE_SIZE = 50;

    // API base URL (fetched from IPC)
    let baseApiUrl = '';

    /**
     * Get the API base URL from the backend server
     */
    async function getApiBaseUrl(): Promise<string> {
      if (baseApiUrl) return baseApiUrl;
      const addr = await ipcRenderer.invoke('server-info');
      baseApiUrl = `http://${addr.address}:${addr.port}/api`;
      return baseApiUrl;
    }

    /**
     * Load video info from the backend
     */
    async function loadVideoInfo() {
      try {
        const apiUrl = await getApiBaseUrl();
        const response = await fetch(
          `${apiUrl}/video-info?path=${encodeURIComponent(props.nativeVideoPath)}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to load video info: ${response.statusText}`);
        }
        videoInfo.value = await response.json();
      } catch (err) {
        console.error('Failed to load video info:', err);
        throw err;
      }
    }

    /**
     * Get the URL for a specific frame
     */
    function getFrameUrl(frameNumber: number): string {
      const fps = videoInfo.value?.fps || props.originalFps || props.frameRate;
      return `${baseApiUrl}/frame?path=${encodeURIComponent(props.nativeVideoPath)}&frame=${frameNumber}&fps=${fps}`;
    }

    /**
     * Load a frame image and optionally cache it
     */
    function loadFrame(frameNumber: number): Promise<HTMLImageElement> {
      // Check cache first
      const cached = frameCache.get(frameNumber);
      if (cached) {
        return Promise.resolve(cached);
      }

      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          // Add to cache
          if (frameCache.size >= MAX_CACHE_SIZE) {
            // Remove oldest entry
            const firstKey = frameCache.keys().next().value;
            if (firstKey !== undefined) {
              frameCache.delete(firstKey);
            }
          }
          frameCache.set(frameNumber, img);
          resolve(img);
        };
        img.onerror = () => {
          reject(new Error(`Failed to load frame ${frameNumber}`));
        };
        img.src = getFrameUrl(frameNumber);
      });
    }

    /**
     * Render a frame to the canvas
     */
    async function renderFrame(frameNumber: number) {
      try {
        const img = await loadFrame(frameNumber);

        if (frameCanvas.width !== img.width || frameCanvas.height !== img.height) {
          frameCanvas.width = img.width;
          frameCanvas.height = img.height;
        }

        if (frameCtx) {
          frameCtx.drawImage(img, 0, 0);
        }

        // Update the geojs quad feature
        if (geoViewer.value) {
          geoViewer.value.scheduleAnimationFrame(() => {
            geoViewer.value.draw();
          });
        }
      } catch (err) {
        console.error(`Failed to render frame ${frameNumber}:`, err);
      }
    }

    /**
     * Prefetch frames around the current frame for smoother navigation
     */
    function prefetchFrames(centerFrame: number, range: number = 3) {
      for (let i = -range; i <= range; i += 1) {
        const frame = centerFrame + i;
        if (frame >= 0 && frame <= data.maxFrame && !frameCache.has(frame)) {
          // Load in background, don't await
          loadFrame(frame).catch(() => {});
        }
      }
    }

    /**
     * Seek to a specific frame
     */
    async function seek(frame: number) {
      const requestedFrame = Math.round(frame);
      if (requestedFrame < 0 || requestedFrame > data.maxFrame) {
        return;
      }

      data.frame = requestedFrame;
      data.currentTime = requestedFrame / props.frameRate;
      data.flick = Math.round(data.currentTime * Flick);
      data.syncedFrame = requestedFrame;

      await renderFrame(requestedFrame);
      prefetchFrames(requestedFrame);

      props.updateTime(data);
    }

    /**
     * Pause playback
     */
    function pause() {
      isPlaying.value = false;
      if (playbackInterval !== null) {
        clearInterval(playbackInterval);
        playbackInterval = null;
      }
      data.playing = false;
      props.updateTime(data);
    }

    /**
     * Start playback
     * Note: Playback will be slower than real-time due to frame extraction overhead.
     * This is intended for frame-by-frame annotation work, not smooth video playback.
     */
    async function play() {
      if (isPlaying.value) return;

      isPlaying.value = true;
      data.playing = true;
      props.updateTime(data);

      // Calculate frame interval based on desired framerate
      // We use a slower rate to account for frame extraction time
      const targetInterval = Math.max(100, 1000 / props.frameRate);

      playbackInterval = window.setInterval(async () => {
        if (!isPlaying.value) return;

        const nextFrame = data.frame + 1;
        if (nextFrame > data.maxFrame) {
          pause();
          return;
        }

        data.frame = nextFrame;
        data.currentTime = nextFrame / props.frameRate;
        data.flick = Math.round(data.currentTime * Flick);
        data.syncedFrame = nextFrame;

        await renderFrame(nextFrame);
        prefetchFrames(nextFrame, 5);

        props.updateTime(data);
      }, targetInterval);
    }

    function setVolume(level: number) {
      // No audio support for native video playback
      data.volume = level;
    }

    function setSpeed(level: number) {
      // Speed control not implemented for native playback
      data.speed = level;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let quadFeatureLayer = undefined as any;

    watch(
      () => props.isDefaultImage,
      (newVal) => {
        if (quadFeatureLayer !== undefined) {
          if (newVal) {
            quadFeatureLayer.node().css('filter', '');
          } else {
            quadFeatureLayer.node().css('filter', 'url(#imageEhancements)');
          }
        }
      },
      { deep: true },
    );

    /**
     * Initialize the viewer once video info is loaded
     */
    async function initialize() {
      await getApiBaseUrl();
      await loadVideoInfo();

      if (!videoInfo.value) {
        throw new Error('Failed to load video info');
      }

      const { width, height, frameCount } = videoInfo.value;

      // Set canvas size
      frameCanvas.width = width;
      frameCanvas.height = height;

      // Calculate max frame
      const fps = videoInfo.value.fps || props.originalFps || props.frameRate;
      data.maxFrame = Math.max(0, frameCount - 1);
      data.duration = frameCount / fps;

      // Initialize geojs viewer
      initializeViewer(width, height);

      // Create quad feature layer with the canvas as the source
      quadFeatureLayer = geoViewer.value.createLayer('feature', {
        features: ['quad'],
        autoshareRenderer: false,
      });

      quadFeatureLayer
        .createFeature('quad')
        .data([
          {
            ul: { x: 0, y: 0 },
            lr: { x: width, y: height },
            image: frameCanvas,
          },
        ])
        .draw();

      // Load and render first frame
      await seek(0);

      if (!props.isDefaultImage) {
        quadFeatureLayer.node().css('filter', 'url(#imageEhancements)');
      }

      data.ready = true;
      data.volume = 0;
      data.speed = 1;
    }

    // Initialize on mount
    initialize().catch((err) => {
      console.error('Failed to initialize NativeVideoAnnotator:', err);
    });

    onBeforeUnmount(() => {
      pause();
      frameCache.clear();
    });

    return {
      data,
      imageCursorRef: imageCursor,
      containerRef: container,
      cursorHandler,
      mediaController,
    };
  },
});
</script>

<template>
  <div class="video-annotator native-video-annotator" :style="{ cursor: data.cursor }">
    <svg width="0" height="0" style="position: absolute; top: -1px; left: -1px">
      <defs>
        <filter id="imageEhancements">
          <feComponentTransfer id="feBrightness">
            <feFuncR
              type="linear"
              :slope="imageEnhancementOutputs.brightness.slope"
              :intercept="imageEnhancementOutputs.brightness.intercept"
            />
            <feFuncG
              type="linear"
              :slope="imageEnhancementOutputs.brightness.slope"
              :intercept="imageEnhancementOutputs.brightness.intercept"
            />
            <feFuncB
              type="linear"
              :slope="imageEnhancementOutputs.brightness.slope"
              :intercept="imageEnhancementOutputs.brightness.intercept"
            />
          </feComponentTransfer>
          <!-- Contrast -->
          <feComponentTransfer id="feContrast">
            <feFuncR
              type="linear"
              :slope="imageEnhancementOutputs.contrast.slope"
              :intercept="imageEnhancementOutputs.contrast.intercept"
            />
            <feFuncG
              type="linear"
              :slope="imageEnhancementOutputs.contrast.slope"
              :intercept="imageEnhancementOutputs.contrast.intercept"
            />
            <feFuncB
              type="linear"
              :slope="imageEnhancementOutputs.contrast.slope"
              :intercept="imageEnhancementOutputs.contrast.intercept"
            />
          </feComponentTransfer>
          <!-- Saturation -->
          <feColorMatrix
            id="feSaturate"
            type="saturate"
            :values="imageEnhancementOutputs.saturation.values.toString()"
          />
          <!-- Sharpening -->
          <feConvolveMatrix
            id="feSharpen"
            order="3"
            :divisor="imageEnhancementOutputs.sharpen.divisor"
            :kernelMatrix="imageEnhancementOutputs.sharpen.kernelMatrix"
            edgeMode="duplicate"
          />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
      </defs>
    </svg>
    <div ref="imageCursorRef" class="imageCursor">
      <v-icon> {{ data.imageCursor }} </v-icon>
    </div>
    <div
      ref="containerRef"
      class="playback-container"
      @mousemove="cursorHandler.handleMouseMove"
      @mouseleave="cursorHandler.handleMouseLeave"
      @mouseover="cursorHandler.handleMouseEnter"
    />
    <slot name="control" />
    <slot v-if="data.ready" />
  </div>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";

.native-video-annotator {
  // Indicator that this is using native playback
  &::after {
    content: "Native";
    position: absolute;
    top: 4px;
    right: 4px;
    background: rgba(0, 0, 0, 0.6);
    color: #4caf50;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: bold;
    z-index: 100;
    pointer-events: none;
  }
}
</style>
