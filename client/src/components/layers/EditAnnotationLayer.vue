<script>
import { cloneDeep } from 'lodash';
import geo from 'geojs';

export default {
  name: 'EditAnnotationLayer',
  inject: ['annotator'],
  props: {
    geojson: {
      type: Object,
      default: null,
      validator(value) {
        return ['Point', 'Polygon', 'LineString'].includes(value.type);
      },
    },
    editing: {
      type: [String, Boolean],
      default: true,
      validator(value) {
        if (typeof value === 'boolean') {
          return true;
        }
        if (typeof value === 'string') {
          return geo.listAnnotations().indexOf(value) !== -1;
        }
        return false;
      },
    },
    featureStyle: {
      type: Object,
      default: null,
    },
  },
  data() {
    return {
      changed: false,
    };
  },
  watch: {
    geojson() {
      // reinitialize when annotations change.
      if (!this.changed) {
        this.reinitialize();
      } else {
        this.changed = false;
      }
    },
    editing() {
      // reinitialize when pointer editing mode is toggled
      this.reinitialize();
    },
  },
  mounted() {
    this.initialize();
  },
  beforeDestroy() {
    this.$geojsLayer.mode(null);
    this.annotator.geoViewer.deleteLayer(this.$geojsLayer);
    delete this.$geojsLayer;
  },
  methods: {
    reinitialize() {
      this.$geojsLayer.geoOff(geo.event.annotation.mode);
      this.$geojsLayer.geoOff(geo.event.annotation.state);
      this.$geojsLayer.geoOff(geo.event.annotation.edit_action);
      this.$geojsLayer.removeAllAnnotations();
      this.$geojsLayer.mode(null);
      // eslint-disable-next-line no-console
      console.log('reinitialize');
      this.initialize();
    },
    initialize() {
      if (!this.$geojsLayer) {
        this.$geojsLayer = this.annotator.geoViewer.createLayer('annotation', {
          clickToEdit: true,
          showLabels: false,
        });
        // this.listenLayerClick();
      }
      if (this.geojson) {
        let geojson = cloneDeep(this.geojson);
        if (!('geometry' in geojson)) {
          geojson = { type: 'Feature', geometry: geojson, properties: {} };
        }
        // check if is rectangle
        const { coordinates } = geojson.geometry;
        if (typeof this.editing === 'string') {
          geojson.properties.annotationType = this.editing;
        } else if (
          coordinates.length === 1
          && coordinates[0].length === 5
          && coordinates[0][0][0] === coordinates[0][3][0]
          && coordinates[0][0][1] === coordinates[0][1][1]
          && coordinates[0][2][1] === coordinates[0][3][1]
        ) {
          geojson.properties.annotationType = 'rectangle';
        }
        this.$geojsLayer.geojson(geojson);
        const annotation = this.$geojsLayer.annotations()[0];
        if (this.featureStyle) {
          annotation.style(this.featureStyle);
        }
        annotation.editHandleStyle({ handles: { rotate: false } });
        if (this.editing) {
          this.$geojsLayer.mode('edit', annotation);
          this.$geojsLayer.draw();
        }
      } else if (this.editing) {
        this.changed = true;
        if (typeof this.editing !== 'string') {
          throw new Error(
            `editing props needs to be a string of value 
            ${geo.listAnnotations().join(', ')}
             when geojson prop is not set`,
          );
        } else {
          this.$geojsLayer.mode(this.editing);
        }
      }
      this.$geojsLayer.geoOn(geo.event.annotation.state, (e) => {
        if (this.$geojsLayer === e.annotation.layer()) {
          // Handles the adding of a brand new Detection
          if (this.changed) {
            this.handleAnnotationChange(e);
          } else if (e.annotation.state() === 'done') {
            // Editing is false if the user clicks on another area or is complete
            this.$emit('update:editing', false);
          }
        }
      });

      this.$geojsLayer.geoOn(geo.event.annotation.edit_action, (e) => {
        if (e.action === geo.event.actionmove) {
          if (this.$listeners['being-edited-geojson']) {
            this.$emit('being-edited-geojson', e.annotation.geojson().geometry);
          }
        }
        if (e.action === geo.event.actionup) {
          this.$emit('being-edited-geojson', null);
          // This will commit the change to the current annotation on mouse up
          this.handleAnnotationChange(e);
          this.changed = true;
        }
      });
    },
    /**
   * This is a helper function to commit changes to an annotation/Detection
   * @param {geo.event} e Annotation event for editing or changing state
   */
    handleAnnotationChange(e) {
      this.changed = false;
      const newGeojson = e.annotation.geojson();
      let geojson = cloneDeep(this.geojson);
      if (geojson) {
        if ('geometry' in geojson) {
          geojson.geometry.coordinates = newGeojson.geometry.coordinates;
        } else {
          geojson.coordinates = newGeojson.geometry.coordinates;
        }
      } else {
        geojson = {
          ...newGeojson,
          ...{
            properties: {
              annotationType: newGeojson.properties.annotationType,
            },
          },
        };
      }
      this.$emit('update:geojson', geojson);
    },
  },
  render() {
    return null;
  },
};
</script>
