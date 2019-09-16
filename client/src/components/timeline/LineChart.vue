<script>
import { throttle } from "lodash";
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
      required: true,
      validator(data) {
        return !data.find(datum => {
          return !Array.isArray(datum.values);
        });
      }
    }
  },
  computed: {
    lineData() {
      return this.data.map(datum => {
        var lastFrame = 0;
        var lastPoint = [0, 0];
        var output = [];
        datum.values.forEach(point => {
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
        return { ...datum, values: output };
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
  created() {
    this.update = throttle(this.update, 30);
  },
  mounted() {
    var width = this.$el.clientWidth;
    var height = this.$el.clientHeight;
    var x = d3
      .scaleLinear()
      .domain([this.startFrame, this.endFrame])
      .range([0, width]);
    this.x = x;
    var max = d3.max(this.lineData, datum => d3.max(datum.values, d => d[1]));
    var y = d3
      .scaleLinear()
      .domain([0, Math.max(max + max * 0.2, 2)])
      .range([height, 0]);

    var line = d3
      .line()
      .curve(d3.curveStep)
      .x(d => x(d[0]))
      .y(d => y(d[1]));
    this.line = line;

    var svg = d3
      .select(this.$el)
      .append("svg")
      .style("display", "block")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(0,-1)`);
    var path = svg
      .selectAll()
      .data(this.lineData)
      .enter()
      .append("path")
      .attr("class", "line")
      .attr("d", d => line(d.values))
      .style("stroke", d => (d.color ? d.color : "#4c9ac2"))
      .on("mouseenter", function(d) {
        var [x, y] = d3.mouse(this);
        tooltipTimeoutHandle = setTimeout(() => {
          tooltip
            .style("left", x + 2 + "px")
            .style("top", y - 25 + "px")
            .text(d.name)
            .style("display", "block");
        }, 200);
      })
      .on("mouseout", function() {
        clearTimeout(tooltipTimeoutHandle);
        tooltip.style("display", "none");
      });
    this.path = path;
    var axis = d3.axisRight(y);
    this.axis = axis;
    svg
      .append("g")
      .attr("class", "axis-y")
      .call(axis);
    var tooltip = d3
      .select(this.$el)
      .append("div")
      .attr("class", "tooltip")
      .style("display", "none");
    var tooltipTimeoutHandle = null;
  },
  methods: {
    update() {
      this.x.domain([this.startFrame, this.endFrame]);
      this.line.x(d => {
        return this.x(d[0]);
      });
      this.path.attr("d", d => this.line(d.values));
    },
    rendered() {
      console.log("linechart rendered");
    }
  }
};
</script>

<template>
  <div class="line-chart" style="height:100%;">{{ rendered() }}</div>
</template>

<style lang="scss">
.line-chart {
  .line {
    fill: none;
    stroke-width: 1.5px;
  }

  .axis-y g:first-of-type,
  .axis-y g:last-of-type {
    display: none;
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
