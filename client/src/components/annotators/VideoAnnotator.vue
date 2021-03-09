<script lang="ts">
import { defineComponent, PropType } from '@vue/composition-api';
import useMediaController from './useMediaController';

/**
 * frameInnerOffset is a constant percentage offset
 * of a frame's width to seek to in video, used to prevent
 * rounding errors when calculating the time location of
 * a particular frame.
 *
 * In the future, when precise seconds (or flicks) are recorded
 * with feature data, this offset must be accounted for during
 * framerate conversion and export.
 *
 * This number is inentionally small in order to avoid meaninful
 * frame alignment mis-matches with common raw framerates. For example,
 *
 */
const frameInnerOffset = 0.01;

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
  },

  setup(props, { emit }) {
    const commonMedia = useMediaController({ emit });
    const { data } = commonMedia;

    function makeVideo() {
      const video = document.createElement('video');
      video.preload = 'auto';
      video.src = props.videoUrl;
      Object.assign(video, props.videoPlayerAttributes);
      return video;
    }
    const video = makeVideo();

    function syncWithVideo() {
      if (data.playing) {
        data.frame = Math.round(video.currentTime * props.frameRate);
        data.syncedFrame = data.frame;
        commonMedia.geoViewerRef.value.scheduleAnimationFrame(syncWithVideo);
      }
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

    async function seek(frame: number) {
      video.currentTime = (frame + frameInnerOffset) / props.frameRate;
      data.frame = Math.round(video.currentTime * props.frameRate);
      commonMedia.emitFrame();
    }

    function pause() {
      video.pause();
      data.playing = false;
    }

    const {
      cursorHandler,
      initializeViewer,
      mediaController,
    } = commonMedia.initialize({ seek, play, pause });

    /**
     * Initialize the Quad feature layer once
     * video metadata has been fetched.
     */
    function loadedMetadata() {
      video.removeEventListener('loadedmetadata', loadedMetadata);
      const width = video.videoWidth;
      const height = video.videoHeight;
      data.maxFrame = props.frameRate * video.duration;
      initializeViewer(width, height);
      const quadFeatureLayer = commonMedia.geoViewerRef.value.createLayer('feature', {
        features: ['quad.video'],
      });
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
    }

    function pendingUpdate() {
      data.syncedFrame = Math.round(video.currentTime * props.frameRate);
    }

    video.addEventListener('loadedmetadata', loadedMetadata);
    video.addEventListener('seeked', pendingUpdate);

    return {
      data,
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
  <div
    v-resize="onResize"
    class="video-annotator"
    :style="{ cursor: data.cursor }"
  >
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
