<script lang="ts">
import {
  defineComponent, ref, onUnmounted, PropType, toRef, watch, onMounted,
} from 'vue';
import geo, { GeoViewer } from 'geojs';
import { ImageEnhancementOutputs } from 'vue-media-annotator/use/useImageEnhancements';
import { SetTimeFunc } from 'vue-media-annotator/use/useTimeObserver';
import { injectCameraInitializer } from 'vue-media-annotator/components/annotators/useMediaController';
import { ClientTileService, getClientTileService } from '../services/ClientTileService';
import { DEFAULT_TILE_SIZE, TileMetadata } from 'platform/desktop/constants';

export interface DesktopLargeImageDataItem {
  url: string;
  filename: string;
  path: string; // Absolute path for desktop
}

export default defineComponent({
  name: 'DesktopLargeImageAnnotator',
  props: {
    imageData: {
      type: Array as PropType<DesktopLargeImageDataItem[]>,
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
      type: Boolean as PropType<boolean>,
      required: true,
    },
    baseUrl: {
      type: String,
      required: true,
    },
  },
  setup(props, { emit }) {
    const loadingVideo = ref(false);
    const loadingImage = ref(true);
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
      seek, pause, play, setVolume: unimplemented, setSpeed: unimplemented,
    });

    let tileService: ClientTileService;
    let local = {
      currentLayer: null as ReturnType<GeoViewer['createLayer']> | null,
      nextLayer: null as ReturnType<GeoViewer['createLayer']> | null,
      nextLayerFrame: -1,
      metadata: null as TileMetadata | null,
      lastFrame: -1,
    };

    data.maxFrame = props.imageData.length - 1;

    function unimplemented() {
      throw new Error('Method unimplemented!');
    }

    async function loadTileMetadata(frame: number): Promise<TileMetadata> {
      const imageItem = props.imageData[frame];
      // Extract path from URL query parameter
      const url = new URL(imageItem.url);
      const imagePath = url.searchParams.get('path') || imageItem.path || '';
      const imageId = `frame-${frame}`;
      return tileService.getTiles(imageId, imagePath);
    }

    function createTileLayer(
      metadata: TileMetadata,
      frame: number,
    ): ReturnType<GeoViewer['createLayer']> {
      const imageId = `frame-${frame}`;
      const params = geo.util.pixelCoordinateParams(
        container.value,
        metadata.sizeX,
        metadata.sizeY,
        metadata.tileWidth,
        metadata.tileHeight,
      );

      // Create async tile URL function
      const tileUrlFunc = async (level: number, x: number, y: number): Promise<string> => {
        try {
          return await tileService.getTile(imageId, level, x, y);
        } catch (e) {
          console.error('Tile load error:', e);
          return '';
        }
      };

      // For GeoJS, we need to create a custom tile layer
      // Use quad feature layer with async loading instead of OSM
      const layerParams = {
        ...params.layer,
        autoshareRenderer: false,
        renderer: metadata.tileWidth > 8192 || metadata.tileHeight > 8192 ? 'canvas' : undefined,
        url: tileUrlFunc,
        useCredentials: false,
      };

      const layer = geoViewer.value.createLayer('osm', layerParams);
      return layer;
    }

    async function setupCurrentFrame(frame: number) {
      const metadata = await loadTileMetadata(frame);
      local.metadata = metadata;

      // Initialize viewer with image dimensions
      initializeViewer(
        metadata.sizeX,
        metadata.sizeY,
        metadata.tileWidth,
        metadata.tileHeight,
        true,
        false,
      );

      // Create the tile layer
      const imageId = `frame-${frame}`;
      const imageItem = props.imageData[frame];
      const url = new URL(imageItem.url);
      const imagePath = url.searchParams.get('path') || '';

      // Initialize image in tile service
      await tileService.initImage(imageId, imagePath);

      const params = geo.util.pixelCoordinateParams(
        container.value,
        metadata.sizeX,
        metadata.sizeY,
        metadata.tileWidth,
        metadata.tileHeight,
      );

      // Create layer with async URL function
      const layerParams = {
        ...params.layer,
        keepLower: false,
        attribution: null,
        autoshareRenderer: false,
        useCredentials: false,
        url: async (level: number, x: number, y: number) => {
          try {
            return await tileService.getTile(imageId, level, x, y);
          } catch (e) {
            console.error('Tile error:', e);
            return '';
          }
        },
      };

      // Set canvas renderer for very large tiles
      if (metadata.tileWidth > 8192 || metadata.tileHeight > 8192) {
        (layerParams as Record<string, unknown>).renderer = 'canvas';
      }

      local.currentLayer = geoViewer.value.createLayer('osm', layerParams);

      // Apply image enhancement filter if needed
      if (!props.isDefaultImage && local.currentLayer) {
        local.currentLayer.node().css('filter', 'url(#imageEhancements)');
      }

      return metadata;
    }

    async function prefetchNextFrame(nextFrame: number) {
      if (nextFrame >= props.imageData.length || nextFrame < 0) {
        return;
      }

      const imageId = `frame-${nextFrame}`;
      const imageItem = props.imageData[nextFrame];
      const url = new URL(imageItem.url);
      const imagePath = url.searchParams.get('path') || '';

      try {
        // Pre-initialize the next image
        await tileService.initImage(imageId, imagePath);
        local.nextLayerFrame = nextFrame;
      } catch (e) {
        console.error('Failed to prefetch frame:', e);
      }
    }

    async function seek(f: number) {
      if (!data.ready) {
        return;
      }

      let newFrame = f;
      if (f < 0) newFrame = 0;
      if (f > data.maxFrame) newFrame = data.maxFrame;

      local.lastFrame = data.frame;
      data.frame = newFrame;
      data.syncedFrame = newFrame;
      data.filename = props.imageData[data.frame].filename;

      if (data.frame !== 0 && local.lastFrame === data.frame) {
        return;
      }

      if (props.imageData.length > 1) {
        loadingImage.value = true;
      }

      props.updateTime(data);

      // Update tile layer URL for new frame
      if (local.currentLayer && local.metadata) {
        const imageId = `frame-${newFrame}`;
        const imageItem = props.imageData[newFrame];
        const url = new URL(imageItem.url);
        const imagePath = url.searchParams.get('path') || '';

        // Initialize new frame's image
        await tileService.initImage(imageId, imagePath);

        // Update layer URL
        local.currentLayer.url(async (level: number, x: number, y: number) => {
          try {
            return await tileService.getTile(imageId, level, x, y);
          } catch (e) {
            return '';
          }
        });

        // Clear cache for old frame if memory constrained
        if (local.lastFrame >= 0 && local.lastFrame !== newFrame) {
          const oldImageId = `frame-${local.lastFrame}`;
          // Only clear if we have many frames to prevent thrashing
          if (props.imageData.length > 10) {
            tileService.clearImageCache(oldImageId);
          }
        }

        loadingImage.value = false;

        // Prefetch next frame
        prefetchNextFrame(newFrame + 1);
      }
    }

    function pause() {
      data.playing = false;
      loadingVideo.value = false;
    }

    async function syncWithVideo(nextFrame: number): Promise<void> {
      if (data.playing) {
        if (nextFrame > data.maxFrame) {
          return pause();
        }
        await seek(nextFrame);
        setTimeout(() => syncWithVideo(data.frame + 1), 1000 / props.frameRate);
      }
      return undefined;
    }

    async function play() {
      try {
        data.playing = true;
        syncWithVideo(data.frame + 1);
      } catch (ex) {
        console.error(ex);
      }
    }

    watch(
      () => props.isDefaultImage,
      () => {
        if (local.currentLayer !== null) {
          if (props.isDefaultImage) {
            local.currentLayer.node().css('filter', '');
          } else {
            local.currentLayer.node().css('filter', 'url(#imageEhancements)');
          }
        }
      },
      { deep: true },
    );

    async function init() {
      tileService = getClientTileService(props.baseUrl);
      data.maxFrame = props.imageData.length - 1;

      local = {
        currentLayer: null,
        nextLayer: null,
        nextLayerFrame: -1,
        metadata: null,
        lastFrame: -1,
      };

      if (props.imageData.length) {
        try {
          await setupCurrentFrame(0);
          data.ready = true;
          loadingVideo.value = false;
          loadingImage.value = false;

          // Prefetch next frame
          if (props.imageData.length > 1) {
            prefetchNextFrame(1);
          }
        } catch (e) {
          console.error('Failed to initialize large image viewer:', e);
          emit('error', e);
        }
      }
    }

    watch(toRef(props, 'imageData'), () => {
      init();
    });

    onMounted(() => {
      init();
    });

    onUnmounted(() => {
      // Clean up tile cache for all frames
      for (let i = 0; i < props.imageData.length; i += 1) {
        tileService?.clearImageCache(`frame-${i}`);
      }
    });

    return {
      data,
      loadingVideo,
      loadingImage,
      imageCursorRef: imageCursor,
      containerRef: container,
      cursorHandler,
      mediaController,
    };
  },
});
</script>

<template>
  <div class="video-annotator">
    <svg
      width="0"
      height="0"
      style="position: absolute; top: -1px; left: -1px"
    >
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
    <div
      ref="imageCursorRef"
      class="imageCursor"
    >
      <v-icon> {{ data.imageCursor }} </v-icon>
    </div>
    <div
      ref="containerRef"
      class="playback-container"
      :style="{ cursor: data.cursor }"
      @mousemove="cursorHandler.handleMouseMove"
      @mouseleave="cursorHandler.handleMouseLeave"
      @mouseover="cursorHandler.handleMouseEnter"
    >
      <div class="loadingSpinnerContainer">
        <v-progress-circular
          v-if="loadingVideo || loadingImage"
          class="loadingSpinner"
          indeterminate
          size="100"
          width="15"
          color="light-blue"
        >
          Loading
        </v-progress-circular>
      </div>
    </div>
    <slot v-if="data.ready" />
  </div>
</template>

<style lang="scss" scoped>
@import "vue-media-annotator/components/annotators/annotator.scss";
</style>
