<script>
import annotator from "./annotator";

export default {
  name: "VideoAnnotator",

  props: {
    videoUrl: {
      type: String,
      required: true
    }
  },

  mixins: [annotator],

  computed: {
    isLastFrame() {
      return this.playing;
    }
  },

  created() {
    var video = document.createElement("video");
    this.video = video;
    video.preload = "auto";
    video.src = this.videoUrl;
    video.onloadedmetadata = () => {
      video.onloadedmetadata = null;
      this.width = video.videoWidth;
      this.height = video.videoHeight;
      this.maxFrame = this.frameRate * video.duration;
      this.init();
    };
    video.addEventListener("pause", this.videoPaused);
  },

  methods: {
    init() {
      this.baseInit();
      this.quadFeatureLayer = this.viewer.createLayer("feature", {
        features: ["quad.video"]
      });
      this.quadFeatureLayer
        .createFeature("quad")
        .data([
          {
            ul: { x: 0, y: 0 },
            lr: { x: this.width, y: this.height },
            video: this.video
          }
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
        console.log(ex);
      }
    },

    async seek(frame) {
      this.video.currentTime = frame / this.frameRate;
      this.frame = Math.round(this.video.currentTime * this.frameRate);
      this.emitFrame();
      this.video.removeEventListener("seeked", this.pendingUpdate);
      this.video.addEventListener("seeked", this.pendingUpdate);
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
        // console.log("video ended");
        this.frame = 0;
        this.syncedFrame = 0;
        this.pause();
      }
    },

    onResize() {
      if (!this.viewer) {
        return;
      }
      const size = this.$refs.container.getBoundingClientRect();
      const mapSize = this.viewer.size();
      if (size.width !== mapSize.width || size.height !== mapSize.height) {
        this.viewer.size(size);
      }
    },

    syncWithVideo() {
      if (this.playing) {
        this.frame = Math.round(this.video.currentTime * this.frameRate);
        this.syncedFrame = this.frame;
        this.viewer.scheduleAnimationFrame(this.syncWithVideo);
      }
    }
  }
};
</script>

<template>
  <div class="video-annotator" v-resize="onResize">
    <div class="playback-container" ref="container">{{ rendered() }}</div>
    <slot name="control" />
    <slot v-if="ready" />
  </div>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
