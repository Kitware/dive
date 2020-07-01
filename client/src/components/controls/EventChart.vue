<script>
import { throttle, debounce, sortBy } from 'lodash';
import * as d3 from 'd3';

function intersect(range1, range2) {
  const min = range1[0] < range2[0] ? range1 : range2;
  const max = min === range1 ? range2 : range1;
  if (min[1] < max[0]) {
    return null;
  }
  return [max[0], min[1] < max[1] ? min[1] : max[1]];
}

export default {
  name: 'EventChart',
  props: {
    startFrame: {
      type: Number,
      required: true,
    },
    endFrame: {
      type: Number,
      required: true,
    },
    maxFrame: {
      type: Number,
      required: true,
    },
    clientWidth: {
      type: Number,
      required: true,
    },
    data: {
      type: Array,
      required: true,
      validator(data) {
        return !data.find((datum) => !datum.range);
      },
    },
  },
  data() {
    return {
      x: null,
      tooltip: null,
      startFrame_: this.startFrame,
      endFrame_: this.endFrame,
    };
  },
  computed: {
    barData() {
      const sorted = sortBy(this.data, (data) => data.range[0]);
      const bars = [];
      sorted.forEach((event) => {
        for (let i = 0, n = bars.length; i < n; i += 1) {
          if (bars[i].endPosition < event.range[0]) {
            bars[i].events.push(event);
            // eslint-disable-next-line prefer-destructuring
            bars[i].endPosition = event.range[1];
            return;
          }
        }
        bars.push({
          startPoisiton: event.range[0],
          endPosition: event.range[1],
          events: [event],
        });
      });
      return bars;
    },
    bars() {
      if (!this.x) {
        return [];
      }
      const { startFrame_ } = this;
      const { endFrame_ } = this;
      const { x } = this;
      const bars = [];
      this.barData
        .filter((barData) => intersect(
          [startFrame_, endFrame_],
          [barData.startPoisiton, barData.endPosition],
        ))
        .forEach((barData, i) => {
          barData.events
            .filter((event) => intersect(
              [startFrame_, endFrame_],
              [event.range[0], event.range[1]],
            ))
            .forEach((event) => {
              const left = x(event.range[0]);
              bars.push({
                left,
                width: Math.max(x(event.range[1]) - left, 3),
                top: i * 15 + 3,
                color: event.color,
                selected: event.selected,
                name: event.name,
                markers: event.markers,
              });
            });
        });
      return bars;
    },
  },
  watch: {
    startFrame() {
      this.update();
    },
    endFrame() {
      this.update();
    },
    clientWidth() {
      this.initialize();
      this.update();
    },
    data() {
      this.update();
    },
  },
  created() {
    this.update = throttle(this.update, 20);
    this.detectBarHovering = debounce(this.detectBarHovering, 300);
    this.tooltipTimeoutHandle = null;
  },
  mounted() {
    this.initialize();
    this.update();
  },
  methods: {
    initialize() {
      const width = this.clientWidth;
      const x = d3
        .scaleLinear()
        .domain([this.startFrame_, this.endFrame_])
        .range([0, width]);
      this.x = x;
    },
    update() {
      this.startFrame_ = this.startFrame;
      this.endFrame_ = this.endFrame;
      this.x.domain([this.startFrame_, this.endFrame_]);
      const { canvas } = this.$refs;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const { bars } = this;
      if (!bars.length) {
        return;
      }
      canvas.width = this.clientWidth;
      canvas.height = bars.slice(-1)[0].top + 15;
      let selectedBar = null;
      bars.forEach((bar) => {
        const typeColor = bar.color ? bar.color : '#4c9ac2';
        if (bar.selected) {
          selectedBar = bar;
          /*
          ctx.fillStyle = 'white';
          bar.markers
            .map((n) => this.x(n))
            .slice(0, bar.markers.length - 1)
            .forEach((m, i) => {
              const current = bar.markers[i];
              const next = bar.markers[i + 1];
              const width = (current + 1 === next) ? 2 : 5;
              ctx.fillRect(m, bar.top, width, 10);
            });
          ctx.save();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 2;
          ctx.rect(
            bar.left,
            bar.top,
            bar.width,
            10,
          );
          ctx.stroke();
          ctx.restore();
          */
        } else {
          ctx.fillStyle = typeColor;
          ctx.fillRect(
            bar.left,
            bar.top,
            bar.width,
            10,
          );
        }
      });
      if (selectedBar) {
        //draw screen
        ctx.fillStyle = '#000000DD'; //black with opacity
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const bar = selectedBar;
        const typeColor = bar.color ? bar.color : '#4c9ac2';
        ctx.fillStyle = typeColor;
        ctx.strokeStyle = typeColor;
        ctx.lineWidth = 2;
        ctx.fillRect(
          bar.left,
          bar.top,
          bar.width,
          10,
        );
        ctx.fillStyle = '#000000AA'; //black with opacity
        ctx.fillRect(
          bar.left,
          bar.top,
          bar.width,
          10,
        );
        ctx.fillStyle = typeColor;
        bar.markers
          .map((n) => this.x(n))
          .slice(0, bar.markers.length - 1)
          .forEach((m, i) => {
            const current = bar.markers[i];
            const next = bar.markers[i + 1];
            const width = (current + 1 === next) ? 2 : 5;
            ctx.fillRect(m, bar.top, width, 10);
          });
        // ctx.save();

        //ctx.restore();
      }
    },
    mousemove(e) {
      this.tooltip = null;
      this.detectBarHovering(e);
    },
    mouseout() {
      this.detectBarHovering.cancel();
    },
    detectBarHovering(e) {
      const { offsetX, offsetY } = e;
      const remainder = offsetY % 15;
      if (remainder > 10) {
        return;
      }
      const top = offsetY - (offsetY % 15);
      const bar = this.bars
        .filter((b) => b.top === top)
        .reverse()
        .find((b) => b.left < offsetX && b.left + b.width > offsetX);
      if (!bar) {
        return;
      }
      this.tooltip = {
        left: offsetX,
        top: offsetY,
        content: bar.name,
      };
    },
  },
};
</script>

<template>
  <div
    class="event-chart"
    @mousewheel.prevent
  >
    <canvas
      ref="canvas"
      @mousemove="mousemove"
      @mouseout="mouseout"
    />
    <div
      v-if="tooltip"
      class="tooltip"
      :style="{ left: tooltip.left + 15 + 'px', top: tooltip.top + 5 + 'px' }"
    >
      {{ tooltip.content }}
    </div>
  </div>
</template>

<style lang="scss">
.event-chart {
  position: relative;
  height: calc(100% - 10px);
  margin: 5px 0;
  overflow-y: auto;
  overflow-x: hidden;

  .tooltip {
    position: absolute;
    background: black;
    border: 1px solid white;
    padding: 0px 5px;
    font-size: 14px;
    z-index: 1;
  }
}
</style>
