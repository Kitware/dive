<script lang="ts">
import {
  defineComponent, ref, onUnmounted, PropType, toRef, watch,
} from '@vue/composition-api';
import { getTileURL, getTiles } from 'platform/web-girder/api/largeImage.service';
import geo from 'geojs';
import { SetTimeFunc } from '../../use/useTimeObserver';
import useMediaController from './useMediaController';

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
    const commonMedia = useMediaController();
    const { data } = commonMedia;

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
    function _getTileURL(itemId: string) {
      const returnFunc = (level: number, x: number, y: number, params: any) => {
        const updatedParams = { ...params, encoding: 'PNG', projection: 'EPSG:3857' };
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
      commonMedia.geoViewerRef.value.onIdle(() => {
        local.currentLayer.url(_getTileURL(props.imageData[newFrame].id));
        // commonMedia.geoViewerRef.value.onIdle(() => {
        //   if (local && local.imgs !== undefined && props.imageData[newFrame]) {
        //     local.currentLayer.moveDown();
        //     const ltemp = local.currentLayer;
        //     local.currentLayer = local.nextLayer;
        //     local.nextLayer = ltemp;
        //     if (local.imgs[newFrame + 1]) {
        //       local.nextLayer.url(_getTileURL(props.imageData[newFrame + 1].id));
        //       local.nextLayer.prefetch(
        //         Math.round(commonMedia.geoViewerRef.value.zoom()),
        //         commonMedia.geoViewerRef.value.bounds(),
        //       );
        //     }
        //   }
        // });
      });
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

    const {
      cursorHandler,
      initializeViewer,
      mediaController,
    } = commonMedia.initialize({
      seek,
      play,
      pause,
      setVolume: unimplemented,
      setSpeed: unimplemented,
    });

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
        nextLayer: '' as any,
      };
      const resp = await getTiles(props.imageData[data.frame].id);
      console.log(resp);
      local.levels = resp.levels;
      local.width = resp.sizeX;
      local.height = resp.sizeY;
      local.metadata = resp;
      local.params = {
        keepLower: false,
        attribution: null,
        url: _getTileURL(props.imageData[data.frame].id),
        useCredentials: true,
        maxLevel: resp.levels + 3,
        autoshareRenderer: false,
      };
      if (props.imageData.length) {
        initializeViewer(local.metadata.sourceSizeX, local.metadata.sourceSizeY,
          true);


        commonMedia.geoViewerRef.value.bounds({
          left: local.metadata.bounds.xmin,
          right: local.metadata.bounds.xmax,
          top: local.metadata.bounds.ymax,
          bottom: local.metadata.bounds.ymin,
        }, 'EPSG:3857');
        commonMedia.geoViewerRef.value.createLayer('osm');
        if (local.metadata.tileWidth > 8192 || local.metadata.tileWidth > 8192) {
          local.params.renderer = 'canvas';
        }


        commonMedia.geoViewerRef.value.zoomRange({
          min: commonMedia.geoViewerRef.value.origMin,
          max: commonMedia.geoViewerRef.value.zoomRange().max + 10,
        });

        local.currentLayer = commonMedia.geoViewerRef.value.createLayer('osm', local.params);

        // Set quadFeature and conditionally apply brightness filter
        setBrightnessFilter(props.brightness !== undefined);
        // if (!local.nextLayer) {
        //   local.nextLayer = commonMedia.geoViewerRef.value.createLayer('osm', local.params);
        //   local.nextLayer.url(_getTileURL(props.imageData[data.frame].id));
        //   local.nextLayer.moveDown();
        // }
        local.currentLayer.url(_getTileURL(props.imageData[data.frame].id));

        data.ready = true;
        //seek(0);
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
      imageCursorRef: commonMedia.imageCursorRef,
      containerRef: commonMedia.containerRef,
      onResize: commonMedia.onResize,
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
    <slot
      ref="control"
      name="control"
      @resize="onResize"
    />
    <slot v-if="data.ready" />
  </div>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
