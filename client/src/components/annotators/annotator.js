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
        filename: () => this.filename,
        maxFrame: () => this.maxFrame,
        syncedFrame: () => this.syncedFrame,
      },
    });
    return {
      ready: false,
      playing: false,
      frame: 0,
      filename: '',
      maxFrame: 0,
      syncedFrame: 0,
      observer: null,
    };
  },
  created() {
    this.provided.$on('prev-frame', this.prevFrame);
    this.provided.$on('next-frame', this.nextFrame);
    this.provided.$on('play', this.play);
    this.provided.$on('pause', this.pause);
    this.provided.$on('seek', this.seek);
    this.provided.$on('reset-zoom', this.resetZoom);
    this.emitFrame();
    this.emitFrame = throttle(this.emitFrame, 200);
  },
  mounted() {
    //Adjusts the size to fix the geoMap display if any of the contents sizes change.
    if (this.$refs.container) {
      this.observer = new ResizeObserver(() => {
        this.onResize();
      });
      this.observer.observe(this.$refs.container);
    }
  },
  beforeDestroy() {
    this.provided.$off();
    if (this.observer) {
      this.observer.unobserve(this.$refs.container);
    }
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
      interactorOpts.click.cancelOnMove = 5;

      interactorOpts.actions = [
        interactorOpts.actions[0],
        // The action below is needed to have GeoJS use the proper handler
        // with cancelOnMove for right clicks
        {
          action: 'geo_action_select',
          input: { right: true },
          name: 'button edit',
          owner: 'geo.MapIteractor',
        },
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
    emitFrame() {
      this.$emit('frame-update', this.frame);
    },
    rendered() {},
    resetZoom() {
      this.geoViewer.zoom(-1);
      this.geoViewer.center({ x: 0, y: 0 });
    },
  },
};
