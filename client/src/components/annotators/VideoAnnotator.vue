<script lang="ts">
import { defineComponent, PropType } from '@vue/composition-api';
import useMediaController from './useMediaController';

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
      video.currentTime = frame / props.frameRate;
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
      // See https://github.com/VIAME/VIAME-Web/issues/447 for more details.
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
