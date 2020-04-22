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
  data() {
    return {
      loadingVideo: false,
    };
  },
  created() {
    this.playCache = 1; // seconds to cache
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
      this.lastFrame = this.frame;
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
      this.loadingVideo = false;
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
        if (!this.imgs[this.frame].cached || this.loadingVideo) {
          this.frame -= 1;
          this.loadingVideo = true;
          return;
        }
        this.seek(this.frame);
        setTimeout(this.syncWithVideo, 1000 / this.frameRate);
      }
    },
    async cacheImage() {
      const { frame } = this;
      const { imgs } = this;
      // First thing we do is wait for the current frame to load

      const cacheSeconds = 3;
      const cachedFrames = cacheSeconds * this.frameRate;
      const frontBackRatio = 1.00; // 75% forward frames, 25% backward frames
      const min = Math.max(0, frame - cachedFrames * (1 - frontBackRatio));
      const max = Math.min(frame + frontBackRatio * cachedFrames, this.maxFrame);
      const frameDiff = Math.abs(this.frame - this.lastFrame);
      this.pendingImgs.forEach((imageAndFrame) => {
        if (imageAndFrame[1] < min || imageAndFrame[1] > max || frameDiff > 2) {
          imgs[imageAndFrame[1]] = null;
          // eslint-disable-next-line no-console
          console.log(`${imageAndFrame[1]} -CACHE CLEAR min:${min} max:${max}`);
          // eslint-disable-next-line no-param-reassign
          imageAndFrame[0].src = '';
          this.pendingImgs.delete(imageAndFrame);
        }
      });
      if (!this.playing && frame > 0) {
        // eslint-disable-next-line no-console
        console.log('awaiting load frame');
        const result = await this.loadFrame(frame);
        // eslint-disable-next-line no-console
        console.log(result);
      }

      this.cacheNewRange(frame, max);
    },
    loadFrame(frame) {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = this.imageUrls[frame];
        // eslint-disable-next-line no-param-reassign
        this.imgs[frame] = img;
        img.onload = () => {
          img.onload = null;
          img.cached = true;
          resolve(frame);
        };
      });
    },
    cacheNewRange(frame, max) {
      for (let i = frame; i <= max; i += 1) {
        if (!this.imgs[i]) {
          const img = new Image();
          img.crossOrigin = 'Anonymous';
          img.src = this.imageUrls[i];
          // eslint-disable-next-line no-param-reassign
          this.imgs[i] = img;
          const imageAndFrame = [img, frame];
          this.pendingImgs.add(imageAndFrame);
          img.onload = () => {
            this.pendingImgs.delete(imageAndFrame);
            img.onload = null;
            img.cached = true;
            // If we are trying to play and waiting for loaded frames we check the cache again
            if (this.playing && this.loadingVideo) {
              if (this.checkCached(this.playCache)) {
                this.loadingVideo = false;
                this.syncWithVideo();
              }
            }
          };
        }
      }
    },
    /**
     * Checks to see if there is enough cached images to play for X seconds
     * @param {int} seconds - the number of seconds to look for the cache
     * @returns {boolean}
     */
    checkCached(seconds) {
      const { frame } = this;
      const max = Math.min(frame + seconds * this.frameRate, this.maxFrame);
      // Lets work our way in from both sides for faster checking
      for (let i = frame; i <= frame + (max - frame) / 2; i += 1) {
        // eslint-disable-next-line no-console
        console.log(`frame${frame} max${max}`);
        if (!(this.imgs[i].cached && this.imgs[max - i].cached)) {
          // eslint-disable-next-line no-console
          console.log(`frame[${i}] is: ${this.imgs[i].cached} frame[${max - i}] is: ${this.imgs[max - i].cached}`);
          return false;
        }
      }
      // eslint-disable-next-line no-console
      console.log(`frame[${frame + 1}] is: ${this.imgs[frame + 1].complete}`);
      // eslint-disable-next-line no-console
      console.log(`Checked ${frame} - ${max}`);
      return true;
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
      <div class="loadingSpinnerContainer">
        <v-progress-circular
          v-if="loadingVideo"
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
    <slot name="control" />
    <slot v-if="ready" />
  </div>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
