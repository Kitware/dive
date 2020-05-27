<script>
export default {
  name: 'TextLayer',
  inject: ['annotator'],
  props: {
    data: {
      type: Array,
      required: true,
    },
    stateStyling: {
      type: Object,
      default: () => {},
    },
    typeColorMap: {
      type: Function,
      default: () => {},
    },
  },
  watch: {
    data() {
      this.frameChanged();
      this.updateStyle();
    },
  },
  mounted() {
    this.textStyle = this.createTextStyle();
    this.featureLayer = this.annotator.geoViewer.createLayer('feature', {
      features: ['text'],
    });
    this.textFeature = this.featureLayer
      .createFeature('text')
      .text((data) => data.text)
      .position((data) => ({ x: data.x, y: data.y }));
    this.frameChanged();
    this.updateStyle();
  },
  beforeDestroy() {
    this.textFeature.data([]).draw();
    this.annotator.geoViewer.removeChild(this.featureLayer);
  },
  methods: {
    frameChanged() {
      this.textFeature.data(this.computeData()).draw();
    },
    updateStyle() {
      let offset = {
        x: 3,
        y: 0,
      };
      if (this.textStyle.offsetX || this.textStyle.offsetY) {
        offset = (a, b, c) => ({
          x: this.textStyle.offsetX ? this.textStyle.offsetX(a, b, c) : 3,
          y: this.textStyle.offsetY ? this.textStyle.offsetY(a, b, c) : 0,
        });
      }
      const style = {
        ...{
          fontSize: '14px',
          textAlign: 'left',
          color: this.stateStyling.standard.color,
          textBaseline: 'top',
          offset,
        },
        ...this.textStyle,
      };
      this.textFeature.style(style).draw();
    },
    createTextStyle() {
      return {
        color: (data) => {
          if (data.editing) {
            if (!data.selected) {
              if (this.stateStyling.disabled.color !== 'type') {
                return this.stateStyling.disabled.color;
              }
              if (data.confidencePairs && data.confidencePairs.length) {
                return this.typeColorMap(data.confidencePairs[0][0]);
              }
            }
            return this.stateStyling.selected.color;
          }
          if (data.selected) {
            return this.stateStyling.selected.color;
          }
          if (data.confidencePairs && data.confidencePairs.length) {
            return this.typeColorMap(data.confidencePairs[0][0]);
          }
          return this.stateStyling.standard.color;
        },
        offsetY(data) {
          return data.offsetY;
        },
      };
    },
    computeData() {
      const arr = [];
      this.data.forEach((track) => {
        if (track.confidencePairs && track.features) {
          const { bounds } = track.features;
          if (bounds) {
            track.confidencePairs.forEach(([type, confidence], i) => {
              arr.push({
                selected: track.selected,
                editing: track.editing,
                confidencePairs: track.confidencePairs,
                text: `${type}: ${confidence.toFixed(2)}`,
                x: bounds[1],
                y: bounds[2],
                offsetY: i * 14,
              });
            });
          }
        }
      });
      return arr;
    },
  },
};
</script>
<template>
  <div />
</template>
