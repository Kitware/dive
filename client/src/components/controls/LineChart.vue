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
    data: {
      type: Array,
      required: true,
      validator(data) {
        return !data.find((datum) => !Array.isArray(datum.values));
      },
    },
  },
  computed: {
    lineData() {
      return this.data.map((datum) => {
        let lastFrame = -1;
        // var lastPoint = [0, 0];
        const padZero = [];
        datum.values.forEach((point) => {
          const frame = point[0];
          if (frame !== lastFrame + 1) {
            for (let i = lastFrame + 1; i < frame; i += 1) {
              padZero.push([i, 0]);
            }
          }
          padZero.push(point);
          lastFrame = frame;
        });
        if (this.maxFrame !== lastFrame) {
          for (let i = lastFrame + 1; i <= this.maxFrame; i += 1) {
            padZero.push([i, 0]);
          }
        }
        const clean = [padZero[0]];
        let lastValue = padZero[0][1];
        for (let i = 1; i < padZero.length; i += 1) {
          if (padZero[i][1] !== lastValue) {
            clean.push(padZero[i - 1]);
            clean.push(padZero[i]);
            // eslint-disable-next-line prefer-destructuring
            lastValue = padZero[i][1];
          }
        }
        if (clean.slice(-1)[0][0] !== this.maxFrame) {
          clean.push(padZero.slice(-1)[0]);
        }
        return { ...datum, values: clean };
      });
    },
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
      const width = this.$el.clientWidth;
      const height = this.$el.clientHeight;
      const x = d3
        .scaleLinear()
        .domain([this.startFrame, this.endFrame])
        .range([0, width]);
      this.x = x;
      const max = d3.max(this.lineData, (datum) => d3.max(datum.values, (d) => d[1]));
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
        .data(this.lineData)
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
