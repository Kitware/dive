<script lang="ts">
import {
  defineComponent, ref, onUnmounted, PropType, toRef, watch,
} from '@vue/composition-api';
import { getTileURL, getTiles } from 'platform/web-girder/api/largeImage.service';
import geo from 'geojs';
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
    }); let projection: string | undefined;

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
        return getTileURL(itemId, level, x, y, updatedParams);
      };
      return returnFunc;
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
      props.updateTime(data);
      // For faster swapping between loaded large images we swap two layers.
      if (local.nextLayer) {
        geoViewer.value.onIdle(async () => {
          local.nextLayer.url(_getTileURL(props.imageData[newFrame].id, projection));
          geoViewer.value.onIdle(() => {
            // Move the current layer down and set the next layer to the current layer.
            local.currentLayer.moveDown();
            const ltemp = local.currentLayer;
            local.currentLayer = local.nextLayer;
            local.nextLayer = ltemp;
            // If there is another frame we begin loading it with the current position/zoom level
            if (props.imageData[newFrame + 1]) {
              local.nextLayer.url(_getTileURL(props.imageData[newFrame + 1].id, projection));
              local.nextLayer.prefetch(
                Math.round(geoViewer.value.zoom()),
                geoViewer.value.bounds(),
              );
            }
          });
        });
      }
    }
    function pause() {
      data.playing = false;
      loadingVideo.value = false;
    }
    async function play() {
      try {
        data.playing = true;
      } catch (ex) {
        console.error(ex);
      }
    }
    function unimplemented() {
      throw new Error('Method unimplemented!');
    }

    const setBrightnessFilter = (on: boolean) => {
      if (local.currentLayer !== undefined) {
        local.currentLayer.node().css('filter', on ? 'url(#brightness)' : '');
      }
    };
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
      };
      // If you uncomment below it will load the geoSpatial coordinates and a OSM layer map
      //const baseData = await getTiles(props.imageData[data.frame].id);
      //geoSpatial = !(!baseData.geospatial || !baseData.bounds);
      projection = geoSpatial ? 'EPSG:3857' : undefined;
      const resp = await getTiles(props.imageData[data.frame].id, projection);
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
          initializeViewer(local.metadata.sourceSizeX, local.metadata.sourceSizeY,
            local.metadata.tileWidth, local.metadata.tileHeight,
            true, geoSpatial);
        } else {
          initializeViewer(local.width, local.height,
            local.metadata.tileWidth, local.metadata.tileHeight, true, geoSpatial);
          // Need to set up the params using pixelCoorindateParams here instead of in useMediaViewer
          local.params = geo.util.pixelCoordinateParams(
            container.value, local.width, local.height,
            local.metadata.tileWidth, local.metadata.tileHeight,
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
          }, 'EPSG:3857');
          geoViewer.value.createLayer('osm');
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
          localParams.url = _getTileURL(props.imageData[data.frame + 1].id, projection);
          local.nextLayer = geoViewer.value.createLayer('osm', localParams);
          local.nextLayer.url(_getTileURL(props.imageData[data.frame + 1].id, projection));
          local.nextLayer.moveDown();
        }

        local.currentLayer.url(
          _getTileURL(props.imageData[data.frame].id,
            projection),
        );
        // Set quadFeature and conditionally apply brightness filter
        setBrightnessFilter(props.brightness !== undefined);

        data.ready = true;
        loadingVideo.value = false;
        loadingImage.value = false;
      }
    }
    // Watch imageData for change
    watch(toRef(props, 'imageData'), () => {
      init();
    });
    // Watch brightness for change, only set filter if value
    // is switching from number -> undefined, or vice versa.
    watch(toRef(props, 'brightness'), (brightness, oldBrightness) => {
      if ((brightness === undefined) !== (oldBrightness === undefined)) {
        setBrightnessFilter(brightness !== undefined);
      }
    });
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
        <filter id="brightness">
          <feComponentTransfer color-interpolation-filters="sRGB">
            <feFuncR
              type="linear"
              :slope="brightness"
              :intercept="intercept"
            />
            <feFuncG
              type="linear"
              :slope="brightness"
              :intercept="intercept"
            />
            <feFuncB
              type="linear"
              :slope="brightness"
              :intercept="intercept"
            />
          </feComponentTransfer>
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
