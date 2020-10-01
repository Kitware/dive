<script>
import annotator from './annotator';

export default {
  name: 'VideoAnnotator',

  mixins: [annotator],

  props: {
    videoUrl: {
      type: String,
      required: true,
    },
  },

  computed: {
    isLastFrame() {
      return this.playing;
    },
  },

  created() {
    const video = document.createElement('video');
    this.video = video;
    video.preload = 'auto';
    video.src = this.videoUrl;
    video.onloadedmetadata = () => {
      video.onloadedmetadata = null;
      this.width = video.videoWidth;
      this.height = video.videoHeight;
      this.maxFrame = this.frameRate * video.duration;
      this.init();
    };
    video.addEventListener('pause', this.videoPaused);
  },
  methods: {
    init() {
      this.baseInit(); // Mixin method
      this.quadFeatureLayer = this.geoViewer.createLayer('feature', {
        features: ['quad.video'],
      });
      this.quadFeatureLayer
        .createFeature('quad')
        .data([
          {
            ul: { x: 0, y: 0 },
            lr: { x: this.width, y: this.height },
            video: this.video,
          },
        ])
        .draw();
      this.ready = true;
    },

    async play() {
      try {
        await this.video.play();
        this.playing = true;
        this.syncWithVideo();
      } catch (ex) {
        console.error(ex);
      }
    },

    async seek(frame) {
      this.video.currentTime = frame / this.frameRate;
      this.frame = Math.round(this.video.currentTime * this.frameRate);
      this.emitFrame();
      this.video.removeEventListener('seeked', this.pendingUpdate);
      this.video.addEventListener('seeked', this.pendingUpdate);
    },

    pendingUpdate() {
      this.syncedFrame = Math.round(this.video.currentTime * this.frameRate);
    },

    pause() {
      this.video.pause();
      this.playing = false;
    },

    videoPaused() {
      if (this.video.currentTime === this.video.duration) {
        this.frame = 0;
        this.syncedFrame = 0;
        this.pause();
      }
    },

    onResize() {
      if (!this.geoViewer) {
        return;
      }
      const size = this.$refs.container.getBoundingClientRect();
      const mapSize = this.geoViewer.size();
      if (size.width !== mapSize.width || size.height !== mapSize.height) {
        this.geoViewer.size(size);
      }
    },

    syncWithVideo() {
      if (this.playing) {
        this.frame = Math.round(this.video.currentTime * this.frameRate);
        this.syncedFrame = this.frame;
        this.geoViewer.scheduleAnimationFrame(this.syncWithVideo);
      }
    },
  },
};
</script>

<template>
  <div
    v-resize="onResize"
    class="video-annotator"
    :style="{cursor: cursor }"
  >
    <div
      ref="imageCursor"
      class="imageCursor"
    >
      <v-icon> {{ imageCursor }} </v-icon>
    </div>
    <div
      ref="container"
      class="playback-container"
      :style="{cursor: cursor }"
      @mousemove="handleMouseMove"
      @mouseleave="handleMouseLeave"
      @mouseover="handleMouseEnter"
    >
      {{ rendered() }}
    </div>
    <slot name="control" />
    <slot v-if="ready" />
  </div>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
