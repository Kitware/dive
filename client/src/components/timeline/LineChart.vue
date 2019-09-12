<script>
import * as d3 from "d3";

export default {
  name: "LineChart",
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
      required: true
    }
  },
  computed: {
    lineData() {
      return this.data.map(datum => {
        var lastFrame = 0;
        var lastPoint = [0, 0];
        var output = [];
        datum.forEach(point => {
          var frame = point[0];
          if (point[1] !== lastPoint[1] || frame !== lastFrame + 1) {
            if (lastPoint[0] !== lastFrame) {
              output.push([lastFrame, lastPoint[1]]);
            }
            if (frame !== lastFrame + 1) {
              output.push([lastFrame + 1, 0]);
              if (frame !== lastFrame + 2) {
                output.push([frame - 1, 0]);
              }
            }
            output.push(point);
            lastPoint = point;
          }
          lastFrame = frame;
        });
        if (this.maxFrame != lastFrame) {
          output.push([lastFrame + 1, 0]);
          if (this.maxFrame != lastFrame + 1) {
            output.push([this.maxFrame, 0]);
          }
        }
        return output;
      });
    }
  },
  watch: {
    startFrame() {
      this.update();
    },
    endFrame() {
      this.update();
    }
  },
  mounted() {
    var width = this.$el.clientWidth;
    var height = this.$el.clientHeight;
    var x = d3
      .scaleLinear()
      .domain([this.startFrame, this.endFrame])
      .range([0, width]);
    this.x = x;
    var max = d3.max(this.lineData, datum => d3.max(datum, d => d[1]));
    var y = d3
      .scaleLinear()
      .domain([0, max + max * 0.2])
      .range([height, 0]);

    var line = d3
      .line()
      .curve(d3.curveStep)
      .x(d => {
        return x(d[0]);
      })
      .y(d => {
        return y(d[1]);
      });
    this.line = line;

    var g = d3
      .select(this.$el)
      .append("svg")
      .attr("class", "line-chart")
      .style("display", "block")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(0,-1)`);
    var path = g
      .append("path")
      .attr("class", "line")
      .data(this.lineData)
      .attr("d", line);
    this.path = path;
    var axis = d3.axisRight(y);
    this.axis = axis;
    g.append("g")
      .attr("class", "axis-y")
      .call(axis);
  },
  methods: {
    update() {
      this.x.domain([this.startFrame, this.endFrame]);
      this.line.x(d => {
        return this.x(d[0]);
      });
      this.path.attr("d", this.line);
    },
    rendered() {
      console.log("linechart rendered");
    }
  }
};
</script>

<template>
  <div style="height:100%;">{{ rendered() }}</div>
</template>

<style lang="scss">
.line-chart {
  .line {
    fill: none;
    stroke: steelblue;
    stroke-width: 1.5px;
  }

  .axis-y g:first-of-type,
  .axis-y g:last-of-type {
    display: none;
  }
}
</style>
