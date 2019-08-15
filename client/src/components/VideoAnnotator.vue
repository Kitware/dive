<script>
import Vue from "vue";
import geo from "geojs";

export default {
  name: "VideoAnnotator",
  props: {
    videoMeta: {
      type: Object,
      required: true,
      validator(meta) {
        return !!meta.url && !!meta.frameRate;
      }
    }
  },
  provide() {
    return {
      annotator: this.provided
    };
  },
  data() {
    this.provided = new Vue({
      computed: {
        viewer: () => this.viewer,
        playing: () => this.playing,
        frame: () => this.frame,
        maxFrame: () => this.maxFrame
      }
    });
    return {
      ready: false,
      playing: false,
      frame: 0,
      maxFrame: 0
    };
  },
  computed: {
    isLastFrame() {
      return this.playing;
    }
  },
  created() {
    this.provided.$on("play", this.play);
    this.provided.$on("pause", this.pause);
    this.provided.$on("seek", this.seek);
    var video = document.createElement("video");
    this.video = video;
    video.preload = "auto";
    video.src = this.videoMeta.url;
    video.onloadedmetadata = () => {
      video.onloadedmetadata = null;
      this.width = video.videoWidth;
      this.height = video.videoHeight;
      this.maxFrame = this.videoMeta.frameRate * video.duration;
      this.init();
    };
    video.addEventListener("pause", this.videoPaused);
    // setTimeout(() => {
    //   this.play();
    // }, 2000);
  },
  methods: {
    init() {
      var params = geo.util.pixelCoordinateParams(
        this.$refs.container,
        this.width,
        this.height,
        this.width,
        this.height
      );
      this.viewer = geo.map(params.map);
      this.viewer.zoomRange({
        min: this.viewer.zoomRange().origMin,
        max: this.viewer.zoomRange().max + 3
      });
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
      this.video.currentTime = frame / this.videoMeta.frameRate;
      this.frame = Math.round(
        this.video.currentTime * this.videoMeta.frameRate
      );
    },
    pause() {
      this.video.pause();
      this.playing = false;
    },
    videoPaused() {
      if (this.video.currentTime === this.video.duration) {
        // console.log("video ended");
        this.frame = 0;
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
        // console.log("syncWithVideo");
        this.frame = Math.round(
          this.video.currentTime * this.videoMeta.frameRate
        );
        // console.log("syncWithVideo after", this.frame);
        // if (this._frame !== frame) {
        //   if (frame > this._maxFrame) {
        //     this.stop();
        //     frame = this._maxFrame;
        //   }
        //   this._frame = frame;
        //   this.trigger("progress", this._frame, this._maxFrame);
        //   this._drawAnnotation(this._frame);
        // }
        this.viewer.scheduleAnimationFrame(this.syncWithVideo);
      }
    },
    rendered() {
      // console.log("rendered an");
    }
  }
};
</script>

<template>
  <div class="video-annotator" v-resize="onResize">
    <div class="video-container" ref="container">{{ rendered() }}</div>
    <slot name="control" />
    <slot v-if="ready" />
  </div>
</template>

<style lang="scss" scoped>
.video-annotator {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;

  display: flex;
  flex-direction: column;

  .video-container {
    flex: 1;
  }
}
</style>
