<script lang="ts">
import {
  defineComponent, onBeforeUnmount, PropType, ref, watch,
} from 'vue';
// eslint-disable-next-line import/no-extraneous-dependencies
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

    // Canvas for dimension tracking
    const frameCanvas = document.createElement('canvas');

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
      // Use annotation frame rate since frameNumber is an annotation frame number.
      // timestamp = frameNumber / annotationFps gives the correct time in the video.
      return `${baseApiUrl}/frame?path=${encodeURIComponent(props.nativeVideoPath)}&frame=${frameNumber}&fps=${props.frameRate}`;
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
     * Load a batch of consecutive frames in a single request.
     * More efficient than loading frames individually.
     * When originalFps differs from frameRate, uses FFmpeg select filter for efficiency.
     */
    async function loadFrameBatch(
      startFrame: number,
      count: number,
    ): Promise<Map<number, HTMLImageElement>> {
      const result = new Map<number, HTMLImageElement>();
      const framesToFetch: number[] = [];

      // Check which frames we need to fetch
      for (let i = 0; i < count; i += 1) {
        const frameNum = startFrame + i;
        if (frameNum >= 0 && frameNum <= data.maxFrame) {
          const cached = frameCache.get(frameNum);
          if (cached) {
            result.set(frameNum, cached);
          } else {
            framesToFetch.push(frameNum);
          }
        }
      }

      // If all frames are cached, return early
      if (framesToFetch.length === 0) {
        return result;
      }

      const actualStart = framesToFetch[0];
      const actualCount = framesToFetch[framesToFetch.length - 1] - actualStart + 1;

      // fps = annotation frame rate (for calculating timestamp from annotation frame number)
      // originalFps = video's native fps (for select filter when downsampling)
      const videoFps = videoInfo.value?.fps || props.originalFps;

      // Build URL - pass annotation frameRate and optionally the video's originalFps
      let url = `${baseApiUrl}/frames-batch?path=${encodeURIComponent(props.nativeVideoPath)}&startFrame=${actualStart}&count=${actualCount}&fps=${props.frameRate}`;
      if (videoFps && videoFps > props.frameRate) {
        url += `&originalFps=${videoFps}`;
      }

      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to fetch frame batch: ${response.statusText}`);
        }

        const json = await response.json();
        const { frames } = json as { frames: Record<string, string> };

        // Convert base64 frames to images and cache them
        const loadPromises = Object.entries(frames).map(
          ([frameNumStr, base64Data]) => new Promise<void>((resolve) => {
            const frameNum = parseInt(frameNumStr, 10);
            const img = new Image();
            img.onload = () => {
              // Add to cache
              if (frameCache.size >= MAX_CACHE_SIZE) {
                const firstKey = frameCache.keys().next().value;
                if (firstKey !== undefined) {
                  frameCache.delete(firstKey);
                }
              }
              frameCache.set(frameNum, img);
              result.set(frameNum, img);
              resolve();
            };
            img.onerror = () => {
              resolve(); // Don't fail the whole batch
            };
            img.src = `data:image/jpeg;base64,${base64Data}`;
          }),
        );

        await Promise.all(loadPromises);
      } catch (err) {
        console.error('Failed to load frame batch:', err);
        // Fall back to individual loading for any missing frames
        await Promise.all(
          framesToFetch
            .filter((f) => !result.has(f))
            .map((f) => loadFrame(f).then((img) => result.set(f, img)).catch(() => {})),
        );
      }

      return result;
    }

    /**
     * Render a frame to the quad feature
     */
    async function renderFrame(frameNumber: number) {
      try {
        const img = await loadFrame(frameNumber);

        // Update canvas dimensions if needed
        if (frameCanvas.width !== img.width || frameCanvas.height !== img.height) {
          frameCanvas.width = img.width;
          frameCanvas.height = img.height;
        }

        // Update the geojs quad feature with the new image
        if (quadFeature) {
          quadFeature
            .data([
              {
                ul: { x: 0, y: 0 },
                lr: { x: img.width, y: img.height },
                image: img,
              },
            ])
            .draw();
        }
      } catch (err) {
        console.error(`Failed to render frame ${frameNumber}:`, err);
      }
    }

    /**
     * Prefetch frames around the current frame for smoother navigation.
     * Uses batch loading for efficiency.
     */
    function prefetchFrames(centerFrame: number, range: number = 3) {
      // Calculate the range of frames to prefetch
      const startFrame = Math.max(0, centerFrame - range);
      const endFrame = Math.min(data.maxFrame, centerFrame + range);
      const count = endFrame - startFrame + 1;

      // Use batch loading in background
      loadFrameBatch(startFrame, count).catch(() => {});
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

      // Pre-load the next batch of frames before starting playback
      const PREFETCH_BATCH_SIZE = 15;
      await loadFrameBatch(data.frame, PREFETCH_BATCH_SIZE);

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

        // Prefetch ahead during playback using batch loading
        prefetchFrames(nextFrame, PREFETCH_BATCH_SIZE);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let quadFeature = undefined as any;

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

      // Create quad feature layer for rendering frames
      quadFeatureLayer = geoViewer.value.createLayer('feature', {
        features: ['quad'],
        autoshareRenderer: false,
        renderer: 'canvas',
      });

      quadFeature = quadFeatureLayer.createFeature('quad');
      quadFeature
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
