<script lang="ts">
import {
  defineComponent, ref, onUnmounted, PropType, toRef, watch, computed, markRaw,
} from 'vue';
import { debounce } from 'lodash';
import geo from 'geojs';
import {
  ImageEnhancementOutputs,
  PercentileStretch,
  percentileStretchToTileStyle,
} from 'vue-media-annotator/use/useImageEnhancements';
import { SetTimeFunc } from '../../use/useTimeObserver';
import AnnotatorImageCursor from './AnnotatorImageCursor.vue';
import useAnnotatorImageCursor from './useAnnotatorImageCursor';
import { injectCameraInitializer } from './useMediaController';
import { composeLargeImageFrameTexture } from './largeImageFrameTexture';

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

function shellEscapePath(path: string): string {
  return `"${path.replace(/"/g, '\\"')}"`;
}

function buildOutputFilename(inputFilename: string): string {
  const separator = Math.max(inputFilename.lastIndexOf('/'), inputFilename.lastIndexOf('\\'));
  const dirname = separator >= 0 ? inputFilename.slice(0, separator + 1) : '';
  const basename = separator >= 0 ? inputFilename.slice(separator + 1) : inputFilename;
  const extIndex = basename.lastIndexOf('.');
  const hasExt = extIndex > 0;
  const nameOnly = hasExt ? basename.slice(0, extIndex) : basename;
  return `${dirname}${nameOnly || 'converted'}_cog_scaled.tif`;
}

