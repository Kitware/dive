import geo from 'geojs';
import Vue from 'vue';

import { throttle } from 'lodash';

export default {
  props: {
    frameRate: {
      type: Number,
      required: true,
    },
  },
  provide() {
    return {
      annotator: this.provided,
    };
  },
  data() {
    this.provided = new Vue({
      computed: {
        geoViewer: () => this.geoViewer,
        playing: () => this.playing,
        frame: () => this.frame,
        maxFrame: () => this.maxFrame,
        syncedFrame: () => this.syncedFrame,
      },
    });
    return {
      ready: false,
      playing: false,
      frame: 0,
      maxFrame: 0,
      syncedFrame: 0,
    };
  },
  watch: {
    playing(newval) {
      this.$emit('playing-state-changed', newval);
    },
  },
  created() {
    this.provided.$on('prev-frame', this.prevFrame);
    this.provided.$on('next-frame', this.nextFrame);
    this.provided.$on('play', this.play);
    this.provided.$on('pause', this.pause);
    this.provided.$on('seek', this.seek);
    this.emitFrame();
    this.emitFrame = throttle(this.emitFrame, 200);
  },
  methods: {
    baseInit() {
      const params = geo.util.pixelCoordinateParams(
        this.$refs.container,
        this.width,
        this.height,
        this.width,
        this.height,
      );
      this.geoViewer = geo.map(params.map);
      this.geoViewer.zoomRange({
        min: this.geoViewer.zoomRange().origMin,
        max: this.geoViewer.zoomRange().max + 3,
      });
      const interactorOpts = this.geoViewer.interactor().options();
      interactorOpts.keyboard.focusHighlight = false;
      interactorOpts.keyboard.actions = {};
      interactorOpts.actions = [
        interactorOpts.actions[0],
        interactorOpts.actions[2],
        interactorOpts.actions[6],
        interactorOpts.actions[7],
        interactorOpts.actions[8],
      ];
      interactorOpts.zoomAnimation = {
        enabled: false,
      };
      interactorOpts.momentum = {
        enabled: false,
      };
      interactorOpts.wheelScaleY = 0.2;
      this.geoViewer.interactor().options(interactorOpts);
    },
    prevFrame() {
      const targetFrame = this.frame - 1;
      if (targetFrame >= 0) {
        this.seek(targetFrame);
      }
    },
    nextFrame() {
      const targetFrame = this.frame + 1;
      if (targetFrame <= this.maxFrame) {
        this.seek(targetFrame);
      }
    },
    emitFrame() {
      this.$emit('frame-update', this.frame);
    },
    rendered() {},
  },
};
