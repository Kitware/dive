<script>
import Vue from 'vue';
import annotator from './annotator';

export default Vue.extend({
  name: 'ImageAnnotator',

  mixins: [annotator],

  props: {
    imageData: {
      type: Array,
      required: true,
    },
    loadImageFunc: {
      type: Function,
      default: async (imageDataItem, img) => {
        // eslint-disable-next-line no-param-reassign
        img.src = imageDataItem.url;
      },
    },
  },
  data() {
    return {
      loadingVideo: false,
    };
  },
  created() {
    // Below are configuration settings we can set until we decide on good numbers to utilize.
    this.playCache = 1; // seconds required to be fully cached before playback
    this.cacheSeconds = 6; // seconds to cache from the current frame
    this.frontBackRatio = 0.90; // 90% forward frames, 10% backward frames when caching

    this.maxFrame = this.imageData.length - 1;
    this.imgs = new Array(this.imageData.length);
    this.filename = this.imageData[this.frame].filename;
    this.pendingImgs = new Set();
    if (this.imgs.length) {
      this.loadFrame(0);
      const img = this.imgs[0];
      img.onload = () => {
        img.onload = null;
        this.width = img.naturalWidth;
        this.height = img.naturalHeight;
        img.cached = true;
        this.init();
        this.cacheImages();
      };
    }
  },
  methods: {
    init() {
      this.baseInit(); // Mixin method
      this.quadFeatureLayer = this.geoViewer.createLayer('feature', {
        features: ['quad'],
      });
      this.quadFeature = this.quadFeatureLayer.createFeature('quad');
      this.drawImage(this.imgs[this.frame]);
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
    drawImage(img) {
      if ((img.naturalWidth !== this.width) || (img.naturalHeight !== this.height)) {
        this.width = img.naturalWidth;
        this.height = img.naturalHeight;
        this.resetMapDimensions();
      }
      this.quadFeature
        .data([
          {
            ul: { x: 0, y: 0 },
            lr: { x: this.width, y: this.height },
            image: img,
          },
        ])
        .draw();
    },
    async seek(newFrame) {
      this.lastFrame = this.frame;
      this.frame = newFrame;
      this.syncedFrame = newFrame;
      this.emitFrame();
      const imgsPromise = this.cacheImages();
      const img = this.imgs[newFrame];
      if (img.cached) {
        // if image is already loaded, draw it now
        this.drawImage(img);
      } else {
        // else wait for it to load
        const imgs = await imgsPromise;
        const loadedImg = await imgs[newFrame];
        if (loadedImg !== undefined && loadedImg.frame === this.frame) {
          // if the image exists ()
          // and the seek hasn't changed since the image completed loading, draw it.
          this.drawImage(loadedImg);
        }
      }
    },
    pause() {
      this.playing = false;
      this.loadingVideo = false;
    },
    /**
     * Handles playback of the image sequence
     * Image playback is based on framerate but will pause and wait for images to load
     * if the currently accessed image is not loaded during playback.
     */
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
        // Prevents advancing the frame while playing if the current image is not loaded
        if (!this.imgs[this.frame].cached || this.loadingVideo) {
          this.frame -= 1; // returns to a loaded image
          // sync the annotations with the loading frame
          this.syncedFrame = this.frame;
          this.emitFrame();
          this.loadingVideo = true;

          return;
        }
        this.seek(this.frame);
        setTimeout(this.syncWithVideo, 1000 / this.frameRate);
      }
    },
    /**
     * Begins loading a set of images around the current frame.  If the image is not playing
     * it will give priority tothe currently loaded frame
     */
    async cacheImages() {
      const { frame } = this;
      const { imgs } = this;
      const cachedFrames = this.cacheSeconds * this.frameRate;
      const min = Math.floor(Math.max(0, frame - cachedFrames * (1 - this.frontBackRatio)));
      const max = Math.ceil(Math.min(frame + this.frontBackRatio * cachedFrames, this.maxFrame));
      const frameDiff = Math.abs(this.frame - this.lastFrame);
      const prevFrame = (this.frame < this.lastFrame);
      this.pendingImgs.forEach((imageAndFrame) => {
        // the current loading cache needs to be wiped out if we seek forward, backwards or
        // if we are out of the current range of the cache
        if (imageAndFrame[1] < min || imageAndFrame[1] > max || frameDiff > 1 || prevFrame) {
          imgs[imageAndFrame[1]] = null;
          // eslint-disable-next-line no-param-reassign
          imageAndFrame[0].src = '';
          this.pendingImgs.delete(imageAndFrame);
        }
      });
      // if not playing we want the seeked to frame immediately and prevent caching until loaded
      if (!this.playing && !imgs[frame] && frame > 0) {
        await this.loadFrame(frame);
      }
      // Cache a new range of images based on current frame
      return this.cacheNewRange(min, max);
    },
    /**
     * Wraps loading of a single frame in a promise, used to gurantee frame loads
     * before execution of caching.
     * @param {int} frame number to be loaded
     * @returns {Promise} resolves when the image from the frame is loaded
     */
    loadFrame(frame) {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        this.imgs[frame] = img;
        img.onload = () => {
          img.onload = null;
          img.cached = true;
          img.frame = frame;
          resolve(frame);
        };
        this.loadImageFunc(this.imageData[frame], img);
      });
    },
    /**
     * Caches a new range of frames to load in a forward->back pattern from the current frame
     * This allows for easily seeking backwards after seeking initially
     * @param {int} min lower bound frame number for caching
     * @param {int} max upper bound frame number for caching
     */
    cacheNewRange(min, max) {
      const frameImages = [];
      for (let i = this.frame; i <= max; i += 1) {
        frameImages[i] = this.cacheFrame(i);
        const minusFrame = this.frame - (i - this.frame);
        if (minusFrame >= min) {
          this.cacheFrame(minusFrame);
        }
      }
      return frameImages;
    },
    /**
     * Adds a single frame to the pendingImgs array for loading and assigns it to the master
     * imgs list. Once the image is loaded it is removed from the pendingImgs
     * @param {int} i the image to cache if it isn't already assigned
     * @returns {Array<Promise<Array<imgage>>>} loaded images
     */
    cacheFrame(i) {
      let p = Promise.resolve(this.imgs[i]);
      if (!this.imgs[i]) {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        this.imgs[i] = img;
        const imageAndFrame = [img, i];
        this.pendingImgs.add(imageAndFrame);
        p = new Promise((resolve) => {
<<<<<<< HEAD
          img.onload = (evt) => {
            this.pendingImgs.delete(imageAndFrame);
            img.onload = null;
            img.cached = true;
            img.frame = i;
=======
          img.onload = () => {
            this.pendingImgs.delete(imageAndFrame);
            img.onload = null;
            img.cached = true;
>>>>>>> a9841e4... Multiresolution support
            // If we are trying to play and waiting for loaded frames we check the cache again
            if (this.playing && this.loadingVideo) {
              if (this.checkCached(this.playCache)) {
                this.loadingVideo = false;
                this.syncWithVideo();
              }
            }
            resolve(img);
          };
        });
        this.loadImageFunc(this.imageData[i], img);
      }
      return p;
    },
    /**
     * Checks to see if there is enough cached images to play for X seconds
     * @param {int} seconds the number of seconds to look for the cache
     * @returns {boolean} true if the cache is valid for the next X seconds,
     * otherwise false.
     */
    checkCached(seconds) {
      const { frame } = this;
      const max = Math.min(frame + seconds * this.frameRate, this.maxFrame);
      // Lets work our way in from both sides for faster checking
      for (let i = frame; i <= frame + (max - frame) / 2; i += 1) {
        if (!(this.imgs[i].cached && this.imgs[max - (i - frame)].cached)) {
          return false;
        }
      }
      return true;
    },
  },
});
</script>

<template>
  <div
    class="video-annotator"
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
    <slot
      ref="control"
      name="control"
      @resize="onResize"
    />
    <slot v-if="ready" />
  </div>
</template>

<style lang="scss" scoped>
@import "./annotator.scss";
</style>