export default defineComponent({
  name: 'LargeImageAnnotator',
  components: { AnnotatorImageCursor },
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
      (
        itemId: string,
        x: number,
        y: number,
        level: number,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        query: Record<string, any>,
      ) => string>,
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
    filterId: {
      type: String as PropType<string>,
      default: 'imageEnhancements',
    },
    percentileStretch: {
      type: Object as PropType<PercentileStretch | null>,
      default: null,
    },
  },
  setup(props) {
    const loadingVideo = ref(false);
    const loadingImage = ref(true);
    const tileLoadError = ref('');
    const tileLoadErrorWidth = ref<number | null>(null);
    const copiedConversionCommand = ref(false);
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
    const { playbackCursor } = useAnnotatorImageCursor(
      toRef(data, 'imageCursor'),
      toRef(data, 'cursor'),
      toRef(data, 'imageCursorEditing'),
    );
    const updateTileLoadErrorWidth = () => {
      const containerWidth = container.value?.getBoundingClientRect().width;
      tileLoadErrorWidth.value = typeof containerWidth === 'number'
        ? containerWidth
        : null;
    };
    let tileLoadErrorResizeObserver: ResizeObserver | null = null;
    watch(container, (containerEl, previousEl) => {
      if (tileLoadErrorResizeObserver && previousEl) {
        tileLoadErrorResizeObserver.unobserve(previousEl);
      }
      if (!containerEl) {
        tileLoadErrorWidth.value = null;
        return;
      }
      if (!tileLoadErrorResizeObserver) {
        tileLoadErrorResizeObserver = new ResizeObserver(() => {
          updateTileLoadErrorWidth();
        });
      }
      tileLoadErrorResizeObserver.observe(containerEl);
      updateTileLoadErrorWidth();
    }, { immediate: true });
    const tileLoadErrorStyle = computed(() => {
      if (tileLoadErrorWidth.value === null) {
        return {};
      }
      const width = `${Math.round(tileLoadErrorWidth.value)}px`;
      return {
        width,
        maxWidth: width,
      };
    });
    const conversionInputFilename = computed(() => (
      props.imageData[data.frame]?.filename
      || props.imageData[0]?.filename
      || 'input.tif'
    ));
    const hasPreconversionGuidance = computed(() => /overview|pre-convert|gdal/i.test(tileLoadError.value));
    const gdalTranslateCommand = computed(() => {
      const inputFilename = conversionInputFilename.value;
      const outputFilename = buildOutputFilename(inputFilename);
      return `gdal_translate ${shellEscapePath(inputFilename)} ${shellEscapePath(outputFilename)} -of COG -ot Byte -scale <min> <max> 0 255 -co BLOCKSIZE=256 -co COMPRESS=DEFLATE -co PREDICTOR=2 -co BIGTIFF=IF_SAFER -co NUM_THREADS=ALL_CPUS -co OVERVIEWS=IGNORE_EXISTING -co RESAMPLING=LANCZOS -co OVERVIEW_RESAMPLING=AVERAGE`;
    });
    const copyConversionCommand = async () => {
      try {
        await navigator.clipboard.writeText(gdalTranslateCommand.value);
        copiedConversionCommand.value = true;
        window.setTimeout(() => {
          copiedConversionCommand.value = false;
        }, 1500);
      } catch (err) {
        console.warn('Unable to copy GDAL command to clipboard', err);
      }
    };
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
    const activePercentileStretch = ref<PercentileStretch | null>(props.percentileStretch);

    function stretchCacheKey(stretch: PercentileStretch | null): string {
      if (!stretch) return 'none';
      return `${stretch.lowPercentile}:${stretch.highPercentile}`;
    }

    function applyTileQueryParams(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      params: Record<string, any>,
      proj?: string,
    ) {
      const updatedParams = { ...params, encoding: 'PNG' };
      if (proj) {
        updatedParams.projection = proj;
      }
      const style = percentileStretchToTileStyle(activePercentileStretch.value);
      if (style) {
        updatedParams.style = style;
      }
      return updatedParams;
    }

    function refreshVisibleTileLayers() {
      if (
        !data.ready
        || !local.currentLayer
        || typeof local.currentLayer.url !== 'function'
        || !props.imageData[data.frame]?.id
      ) {
        return;
      }
      local.currentLayer.url(_getTileURL(props.imageData[data.frame].id, projection));
      if (
        local.nextLayer
        && typeof local.nextLayer.url === 'function'
        && props.imageData[local.nextLayerFrame]?.id
      ) {
        local.nextLayer.url(_getTileURL(props.imageData[local.nextLayerFrame].id, projection));
      }
    }

    const debouncedRefreshTileLayers = debounce(refreshVisibleTileLayers, 500, { trailing: true });
    /** Abort in-flight overview texture composites when the frame/stretch changes. */
    let frameTextureAbort: AbortController | null = null;

    function setTileLayersVisible(visible: boolean) {
      const visibility = visible ? '' : 'hidden';
      if (local.currentLayer && typeof local.currentLayer.node === 'function') {
        local.currentLayer.node().css('visibility', visibility);
      }
      if (local.nextLayer && typeof local.nextLayer.node === 'function') {
        local.nextLayer.node().css('visibility', visibility);
      }
    }

    function clearFrameTexture() {
      frameTextureAbort?.abort();
      frameTextureAbort = null;
      data.frameTexture = null;
      data.imageRevision += 1;
    }

    async function refreshFrameTexture() {
      if (!data.ready || !data.hasFrame || !local.width || !local.height) {
        return;
      }
      const itemId = props.imageData[data.frame]?.id;
      if (!itemId) {
        return;
      }
      frameTextureAbort?.abort();
      const abort = new AbortController();
      frameTextureAbort = abort;
      const layerParams = (local.params && local.params.layer) ? local.params.layer : local.params;
      const maxLevel = typeof layerParams?.maxLevel === 'number'
        ? layerParams.maxLevel
        : Math.max(0, (local.levels || 1) - 1);
      try {
        const texture = await composeLargeImageFrameTexture({
          meta: {
            sizeX: local.width,
            sizeY: local.height,
            tileWidth: local.metadata?.tileWidth || 256,
            tileHeight: local.metadata?.tileHeight || 256,
            levels: maxLevel + 1,
          },
          getTileURL: (x, y, level) => props.getTileURL(
            itemId,
            x,
            y,
            level,
            applyTileQueryParams({}, projection),
          ),
          signal: abort.signal,
        });
        if (abort.signal.aborted) {
          return;
        }
        data.frameTexture = markRaw(texture);
        data.imageRevision += 1;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') {
          return;
        }
        console.warn('Unable to build large-image frame texture for Align View / registration ghost', err);
      }
    }

    const debouncedRefreshFrameTexture = debounce(refreshFrameTexture, 500, { trailing: true });
    let previousStretchKey = stretchCacheKey(props.percentileStretch);

    watch(
      () => props.percentileStretch,
      (stretch) => {
        activePercentileStretch.value = stretch;
        if (!data.ready) {
          previousStretchKey = stretchCacheKey(stretch);
          return;
        }
        const currentKey = stretchCacheKey(stretch);
        const isToggle = (currentKey === 'none') !== (previousStretchKey === 'none');
        previousStretchKey = currentKey;
        if (isToggle) {
          debouncedRefreshTileLayers.cancel();
          debouncedRefreshFrameTexture.cancel();
          refreshVisibleTileLayers();
          refreshFrameTexture();
        } else {
          debouncedRefreshTileLayers();
          debouncedRefreshFrameTexture();
        }
      },
      { deep: true },
    );

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
      const returnFunc = (x: number, y: number, level: number, params: any) => {
        const updatedParams = applyTileQueryParams(params, proj);
        return props.getTileURL(itemId, x, y, level, updatedParams);
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
      local.nextLayer._options.tileHeight = newParams.layer.tileHeight;
      local.nextLayer._options.tilesAtZoom = newParams.layer.tilesAtZoom;
      local.nextLayer._options.tilesMaxBounds = newParams.layer.tilesMaxBounds;
      local.nextLayer.url(_getTileURL(props.imageData[frame].id));
      local.nextLayerFrame = frame;
    }
    /**
     * When the component is unmounted, cancel all outstanding
     * requests for image load.
     */
    onUnmounted(() => {
      debouncedRefreshTileLayers.cancel();
      debouncedRefreshFrameTexture.cancel();
      frameTextureAbort?.abort();
      frameTextureAbort = null;
      Array.from(local.pendingImgs).forEach(forceUnload);
      if (tileLoadErrorResizeObserver && container.value) {
        tileLoadErrorResizeObserver.unobserve(container.value);
      }
      if (tileLoadErrorResizeObserver) {
        tileLoadErrorResizeObserver.disconnect();
        tileLoadErrorResizeObserver = null;
      }
    });
    async function seek(f: number | undefined) {
      if (!data.ready) {
        return;
      }
      if (f === undefined) {
        // No frame for this camera at the current aligned-timeline slot: blank
        // the pane (same contract as ImageAnnotator / VideoAnnotator).
        data.hasFrame = false;
        setTileLayersVisible(false);
        clearFrameTexture();
        return;
      }
      if (!data.hasFrame) {
        data.hasFrame = true;
        setTileLayersVisible(true);
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
          refreshFrameTexture();
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
              local.currentLayer._options.tileHeight = newParams.layer.tileHeight;
              local.currentLayer._options.tilesAtZoom = newParams.layer.tilesAtZoom;
              local.currentLayer._options.tilesMaxBounds = newParams.layer.tilesMaxBounds;
              local.currentLayer.url(_getTileURL(props.imageData[newFrame].id));
              loadingImage.value = false;
              // If there is another frame we begin loading it with the current position/zoom level
              loadingImage.value = false;
              if (props.imageData[newFrame + 1]) {
                cacheFrame(newFrame + 1);
              }
              refreshFrameTexture();
            });
          });
        }
      } else {
        refreshFrameTexture();
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
            local.currentLayer.node().css('filter', `url(#${props.filterId})`);
          }
          data.imageRevision += 1;
        }
      },
      { deep: true },
    );
    async function init() {
      tileLoadError.value = '';
      copiedConversionCommand.value = false;
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
      let resp;
      try {
        resp = await props.getTiles(props.imageData[data.frame].id, projection);
      } catch (err) {
        const fallbackMessage = 'Unable to load large-image tiles. This file may need to be pre-converted before viewing.';
        const message = (err as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
          || (err as { message?: string })?.message
          || fallbackMessage;
        tileLoadError.value = message;
        loadingVideo.value = false;
        loadingImage.value = false;
        data.ready = false;
        return;
      }
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
          local.nextLayer = geoViewer.value.createLayer('osm', { ...localParams, ...newParams.layer });
          local.nextLayer._options.maxLevel = newParams.layer.maxLevel;
          local.nextLayer._options.tileWidth = newParams.layer.tileWidth;
          local.nextLayer._options.tileHeight = newParams.layer.tileHeight;
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
          local.currentLayer.node().css('filter', `url(#${props.filterId})`);
        }
        data.ready = true;
        loadingVideo.value = false;
        loadingImage.value = false;
        seek(0);
      }
    }

    /**
     * Soft-refresh when the frame list identity changes (e.g. percentile-stretch
     * URL remaps) without recreating the geoJS map. Full init() after the map
     * already exists would exit/rebuild the map under live annotation layers and
     * leak WebGL contexts.
     */
    async function refreshForImageDataChange() {
      if (!data.ready || !geoViewer.value) {
        await init();
        return;
      }
      data.maxFrame = props.imageData.length - 1;
      if (!props.imageData[data.frame]) {
        await seek(Math.min(data.frame, Math.max(0, data.maxFrame)));
        return;
      }
      data.filename = props.imageData[data.frame].filename;
      try {
        const resp = await props.getTiles(props.imageData[data.frame].id, projection);
        local.width = resp.sizeX;
        local.height = resp.sizeY;
        local.levels = resp.levels;
        local.metadata = resp;
        if (local.currentLayer && typeof local.currentLayer.url === 'function') {
          const newParams = geo.util.pixelCoordinateParams(
            container.value,
            resp.sizeX,
            resp.sizeY,
            resp.tileWidth,
            resp.tileHeight,
          );
          local.currentLayer._options.maxLevel = newParams.layer.maxLevel;
          local.currentLayer._options.tileWidth = newParams.layer.tileWidth;
          local.currentLayer._options.tileHeight = newParams.layer.tileHeight;
          local.currentLayer._options.tilesAtZoom = newParams.layer.tilesAtZoom;
          local.currentLayer._options.tilesMaxBounds = newParams.layer.tilesMaxBounds;
          local.currentLayer.url(_getTileURL(props.imageData[data.frame].id, projection));
        }
        refreshVisibleTileLayers();
        refreshFrameTexture();
      } catch (err) {
        console.warn('Unable to refresh large-image tiles after imageData change', err);
      }
    }

    // Watch imageData for change
    watch(toRef(props, 'imageData'), () => {
      refreshForImageDataChange();
    });
    // Watch brightness for change, only set filter if value
    // is switching from number -> undefined, or vice versa.
    init();
    return {
      data,
      loadingVideo,
      loadingImage,
      playbackCursor,
      tileLoadError,
      tileLoadErrorStyle,
      conversionInputFilename,
      hasPreconversionGuidance,
      gdalTranslateCommand,
      copyConversionCommand,
      copiedConversionCommand,
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
        <filter :id="filterId">
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
      <AnnotatorImageCursor
        :image-cursor="data.imageCursor"
        :image-cursor-editing="data.imageCursorEditing"
        :cursor="data.cursor"
      />
    </div>
    <div
      ref="containerRef"
      class="playback-container"
      :style="{ cursor: playbackCursor }"
      @mousemove="cursorHandler.handleMouseMove"
      @mouseleave="cursorHandler.handleMouseLeave"
      @mouseover="cursorHandler.handleMouseEnter"
    >
      <v-alert
        v-if="tileLoadError"
        type="error"
        outlined
        class="tile-load-error"
        :style="tileLoadErrorStyle"
      >
        <div class="tile-load-error__message">
          {{ tileLoadError }}
        </div>
        <div
          v-if="hasPreconversionGuidance"
          class="tile-load-error__guidance"
        >
          <div class="mt-2">
            Run <code>gdalinfo --stats "{{ conversionInputFilename }}"</code> and note the min/max
            values for each band, then replace <code>&lt;min&gt;</code> and <code>&lt;max&gt;</code>
            below and run the command to convert the file.
          </div>
          <v-textarea
            class="mt-2"
            outlined
            readonly
            no-resize
            rows="3"
            hide-details
            :value="gdalTranslateCommand"
          />
          <div class="d-flex justify-end mt-2">
            <v-btn
              small
              color="error"
              outlined
              @click="copyConversionCommand"
            >
              {{ copiedConversionCommand ? 'Copied' : 'Copy command' }}
            </v-btn>
          </div>
        </div>
      </v-alert>
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

.tile-load-error {
  margin: 8px 0;
  box-sizing: border-box;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.tile-load-error__message {
  white-space: normal;
}
</style>
