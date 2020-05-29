<script>
import geo from 'geojs';
import { boundToGeojson } from '@/utils';

export default {
  name: 'AnnotationLayer',
  inject: ['annotator'],
  props: {
    data: {
      type: Array,
      required: true,
    },
    stateStyling: {
      type: Object,
      default: () => 'foo',
    },
    typeColorMap: {
      type: Function,
      default: () => 'foo',
    },
  },
  watch: {
    data() {
      this.frameChanged();
      this.updateStyle();
    },
  },
  mounted() {
    this.annotationStyle = this.createAnnotationStyle();
    this.featureLayer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point', 'line', 'polygon'],
    });
    this.polygonFeature = this.featureLayer
      .createFeature('polygon', { selectionAPI: true })
      .geoOn(geo.event.feature.mouseclick, (e) => {
        if (e.mouse.buttonsDown.left) {
          console.warn('annotation clicked');
          this.$emit('annotation-click', e.data.trackId, false);
        } else if (e.mouse.buttonsDown.right) {
          this.$emit('annotation-right-click', e.data.trackId, true);
        }
      });
    this.polygonFeature.geoOn(
      geo.event.feature.mouseclick_order,
      this.polygonFeature.mouseOverOrderClosestBorder,
    );
    this.frameChanged();
    this.updateStyle();
  },
  beforeDestroy() {
    this.annotator.geoViewer.removeChild(this.featureLayer);
  },
  methods: {
    updateStyle() {
      const style = {
        ...{
          stroke: true,
          uniformPolygon: true,
          strokeColor: this.stateStyling.standard.color,
          strokeWidth: 1,
          fill: false,
        },
        ...this.annotationStyle,
      };
      this.polygonFeature.style(style).draw();
    },
    createAnnotationStyle() {
      return {
        strokeColor: (a, b, data) => {
          if (data.editing) {
            if (!data.selected) {
              if (this.stateStyling.disabled.color !== 'type') {
                return this.stateStyling.disabled.color;
              }
              if (data.confidencePairs.length) {
                return this.typeColorMap(data.confidencePairs[0][0]);
              }
            }
            return this.stateStyling.selected.color;
          }
          if (data.selected) {
            return this.stateStyling.selected.color;
          }
          if (data.confidencePairs.length) {
            return this.typeColorMap(data.confidencePairs[0][0]);
          }
          return this.typeColorMap.range()[0];
        },
        strokeOpacity: (a, b, data) => {
          if (data.editing) {
            if (!data.selected) {
              return this.stateStyling.disabled.opacity;
            }
            return this.stateStyling.selected.opacity;
          }

          if (data.selected) {
            return this.stateStyling.selected.opacity;
          }
          return this.stateStyling.standard.opacity;
        },
        strokeWidth: (a, b, data) => {
          if (data.editing) {
            if (!data.selected) {
              return this.stateStyling.disabled.strokeWidth;
            }
            return this.stateStyling.selected.strokeWidth;
          }

          if (data.selected) {
            return this.stateStyling.selected.strokeWidth;
          }
          return this.stateStyling.standard.strokeWidth;
        },
      };
    },
    computeData() {
      const arr = [];
      this.data.forEach((track) => {
        if (track.features && track.features.bounds) {
          const polygon = boundToGeojson(track.features.bounds);
          const coords = polygon.coordinates[0];
          arr.push({
            trackId: track.trackId,
            selected: track.selected,
            editing: track.editing,
            confidencePairs: track.confidencePairs,
            geometry: {
              outer: [
                { x: coords[0][0], y: coords[0][1] },
                { x: coords[1][0], y: coords[1][1] },
                { x: coords[2][0], y: coords[2][1] },
                { x: coords[3][0], y: coords[3][1] },
              ],
            },
          });
        }
      });
      return arr;
    },
    frameChanged() {
      this.polygonFeature
        .data(this.computeData())
        .polygon((d) => d.geometry)
        .draw();
    },
  },
};
</script>
<template>
  <div />
</template>
