<script>
import Vue from 'vue';
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

export default Vue.extend({
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
    margin: {
      type: Number,
      default: 0,
    },
    data: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      x: null,
      tooltip: null,
      startFrame_: this.startFrame,
      endFrame_: this.endFrame,
      hoverTrack: null,
    };
  },
  computed: {
    tooltipComputed() {
      if (this.tooltip !== null) {
        return {
          style: {
            left: `${this.tooltip.left + 15}px`,
            top: `${this.tooltip.top + 15}px`,
          },
          ...this.tooltip,
        };
      }
      return null;
    },
    barData() {
      const sorted = sortBy(this.data.values, (data) => data.range[0]);
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
              const frameWidth = (x(this.startFrame_ + 1) - x(this.startFrame_)) * 0.6;
              bars.push({
                left: x(event.range[0]),
                right: x(event.range[1]),
                minWidth: frameWidth,
                top: i * 15 + 3,
                color: event.color,
                selected: event.selected,
                name: event.name,
                type: event.type,
                id: event.id,
                length: event.range[1] - event.range[0],
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
    this.detectBarHovering = debounce(this.detectBarHovering, 100);
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
        .range([this.margin, width]);
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
      canvas.width = this.clientWidth + this.margin;
      canvas.height = bars.slice(-1)[0].top + 15;
      const muteOpacity = '30'; // Hex string: how much to mute regular colors: '#RRGGBB[AA]'
      const selectedColor = this.$vuetify.theme.themes.dark.accent;
      const overflow = 0.7; // How much of a frame-width each detection box should occupy
      const barHeight = 10;
      bars.forEach((bar) => {
        const barWidth = Math.max(bar.right - bar.left, bar.minWidth);
        if (!bar.selected) {
          // If this bar is not selected
          const typeColor = bar.color ? bar.color : '#4c9ac2';
          const typeColorMuted = typeColor.concat(muteOpacity);
          ctx.fillStyle = this.data.muted
            ? typeColorMuted
            : typeColor;
          ctx.fillRect(bar.left, bar.top, barWidth, barHeight);
        } else if (bar.length === bar.markers.length - 1 || bar.markers.length === 0) {
          // Else if Keyframe density is 100%
          ctx.fillStyle = selectedColor;
          ctx.fillRect(bar.left, bar.top, barWidth, barHeight);
          this.scrollToElement(bar);
        } else {
          // Else draw individual feature frame segments
          // Decrease SelectedColor opacity to mute it.
          ctx.fillStyle = selectedColor.concat(muteOpacity);
          ctx.fillRect(bar.left, bar.top, barWidth, barHeight);
          const featureWidth = Math.min((barWidth / (bar.length - 1)) * overflow, 30);
          // Draw bright markers for the keyframes
          ctx.fillStyle = selectedColor;
          bar.markers
            .map(([f, interpolate]) => [this.x(f), interpolate])
            .forEach(([pos, interpolate], i) => {
              const barMiddle = bar.top + (barHeight / 2);
              const next = bar.markers[i + 1];
              ctx.fillRect(
                // offset frame back 1/2 width so the cursor falls in the middle
                pos,
                bar.top,
                featureWidth,
                barHeight,
              );
              if (next && interpolate) {
                const nextPos = this.x(next[0]);
                ctx.strokeStyle = 'yellow';
                ctx.moveTo(pos + featureWidth, barMiddle);
                ctx.lineTo(nextPos, barMiddle);
                ctx.stroke();
              }
            });
          this.scrollToElement(bar);
        }
      });
    },
    scrollToElement(selectedBar) {
      const eventChart = this.$refs.canvas.parentNode;
      const { offsetHeight } = eventChart;
      const { scrollTop } = eventChart;
      const { top } = selectedBar;
      if (top > offsetHeight + scrollTop || top < scrollTop) {
        eventChart.scrollTop = top - offsetHeight / 2.0;
      } else if (scrollTop > top) {
        eventChart.scrollTop = 0.0;
      }
    },
    mousemove(e) {
      this.tooltip = null;
      this.detectBarHovering(e);
    },
    mousedown() {
      if (this.hoverTrack !== null) {
        this.$emit('select-track', this.hoverTrack);
      }
    },
    mouseout() {
      this.detectBarHovering.cancel();
      this.hoverTrack = null;
    },
    detectBarHovering(e) {
      const { offsetX, offsetY } = e;
      const remainder = offsetY % 15;
      if (remainder > 10) {
        return;
      }
      const top = offsetY - (offsetY % 15) + 3;
      const bar = this.bars
        .filter((b) => b.top === top)
        .reverse()
        .find((b) => b.left < offsetX
        && (b.right > offsetX || b.left + b.minWidth > offsetX));
      if (!bar) {
        this.hoverTrack = null;
        return;
      }
      this.hoverTrack = bar.id;
      this.tooltip = {
        left: offsetX,
        top: offsetY,
        content: `${bar.name} (${bar.type})`,
      };
    },
  },
});
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
      @mousedown="mousedown"
    />
    <div
      v-if="tooltipComputed"
      class="tooltip"
      :style="tooltipComputed.style"
    >
      {{ tooltipComputed.content }}
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
    z-index: 2;
  }
}
</style>
