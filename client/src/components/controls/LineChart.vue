<script>
import { throttle } from 'lodash';
import * as d3 from 'd3';

export default {
  name: 'LineChart',
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
    clientHeight: {
      type: Number,
      required: true,
    },
    data: {
      type: Array,
      required: true,
      validator(data) {
        return !data.find((datum) => !Array.isArray(datum.values));
      },
    },
  },
  computed: {
    /**
     * Useful way to compute properties together for a single watcher so if either change
     * In the future this can be done easily with compositionAPI
     */
    clientDimensions() {
      return { width: this.clientWidth, height: this.clientHeight };
    },
  },
  watch: {
    startFrame() {
      this.update();
    },
    endFrame() {
      this.update();
    },
    clientDimensions() {
      this.initialize();
      this.update();
    },
    data() {
      this.initialize();
      this.update();
    },
  },
  created() {
    this.update = throttle(this.update, 30);
  },
  mounted() {
    this.initialize();
  },
  methods: {
    initialize() {
      d3.select(this.$el)
        .select('svg')
        .remove();
      let tooltipTimeoutHandle = null;
      const tooltip = d3
        .select(this.$el)
        .append('div')
        .attr('class', 'tooltip')
        .style('display', 'none');
      const width = this.clientWidth;
      const height = this.clientHeight;
      const x = d3
        .scaleLinear()
        .domain([this.startFrame, this.endFrame])
        .range([0, width]);
      this.x = x;
      const max = d3.max(this.data, (datum) => d3.max(datum.values, (d) => d[1]));
      const y = d3
        .scaleLinear()
        .domain([0, Math.max(max + max * 0.2, 2)])
        .range([height, 0]);

      const line = d3
        .line()
        .curve(d3.curveStepAfter)
        .x((d) => x(d[0]))
        .y((d) => y(d[1]));
      this.line = line;

      const svg = d3
        .select(this.$el)
        .append('svg')
        .style('display', 'block')
        .attr('width', width)
        .attr('height', height)
        .append('g')
        .attr('transform', 'translate(0,-1)');

      const axis = d3.axisRight(y).tickSize(width);
      svg
        .append('g')
        .attr('class', 'axis-y')
        .call(axis)
        .call((g) => g
          .selectAll('.tick text')
          .attr('x', 0)
          .attr('dx', 13));

      const path = svg
        .selectAll()
        .data(this.data)
        .enter()
        .append('path')
        .attr('class', 'line')
        .attr('d', (d) => line(d.values))
        .style('stroke', (d) => (d.color ? d.color : '#4c9ac2'))
        // Non-Arrow function to preserve the 'this' context for d3.mouse(this)
        .on('mouseenter', function mouseEnterHandler(d) {
          const [_x, _y] = d3.mouse(this);
          tooltipTimeoutHandle = setTimeout(() => {
            tooltip
              .style('left', `${_x + 2}px`)
              .style('top', `${_y - 25}px`)
              .text(d.name)
              .style('display', 'block');
          }, 200);
        })
        .on('mouseout', () => {
          clearTimeout(tooltipTimeoutHandle);
          tooltip.style('display', 'none');
        });
      this.path = path;
    },
    update() {
      this.x.domain([this.startFrame, this.endFrame]);
      this.line.x((d) => this.x(d[0]));
      this.path.attr('d', (d) => this.line(d.values));
    },
    rendered() {},
  },
};
</script>

<template>
  <div class="line-chart">
    {{ rendered() }}
  </div>
</template>

<style lang="scss">
.line-chart {
  height: 100%;

  .line {
    fill: none;
    stroke-width: 1.5px;
  }

  .axis-y {
    font-size: 12px;

    g:first-of-type,
    g:last-of-type {
      display: none;
    }
  }

  .tooltip {
    position: absolute;
    background: black;
    border: 1px solid white;
    padding: 0px 5px;
    font-size: 14px;
  }
}
</style>
