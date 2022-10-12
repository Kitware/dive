<script>
import { throttle } from 'lodash';
import * as d3 from 'd3';

export default {
  name: 'Timeline',
  props: {
    maxFrame: {
      type: Number,
      default: 0,
    },
    frame: {
      type: Number,
      default: 0,
    },
    display: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      init: !!this.maxFrame,
      mounted: false,
      startFrame: 0,
      endFrame: this.maxFrame,
      timelineScale: null,
      clientWidth: 0,
      clientHeight: 0,
      margin: 20,
    };
  },
  computed: {
    minimapFillStyle() {
      return {
        left: `${(this.startFrame / this.maxFrame) * 100}%`,
        width: `${((this.endFrame - this.startFrame) / this.maxFrame) * 100}%`,
      };
    },
    handLeftPosition() {
      if (
        !this.mounted
        || this.frame < this.startFrame
        || this.frame > this.endFrame
      ) {
        return null;
      }
      return Math.round(
        this.margin + (this.clientWidth - this.margin)
          * ((this.frame - this.startFrame) / (this.endFrame - this.startFrame)),
      );
    },
  },
  watch: {
    maxFrame(value) {
      this.endFrame = value;
      this.init = true;
      this.update();
    },
    startFrame() {
      this.update();
    },
    endFrame() {
      this.update();
    },
    handLeftPosition(value) {
      this.$refs.hand.style.left = `${value || '-10'}px`;
    },
    frame(frame) {
      if (frame > this.endFrame) {
        this.endFrame = Math.min(frame + 200, this.maxFrame);
      } else if (frame < this.startFrame) {
        this.startFrame = Math.max(frame - 100, 0);
      }
    },
    display(val) {
      if (!val) {
        this.clientHeight = 0;
      } else {
        this.initialize();
      }
    },
  },
  created() {
    this.update = throttle(this.update, 30);
    // Only resize when finished dragging the window
    window.addEventListener('resize', this.resizeHandler);
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.resizeHandler);
  },
  mounted() {
    this.initialize();
  },
  methods: {
    initialize() {
      const width = this.$refs.workarea.clientWidth || 0;
      const height = this.$refs.workarea.clientHeight || 0;
      // clientWidth and clientHeight are properties used to resize child elements
      this.clientWidth = width - this.margin;
      // Timeline height needs to offset so it doesn't overlap the frame number
      this.clientHeight = height - 15;
      const scale = d3
        .scaleLinear()
        .domain([0, this.maxFrame])
        .range([this.margin, this.clientWidth]);
      this.timelineScale = scale;
      const axis = d3
        .axisTop()
        .scale(scale)
        .tickSize(height - 30)
        .tickSizeOuter(0);
      this.axis = axis;
      if (!this.svg) {
        this.svg = d3
          .select(this.$refs.workarea)
          .append('svg');
      }
      this.svg.style('display', 'block')
        .attr('width', this.clientWidth)
        .attr('height', height);
      if (!this.g) {
        this.g = this.svg.append('g')
          .attr('transform', `translate(0,${height - 15})`);
      }

      this.updateAxis();
      this.mounted = true;
    },
    resizeHandler() {
      // Debounces resize to prevent it from be calling continuously.
      clearTimeout(this.resizeTimer);
      this.resizeTimer = setTimeout(this.initialize, 200);
    },
    onwheel(e) {
      const extend = Math.round((this.endFrame - this.startFrame) * 0.2)
        * Math.sign(e.deltaY);
      const ratio = (e.layerX - this.$el.offsetLeft) / this.clientWidth;
      let startFrame = this.startFrame - extend * ratio;
      let endFrame = this.endFrame + extend * (1 - ratio);
      startFrame = Math.max(0, startFrame);
      endFrame = Math.min(this.maxFrame, endFrame);
      if (startFrame >= endFrame - 10) {
        return;
      }
      this.startFrame = startFrame;
      this.endFrame = endFrame;
    },
    updateAxis() {
      this.g.call(this.axis).call((g) => g
        .selectAll('.tick text')
        .attr('y', 0)
        .attr('dy', 13));
    },
    update() {
      this.timelineScale.domain([this.startFrame, this.endFrame]);
      this.axis.scale(this.timelineScale);
      this.updateAxis();
    },
    emitSeek(e) {
      const leftBounds = (this.$refs.workarea.getBoundingClientRect().left + this.margin);
      const rightBounds = (this.$refs.workarea.getBoundingClientRect().right - this.margin);
      if (e.clientX > leftBounds && e.clientX < rightBounds) {
        const frame = Math.round(
          ((e.clientX - leftBounds)
          / (this.clientWidth - this.margin))
          * (this.endFrame - this.startFrame)
          + this.startFrame,
        );
        this.$emit('seek', frame);
      }
    },
    workareaMouseup(e) {
      if (this.dragging) {
        this.emitSeek(e);
      }
      this.dragging = false;
    },
    workareaMousedown() {
      this.dragging = true;
      // e.preventDefault();
    },
    workareaMousemove(e) {
      if (this.dragging) {
        this.emitSeek(e);
      }
      e.preventDefault();
    },
    workareaMouseleave() {
      this.dragging = false;
    },
    minimapFillMousedown(e) {
      e.preventDefault();
      this.minimapDragging = true;
      this.minimapDraggingStartClientX = e.clientX;
      this.minimapDraggingStartFrame = this.startFrame;
      this.minimapDraggingEndFrame = this.endFrame;
    },
    containerMousemove(e) {
      e.preventDefault();
      if (!this.minimapDragging) {
        return;
      }
      if (!e.which) {
        this.minimapDragging = false;
        return;
      }
      const delta = this.minimapDraggingStartClientX - e.clientX;
      const frameDelta = (delta / this.clientWidth) * this.maxFrame;
      const startFrame = this.minimapDraggingStartFrame - frameDelta;
      if (startFrame < 0) {
        return;
      }
      const endFrame = this.minimapDraggingEndFrame - frameDelta;
      if (endFrame > this.maxFrame) {
        return;
      }
      this.startFrame = startFrame;
      this.endFrame = endFrame;
    },
    containerMouseup() {
      this.minimapDragging = false;
    },
  },
};
</script>

