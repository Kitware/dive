<script>
import * as d3 from "d3";
import { scaleLinear } from "d3-scale";
import { axisTop } from "d3-axis";

export default {
  name: "Timeline",
  props: {
    maxFrame: {
      type: Number,
      default: 100
    },
    frame: {
      type: Number,
      default: 0
    },
    seek: {
      type: Function
    }
  },
  data() {
    return {
      mounted: false,
      startFrame: 0,
      endFrame: this.maxFrame
    };
  },
  computed: {
    minimapFillStyle() {
      return {
        left: (this.startFrame / this.maxFrame) * 100 + "%",
        width: ((this.endFrame - this.startFrame) / this.maxFrame) * 100 + "%"
      };
    },
    handLeftPosition() {
      if (
        !this.mounted ||
        this.frame < this.startFrame ||
        this.frame > this.endFrame
      ) {
        return null;
      }
      return Math.round(
        this.$refs.workarea.clientWidth *
          ((this.frame - this.startFrame) / (this.endFrame - this.startFrame))
      );
    }
  },
  watch: {
    maxFrame(value) {
      this.endFrame = value;
      this.update();
    },
    startFrame() {
      this.update();
    },
    endFrame() {
      this.update();
    },
    handLeftPosition(value) {
      this.$refs.hand.style.left = (value ? value : "-10") + "px";
    },
    frame(frame) {
      if (frame > this.endFrame) {
        this.endFrame = Math.min(frame + 200, this.maxFrame);
      } else if (frame < this.startFrame) {
        this.startFrame = Math.max(frame - 100, 0);
      }
    }
  },
  mounted() {
    var width = this.$refs.workarea.clientWidth;
    var height = this.$refs.workarea.clientHeight;
    var scale = scaleLinear()
      .domain([0, this.maxFrame])
      .range([0, width]);
    this.scale = scale;
    var axis = axisTop()
      .scale(scale)
      .tickSize(height - 30)
      .tickSizeOuter(0);
    this.axis = axis;
    this.g = d3
      .select(this.$refs.workarea)
      .append("svg")
      .style("display", "block")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(0,${height - 15})`);
    this.updateAxis();
    this.mounted = true;
  },
  methods: {
    onwheel(e) {
      var extend = e.deltaY * 5;
      var ratio =
        extend < 0
          ? (e.clientX - this.$el.offsetLeft) / this.$el.clientWidth
          : 0.5;
      var startFrame = this.startFrame - extend * ratio;
      var endFrame = this.endFrame + extend * (1 - ratio);
      startFrame = Math.max(0, startFrame);
      endFrame = Math.min(this.maxFrame, endFrame);
      if (startFrame >= endFrame - 300) {
        return;
      }
      this.startFrame = startFrame;
      this.endFrame = endFrame;
    },
    updateAxis() {
      this.g
        .call(this.axis)
        .call(g =>
          g
            .selectAll(".tick line")
            .attr("stroke-opacity", 0.5)
            .attr("stroke-dasharray", "2,2")
        )
        .call(g =>
          g
            .selectAll(".tick text")
            .attr("y", 0)
            .attr("dy", 12)
        );
    },
    update() {
      this.scale.domain([this.startFrame, this.endFrame]);
      this.axis.scale(this.scale);
      this.updateAxis();
    },
    emitSeek(e) {
      var frame = Math.round(
        ((e.clientX - this.$refs.workarea.offsetLeft) /
          this.$refs.workarea.clientWidth) *
          (this.endFrame - this.startFrame) +
          this.startFrame
      );
      this.seek(frame);
    },
    workareaMouseup(e) {
      if (this.dragging) {
        this.emitSeek(e);
      }
      this.dragging = false;
    },
    workareaMousedown(e) {
      this.dragging = true;
      e.preventDefault();
    },
    workareaMousemove(e) {
      if (this.dragging) {
        this.emitSeek(e);
      }
      e.preventDefault();
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
        console.log("which", e.which);
        this.minimapDragging = false;
        return;
      }
      var delta = this.minimapDraggingStartClientX - e.clientX;
      var frameDelta = (delta / this.$refs.minimap.clientWidth) * this.maxFrame;
      var startFrame = this.minimapDraggingStartFrame - frameDelta;
      if (startFrame < 0) {
        return;
      }
      var endFrame = this.minimapDraggingEndFrame - frameDelta;
      if (endFrame > this.maxFrame) {
        return;
      }
      this.startFrame = startFrame;
      this.endFrame = endFrame;
    },
    containerMouseup() {
      this.minimapDragging = false;
    },
    render() {
      console.log("render");
    }
  }
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
      class="work-area"
      ref="workarea"
      @mouseup="workareaMouseup"
      @mousedown="workareaMousedown"
      @mousemove="workareaMousemove"
    >
      <div class="hand" ref="hand"></div>
    </div>
    <div class="minimap" ref="minimap">
      <div
        class="fill"
        :style="minimapFillStyle"
        @mousedown="minimapFillMousedown"
      >
        {{ render() }}
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.timeline {
  min-height: 200px;
  display: flex;
  flex-direction: column;

  .work-area {
    flex: 1;
    position: relative;

    .hand {
      position: absolute;
      top: 0;
      width: 0;
      height: 100%;
      border-left: 1px solid #299be3;
    }
  }

  .minimap {
    height: 8px;

    .fill {
      position: relative;
      height: 100%;
      background-color: #80c6e8;
    }
  }
}
</style>
