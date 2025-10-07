<script lang="ts">
import {
  defineComponent, ref, onUnmounted, PropType, toRef, watch,
} from 'vue';
import geo from 'geojs';
import { ImageEnhancementOutputs } from 'vue-media-annotator/use/useImageEnhancements';
import { SetTimeFunc } from '../../use/useTimeObserver';
import { injectCameraInitializer } from './useMediaController';

export interface LargeImageDataItem {
  url: string;
  id: string;
  filename: string;
}
interface ImageDataItemInternal extends LargeImageDataItem {
  image: HTMLImageElement;
  cached: boolean; // true if onloadPromise has resolved
  frame: number; // frame number this image belongs to
  onloadPromise: Promise<boolean>;
}
function loadImageFunc(imageDataItem: LargeImageDataItem, img: HTMLImageElement) {
  // eslint-disable-next-line no-param-reassign
  img.src = imageDataItem.url;
}
export default defineComponent({
  name: 'LargeImageAnnotator',
  props: {
    imageData: {
      type: Array as PropType<LargeImageDataItem[]>,
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
    loadImageFunc: {
      type: Function as PropType<
      (imageDataItem: LargeImageDataItem, img: HTMLImageElement) => void>,
      default: loadImageFunc,
    },
    // Range is [0, inf.)
    brightness: {
      type: Number as PropType<number | undefined>,
      default: undefined,
    },
    camera: {
      type: String as PropType<string>,
      default: 'singleCam',
    },
    intercept: {
      type: Number as PropType<number | undefined>,
      default: undefined,
    },
    getTiles: {
      type: Function as PropType<
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (itemId: string, projection?: string) => Promise<Record<string, any>>>,
      required: true,
    },
    getTileURL: {
      type: Function as PropType<
      (itemId: string, x: number, y: number,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
      level: number, query: Record<string, any>) => string>,
      required: true,
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
  },
  setup(props) {
    const loadingVideo = ref(false);
    const loadingImage = ref(true);
    const cameraInitializer = injectCameraInitializer();
    // eslint-disable-next-line prefer-const
    let geoSpatial = false;
    const {
      state: data,
      geoViewer,
      cursorHandler,
      imageCursor,
      container,
      initializeViewer,
      mediaController,
    } = cameraInitializer(props.camera, {
      // allow hoisting for these functions to pass a reference before defining them.
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      seek, pause, play, setVolume: unimplemented, setSpeed: unimplemented,
    });
    let projection: string | undefined;
    data.maxFrame = props.imageData.length - 1;
    // Below are configuration settings we can set until we decide on good numbers to utilize.
    let local = {
      playCache: 1, // seconds required to be fully cached before playback
      cacheSeconds: 6, // seconds to cache from the current frame
      frontBackRatio: 0.9, // 90% forward frames, 10% backward frames when caching
      imgs: new Array<ImageDataItemInternal | undefined>(props.imageData.length),
      pendingImgs: new Set<ImageDataItemInternal>(),
      lastFrame: -1,
      width: 0,
      height: 0,
      levels: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: '' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: '' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentLayer: '' as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      nextLayer: '' as any,
      nextLayerFrame: 0,
    };
    function forceUnload(imgInternal: ImageDataItemInternal) {
      // Removal from list indicates we are no longer attempting to load this image
      local.imgs[imgInternal.frame] = undefined;
      // unset src to cancel outstanding load request
      // eslint-disable-next-line no-param-reassign
      imgInternal.image.src = '';
      local.pendingImgs.delete(imgInternal);
    }
    function _getTileURL(itemId: string, proj?: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const returnFunc = (level: number, x: number, y: number, params: any) => {
        const updatedParams = { ...params, encoding: 'PNG' };
        if (proj) {
          updatedParams.projection = proj;
        }
        return props.getTileURL(itemId, level, x, y, updatedParams);
      };
      return returnFunc;
    }
    async function cacheFrame(frame: number) {
      // eslint-disable-next-line no-unreachable
      const resp2 = await props.getTiles(props.imageData[frame].id, projection);
      const newParams = geo.util.pixelCoordinateParams(
        container.value,
        resp2.sizeX,
        resp2.sizeY,
        resp2.tileWidth,
        resp2.tileHeight,
      );
      local.nextLayer._options.maxLevel = newParams.layer.maxLevel;
      local.nextLayer._options.tileWidth = newParams.layer.tileWidth;
      local.nextLayer._options.tileHeight = newParams.layer.tileWidth;
      local.nextLayer._options.tilesAtZoom = newParams.layer.tilesAtZoom;
      local.nextLayer._options.tilesMaxBounds = newParams.layer.tilesMaxBounds;
      local.nextLayer.url(_getTileURL(props.imageData[frame].id));
      local.nextLayerFrame = frame;
    }
    /**
     * When the component is unmounted, cancel all outstanding
     * requests for image load.
     */
    onUnmounted(() => Array.from(local.pendingImgs).forEach(forceUnload));
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
      // For faster swapping between loaded large images we swap two layers.
      if (local.nextLayer) {
        if (local.nextLayerFrame === newFrame) {
          local.currentLayer.moveDown();
          local.currentLayer.opacity(0);
          const ltemp = local.currentLayer;
          local.currentLayer = local.nextLayer;
          local.currentLayer.opacity(1.0);
          loadingImage.value = false;
          local.nextLayer = ltemp;
          if (props.imageData[newFrame + 1]) {
            cacheFrame(newFrame + 1);
          }
        } else {
          geoViewer.value.onIdle(async () => {
            loadingImage.value = true;
            const resp2 = await props.getTiles(props.imageData[newFrame].id, projection);
            const newParams = geo.util.pixelCoordinateParams(
              container.value,
              resp2.sizeX,
              resp2.sizeY,
              resp2.tileWidth,
              resp2.tileHeight,
            );
            geoViewer.value.onIdle(() => {
              local.currentLayer._options.maxLevel = newParams.layer.maxLevel;
              local.currentLayer._options.tileWidth = newParams.layer.tileWidth;
              local.currentLayer._options.tileHeight = newParams.layer.tileWidth;
              local.currentLayer._options.tilesAtZoom = newParams.layer.tilesAtZoom;
              local.currentLayer._options.tilesMaxBounds = newParams.layer.tilesMaxBounds;
              local.currentLayer.url(_getTileURL(props.imageData[newFrame].id));
              loadingImage.value = false;
              // If there is another frame we begin loading it with the current position/zoom level
              loadingImage.value = false;
              if (props.imageData[newFrame + 1]) {
                cacheFrame(newFrame + 1);
              }
            });
          });
        }
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
        seek(nextFrame);
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
    function unimplemented() {
      throw new Error('Method unimplemented!');
    }

    watch(
      () => props.isDefaultImage,
      () => {
        if (local.currentLayer !== undefined) {
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
      data.maxFrame = props.imageData.length - 1;
      // Below are configuration settings we can set until we decide on good numbers to utilize.
      local = {
        playCache: 1, // seconds required to be fully cached before playback
        cacheSeconds: 6, // seconds to cache from the current frame
        frontBackRatio: 0.9, // 90% forward frames, 10% backward frames when caching
        imgs: new Array<ImageDataItemInternal | undefined>(props.imageData.length),
        pendingImgs: new Set<ImageDataItemInternal>(),
        lastFrame: -1,
        width: 0,
        height: 0,
        levels: 0,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: '' as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        params: '' as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        currentLayer: '' as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        nextLayer: false as any,
        nextLayerFrame: 0,
      };
      // If you uncomment below it will load the geoSpatial coordinates and a OSM layer map
      //This doesn't account for annotations being in image space vs geospatial.
      //const baseData = await props.getTiles(props.imageData[data.frame].id);
      //geoSpatial = !(!baseData.geospatial || !baseData.bounds);
      projection = geoSpatial ? 'EPSG:3857' : undefined;
      const resp = await props.getTiles(props.imageData[data.frame].id, projection);
      local.levels = resp.levels;
      local.width = resp.sizeX;
      local.height = resp.sizeY;
      local.metadata = resp;
      local.params = {
        keepLower: false,
        attribution: null,
        url: _getTileURL(props.imageData[data.frame].id, projection),
        useCredentials: true,
        maxLevel: resp.levels + 3,
        autoshareRenderer: false,
      };
      if (props.imageData.length) {
        if (geoSpatial) {
          initializeViewer(
            local.metadata.sourceSizeX,
            local.metadata.sourceSizeY,
            local.metadata.tileWidth,
            local.metadata.tileHeight,
            true,
            geoSpatial,
          );
        } else {
          initializeViewer(
            local.width,
            local.height,
            local.metadata.tileWidth,
            local.metadata.tileHeight,
            true,
            geoSpatial,
          );
          // Need to set up the params using pixelCoorindateParams here instead of in useMediaViewer
          local.params = geo.util.pixelCoordinateParams(
            container.value,
            local.width,
            local.height,
            local.metadata.tileWidth,
            local.metadata.tileHeight,
          );
          local.params.layer.useCredentials = true;
          local.params.layer.autoshareRenderer = false;
          local.params.layer.url = _getTileURL(props.imageData[data.frame].id);
        }

        if (geoSpatial) {
          geoViewer.value.bounds({
            left: local.metadata.bounds.xmin,
            right: local.metadata.bounds.xmax,
            top: local.metadata.bounds.ymax,
            bottom: local.metadata.bounds.ymin,
          }, projection);
          geoViewer.value.createLayer('osm'); // create background layer
          geoViewer.value.zoomRange({
            min: geoViewer.value.origMin,
            max: geoViewer.value.zoomRange().max + 3,
          });
        }
        // Set to canvas mode if the tiles are larger than the largest texture
        if (local.metadata.tileWidth > 8192 || local.metadata.tileWidth > 8192) {
          local.params.renderer = 'canvas';
        }

        // Params are differnt between geoSpatial and non
        const localParams = geoSpatial ? local.params : local.params.layer;
        local.currentLayer = geoViewer.value.createLayer('osm', localParams);
        // Set the next layer to pre load
        if (!local.nextLayer && props.imageData.length > 1) {
          const resp2 = await props.getTiles(props.imageData[data.frame + 1].id, projection);

          const newParams = geo.util.pixelCoordinateParams(
            container.value,
            resp2.sizeX,
            resp2.sizeY,
            resp2.tileWidth,
            resp2.tileHeight,
          );
          local.nextLayer = geoViewer.value.createLayer('osm', newParams.layer);
          local.nextLayer._options.maxLevel = newParams.layer.maxLevel;
          local.nextLayer._options.tileWidth = newParams.layer.tileWidth;
          local.nextLayer._options.tileHeight = newParams.layer.tileWidth;
          local.nextLayer._options.tilesAtZoom = newParams.layer.tilesAtZoom;
          local.nextLayer._options.tilesMaxBounds = newParams.layer.tilesMaxBounds;
          local.nextLayer.url(_getTileURL(props.imageData[data.frame + 1].id, projection));
          local.nextLayer.moveDown();
          local.nextLayerFrame = data.frame + 1;
        }

        local.currentLayer.url(
          _getTileURL(
            props.imageData[data.frame].id,
            projection,
          ),
        );
        // Set quadFeature and conditionally apply brightness filter
        if (!props.isDefaultImage) {
          local.currentLayer.node().css('filter', 'url(#imageEhancements)');
        }
        data.ready = true;
        loadingVideo.value = false;
        loadingImage.value = false;
        seek(0);
      }
    }
    // Watch imageData for change
    watch(toRef(props, 'imageData'), () => {
      init();
    });
    // Watch brightness for change, only set filter if value
    // is switching from number -> undefined, or vice versa.
    init();
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
@import "./annotator.scss";
</style>
