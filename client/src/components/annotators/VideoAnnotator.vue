<script lang="ts">
import {
  defineComponent, onBeforeUnmount, PropType, toRef, watch,
} from '@vue/composition-api';
import { Flick, SetTimeFunc } from '../../use/useTimeObserver';
import { injectCameraInitializer } from './useMediaController';
/**
 * For MPEG codecs, the PTS (Presentation Timestamp)
 * should be forced ahead 1 tick. currentTime has a finite
 * resolution of 90MHZ
 *
 * Chrome has a PTS precision bug:
 * https://bugs.chromium.org/p/chromium/issues/detail?id=555376
 * "currentTime must be in the range [PTS, PTS + duration)",
 * but Chrome behaves as if currentTime in = [PTS, PTS + duration]
 *
 * Firefox behaves correctly, so it's harmless to advance a single
 * tick into the already correct PTS.
 *
 * Other browsers can be wrong by more than an entire frame and are
 * futile to attempt to correct.
 *
 * TODO: VideoAnnotator _should_not_ report this PTS force hack
 * when reporting currentTime, as it would be inaccurate re: the
 * MPEG specification.
 */
const OnePTSTick = 1 / (90 * 1000);
/**
 * The Kwiver seek function performs seek based on
 * downsampled frame number such that the converse of the
 * function (maping timestamp to downsampled frame)
 * is consistent with the implementation in kwiver:
 *
 * https://github.com/Kitware/kwiver/blob/1c97ad72c8b6237cb4b9618665d042be16825005/sprokit/processes/core/downsample_process.cxx#L267
 */
function kwiverSeek(frame: number, frameRate: number, originalFps: number) {
  /**
   * If the downsample rate is truly lower than the original,
   * ceiling to find the sample boundary, else floor
   */
  const roundOrFloor = frameRate < originalFps ? Math.ceil : Math.floor;
  /**
   * requestedTimeInSeconds is the position, in seconds, that was
   * requested for seek
   */
  const requestedTimeInSeconds = frame / frameRate;
  /**
   * RequestedTrueVideoFrame is the floating point frame number
   * expected to be found at requested time
   */
  const requestedTrueVideoFrame = requestedTimeInSeconds * originalFps;
  /**
   * nextTrueFrameBoundary is the time, in seconds, of the
   * next frame transition boundary ASSUMING even frame spacing.
   *
   * For videos with b frames or inconsistent frame widths, this
   * will only be an aggregate approximation
   */
  const nextTrueFrameBoundary = (
    roundOrFloor(requestedTrueVideoFrame) / originalFps
  );
  /**
   * Return one tick over the appropriate boundary
   */
  return nextTrueFrameBoundary + OnePTSTick;
}
export default defineComponent({
  name: 'VideoAnnotator',
  props: {
    videoUrl: {
      type: String,
      required: true,
    },
    videoPlayerAttributes: {
      type: Object as PropType<{ [key: string]: string }>,
      default: () => ({}),
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
      // allow hoisting for these functions.
      // eslint-disable-next-line @typescript-eslint/no-use-before-define
      seek, pause, play, setVolume, setSpeed,
    });
    function makeVideo() {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.src = props.videoUrl;
      Object.assign(video, props.videoPlayerAttributes);
      return video;
    }
    const video = makeVideo();
    onBeforeUnmount(() => {
      if (video) {
        video.pause();
      }
    });
    async function seek(frame: number) {
      /** Only perform seek for whole frame numbers */
      const requestedFrame = Math.round(frame);
      /** Different seek approaches based on known information */
      if (props.originalFps) {
        /** If the video's true FPS is known */
        data.currentTime = kwiverSeek(frame, props.frameRate, props.originalFps);
      } else {
        /** Else fall back to a reasonable default */
        data.currentTime = (frame / props.frameRate) + OnePTSTick;
      }
      video.currentTime = data.currentTime;
      data.frame = requestedFrame;
      data.flick = Math.round(data.currentTime * Flick);
      props.updateTime(data);
    }
    function pause() {
      video.pause();
      seek(data.frame); // snap to frame boundary
      data.playing = false;
    }
    function syncWithVideo() {
      if (data.playing) {
        const newFrame = video.currentTime * props.frameRate;
        if (newFrame > data.maxFrame) {
          /** Video has played past its allowed truncated end, seek to end */
          data.frame = data.maxFrame;
          pause();
          return;
        }
        data.frame = Math.floor(newFrame);
        data.flick = Math.round(video.currentTime * Flick);
        data.syncedFrame = data.frame;
        geoViewer.value.scheduleAnimationFrame(syncWithVideo);
      }
      data.currentTime = video.currentTime;
    }
    async function play() {
      try {
        await video.play();
        data.playing = true;
        syncWithVideo();
      } catch (ex) {
        console.error(ex);
      }
    }
    function logError(event: ErrorEvent) {
      console.error('Media failed to initialize', event);
    }
    function setVolume(level: number) {
      video.volume = level;
      data.volume = video.volume;
    }
    function setSpeed(level: number) {
      video.playbackRate = level;
      data.speed = video.playbackRate;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let quadFeatureLayer = undefined as any;
    const setBrightnessFilter = (on: boolean) => {
      if (quadFeatureLayer !== undefined) {
        quadFeatureLayer.node().css('filter', on ? 'url(#brightness)' : '');
      }
    };
    /**
     * Initialize the Quad feature layer once
     * video metadata has been fetched.
     */
    function loadedMetadata() {
      video.removeEventListener('loadedmetadata', loadedMetadata);
      const width = video.videoWidth;
      const height = video.videoHeight;
      const maybeMaxFrame = Math.floor(props.frameRate * video.duration);
      if (props.originalFps !== null) {
        /**
         * Don't allow the user to seek past the final frame as defined by kwiver.
         */
        if (kwiverSeek(maybeMaxFrame, props.frameRate, props.originalFps) > video.duration) {
          data.maxFrame = maybeMaxFrame - 1;
        } else {
          data.maxFrame = maybeMaxFrame;
        }
      } else {
        console.warn('Dataset loaded without originalFps, seeking accuracy will be impacted');
        data.maxFrame = maybeMaxFrame;
      }
      initializeViewer(width, height);
      quadFeatureLayer = geoViewer.value.createLayer('feature', {
        features: ['quad.video'],
        autoshareRenderer: false,
      });
      setBrightnessFilter(props.brightness !== undefined);
      quadFeatureLayer
        .createFeature('quad')
        .data([
          {
            ul: { x: 0, y: 0 },
            lr: { x: width, y: height },
            video,
          },
        ])
        .draw();
      // Force the first frame to load on slow networks.
      // See https://github.com/Kitware/dive/issues/447 for more details.
      seek(0);
      data.ready = true;
      data.volume = video.volume;
      data.speed = video.playbackRate;
      data.currentTime = video.currentTime;
      data.duration = video.duration;
    }
    // Watch brightness for change, only set filter if value
    // is switching from number -> undefined, or vice versa.
    watch(toRef(props, 'brightness'), (brightness, oldBrightness) => {
      if ((brightness === undefined) !== (oldBrightness === undefined)) {
        setBrightnessFilter(brightness !== undefined);
      }
    });
    function pendingUpdate() {
      data.syncedFrame = Math.round(video.currentTime * props.frameRate);
    }
    video.addEventListener('loadedmetadata', loadedMetadata);
    video.addEventListener('seeked', pendingUpdate);
    video.addEventListener('error', logError);
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
  <div
    class="video-annotator"
    :style="{ cursor: data.cursor }"
  >
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
</style>
