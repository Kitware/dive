<script>
import { throttle, sortBy } from "lodash";
import * as d3 from "d3";

export default {
  name: "EventChart",
  props: {
    startFrame: {
      type: Number,
      required: true
    },
    endFrame: {
      type: Number,
      required: true
    },
    maxFrame: {
      type: Number,
      required: true
    },
    data: {
      type: Array,
      required: true,
      validator(data) {
        return !data.find(datum => {
          return !datum.range;
        });
      }
    }
  },
  data: () => ({ x: null, tooltip: null }),
  computed: {
    barData() {
      var sorted = sortBy(this.data, data => data.range[0]);
      var bars = [];
      sorted.forEach(event => {
        for (let bar of bars) {
          if (bar.endPosition < event.range[0]) {
            bar.events.push(event);
            bar.endPosition = event.range[1];
            return;
          }
        }
        bars.push({
          startPoisiton: event.range[0],
          endPosition: event.range[1],
          events: [event]
        });
      });
      return bars;
    },
    bars() {
      if (!this.x) {
        return [];
      }
      var bars = [];
      this.barData
        .filter(barData =>
          intersect(
            [this.startFrame, this.endFrame],
            [barData.startPoisiton, barData.endPosition]
          )
        )
        .forEach((barData, i) => {
          barData.events
            .filter(event =>
              intersect(
                [this.startFrame, this.endFrame],
                [event.range[0], event.range[1]]
              )
            )
            .forEach(event => {
              var x = this.x;

              var left = x(event.range[0]);
              bars.push({
                left: x(event.range[0]),
                width: x(event.range[1]) - left,
                top: i * 15,
                color: event.color,
                name: event.name
              });
            });
        });
      return bars;
    }
  },
  watch: {
    startFrame() {
      this.update();
    },
    endFrame() {
      this.update();
    },
    lineData() {
      this.initialize();
      this.update();
    }
  },
  created() {
    this.update = throttle(this.update, 30);
    this.tooltipTimeoutHandle = null;
  },
  mounted() {
    this.initialize();
  },
  methods: {
    initialize() {
      var width = this.$el.clientWidth;
      var x = d3
        .scaleLinear()
        .domain([this.startFrame, this.endFrame])
        .range([0, width]);
      this.x = x;
    },
    update() {
      this.x.domain([this.startFrame, this.endFrame]);
    },
    barMouseenter(e, name) {
      var left =
        e.clientX - e.target.parentElement.getBoundingClientRect().left;
      var top = e.clientY - e.target.parentElement.getBoundingClientRect().top;
      clearTimeout(this.tooltipTimeoutHandle);
      this.tooltipTimeoutHandle = setTimeout(() => {
        this.tooltip = {
          left,
          top,
          content: name
        };
      }, 200);
    },
    barMouseout() {
      clearTimeout(this.tooltipTimeoutHandle);
      this.tooltip = null;
    }
  }
};

function intersect(range1, range2) {
  var min = range1[0] < range2[0] ? range1 : range2;
  var max = min == range1 ? range2 : range1;
  if (min[1] < max[0]) {
    return null;
  }
  return [max[0], min[1] < max[1] ? min[1] : max[1]];
}
</script>

<template>
  <div class="event-chart">
    <div
      class="bar"
      v-for="(bar, i) in bars"
      :key="i"
      :style="{
        left: bar.left + 'px',
        width: bar.width + 'px',
        top: bar.top + 'px',
        backgroundColor: bar.color ? bar.color : '#4c9ac2'
      }"
      @mousemove="barMouseenter($event, bar.name)"
      @mouseout="barMouseout"
    ></div>
    <div
      class="tooltip"
      v-if="tooltip"
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

  .bar {
    position: absolute;
    height: 10px;
    min-width: 3px;
  }

  .tooltip {
    position: absolute;
    background: white;
    border: 1px solid black;
    padding: 0px 5px;
    font-size: 14px;
  }
}
</style>
