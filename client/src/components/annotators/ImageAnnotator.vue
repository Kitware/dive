<script>
import annotator from './annotator';

export default {
  name: 'ImageAnnotator',

  mixins: [annotator],

  props: {
    imageUrls: {
      type: Array,
      required: true,
    },
  },

  created() {
    this.maxFrame = this.imageUrls.length - 1;
    this.imgs = new Array(this.imageUrls.length);
    this.pendingImgs = new Set();
    this.cacheImage();
    if (this.imgs.length) {
      const img = this.imgs[0];
      img.onload = () => {
        img.onload = null;
        this.width = img.naturalWidth;
        this.height = img.naturalHeight;
        this.init();
      };
    }
  },

  methods: {
    init() {
      this.baseInit(); // Mixin method
      this.quadFeatureLayer = this.geoViewer.createLayer('feature', {
        features: ['quad'],
      });
      this.quadFeature = this.quadFeatureLayer
        .createFeature('quad')
        .data([
          {
            ul: { x: 0, y: 0 },
            lr: { x: this.width, y: this.height },
            image: this.imgs[this.frame],
          },
        ])
        .draw();
      this.ready = true;
    },

    async play() {
      try {
        this.playing = true;
        this.syncWithVideo();
      } catch (ex) {
        console.error(ex);
      }
    },

    async seek(frame) {
      this.frame = frame;
      this.syncedFrame = frame;
      this.emitFrame();
      this.cacheImage();
      this.quadFeature
        .data([
          {
            ul: { x: 0, y: 0 },
            lr: { x: this.width, y: this.height },
            image: this.imgs[frame],
          },
        ])
        .draw();
    },

    pause() {
      this.playing = false;
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
        this.frame += 1;
        this.syncedFrame += 1;
        if (this.frame > this.maxFrame) {
          this.pause();
          this.frame = this.maxFrame;
          this.syncedFrame = this.maxFrame;
          return;
        }
        this.seek(this.frame);
        setTimeout(this.syncWithVideo, 1000 / this.frameRate);
      }
    },
    cacheImage() {
      const { frame } = this;
      const max = Math.min(frame + 10, this.maxFrame);
      const { imgs } = this;
      this.pendingImgs.forEach((imageAndFrame) => {
        if (imageAndFrame[1] < frame || imageAndFrame[1] > max) {
          imgs[imageAndFrame[1]] = null;
          // eslint-disable-next-line no-param-reassign
          imageAndFrame[0].src = '';
          this.pendingImgs.delete(imageAndFrame);
        }
      });
      for (let i = frame; i <= max; i += 1) {
        if (!imgs[i]) {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.src = this.imageUrls[i];
          imgs[i] = img;
          const imageAndFrame = [img, frame];
          this.pendingImgs.add(imageAndFrame);
          img.onload = () => {
            this.pendingImgs.delete(imageAndFrame);
            img.onload = null;
          };
        }
      }
    },
  },
};
</script>

<template>
  <div
    v-resize="onResize"
    class="video-annotator"
  >
    <div
      ref="container"
      class="playback-container"
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