<template>
  <div
    class="timeline"
    @wheel="onwheel"
    @mouseup="containerMouseup"
    @mousemove="containerMousemove"
  >
    <div
      ref="workarea"
      class="work-area"
      @mouseup="workareaMouseup"
      @mousedown="workareaMousedown"
      @mousemove="workareaMousemove"
      @mouseleave="workareaMouseleave"
    >
      <div
        ref="hand"
        class="hand"
      />
      <div
        v-if="init && mounted"
        class="child"
      >
        <slot
          name="child"
          :startFrame="startFrame"
          :endFrame="endFrame"
          :maxFrame="maxFrame"
          :clientWidth="clientWidth"
          :clientHeight="clientHeight"
          :margin="margin"
        />
      </div>
    </div>
    <div
      ref="minimap"
      class="minimap"
    >
      <div
        class="fill"
        :style="minimapFillStyle"
        @mousedown="minimapFillMousedown"
      >
        <!-- {{ rendered() }} -->
      </div>
    </div>
    <slot />
  </div>
</template>

<style lang="scss" scoped>
.timeline {
  min-height: 175px;
  position: relative;
  display: flex;
  flex-direction: column;

  .work-area {
    flex: 1;
    position: relative;
    overflow: hidden;

    .hand {
      position: absolute;
      top: 0;
      width: 0;
      height: 100%;
      border-left: 1px solid #299be3;
      z-index:1;
    }

    .child {
      position: absolute;
      top: 0;
      bottom: 17px;
      left: 0;
      right: 0;
    }
  }

  .minimap {
    height: 10px;

    .fill {
      position: relative;
      height: 100%;
      background-color: #80c6e8;
    }
  }
}
</style>

<style lang="scss">
.timeline {
  .tick {
    shape-rendering: crispEdges;
    font-size: 12px;
    stroke-opacity: 0.5;
    stroke-dasharray: 2, 2;
  }
}
</style>
