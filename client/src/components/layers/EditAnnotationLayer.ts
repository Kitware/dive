/*eslint class-methods-use-this: "off"*/
import BaseLayer, { BaseLayerParams } from '@/components/layers/BaseLayer';
import { boundToGeojson } from '@/utils';
import { StateStyles } from '@/use/useStyling';
import geo from 'geojs';
import { FrameDataTrack } from '@/components/layers/LayerTypes';
import { thresholdFreedmanDiaconis } from 'd3';


export default class EditAnnotationLayer extends BaseLayer {
  changed: boolean;

  editing: string;

  trackId: number | null;

  constructor(params: BaseLayerParams) {
    super(params);
    this.changed = false;
    this.editing = params.editing || 'rectangle';
    this.trackId = null;
    //Only initialize once, prevents recreating Layer each edit
    this.initialize();
  }

  initialize() {
    if (!this.featureLayer) {
      this.featureLayer = this.annotator.geoViewer.createLayer('annotation', {
        clickToEdit: true,
        showLabels: false,
      });
    }
    // For these we need to use an anonymous function to prevent geoJS from erroring
    this.featureLayer.geoOn(geo.event.annotation.edit_action, (e) => this.handleEditAction(e));
    this.featureLayer.geoOn(geo.event.annotation.state, (e) => this.handleEditStateChange(e));
  }

  disable() {
    if (this.featureLayer) {
      this.featureLayer.removeAllAnnotations();
      this.featureLayer.mode(null);
    }
  }

  changeData(frameData: FrameDataTrack[]) {
    // Only redraw and update data if we change the selected track otherwise
    // the internal geoJS will handle updating
    this.disable();
    this.formattedData = this.formatData(frameData);
    this.redraw();
  }


  /**
   *
   * @param frameData a single FrameDataTrack Array that is the editing item
   */
  formatData(frameData: FrameDataTrack[]) {
    let geojson = null; //create new element start with null
    if (frameData.length > 0) {
      const track = frameData[0];
      if (track.features && track.features.bounds) {
        geojson = boundToGeojson(track.features.bounds);
      }
    }

    if (geojson) {
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
      this.featureLayer.geojson(geojson);
      const annotation = this.featureLayer.annotations()[0];
      annotation.style(this.createStyle());
      annotation.editHandleStyle(this.editHandleStyle());
      if (this.editing) {
        this.featureLayer.mode('edit', annotation);
        this.featureLayer.draw();
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
        this.featureLayer.mode(this.editing);
      }
    }


    return geojson;
  }


  handleEditStateChange(e) {
    if (this.featureLayer === e.annotation.layer()) {
      if (e.annotation.state() === 'done' && !this.formattedData) {
        //we need to swap back to process the data gain with the edit mode
        const newGeojson = e.annotation.geojson();
        //geoJS insists on calling done multiple times, this will prevent that
        this.formattedData = [];
        //The new annotation is in a state with now style, apply one
        const annotation = this.featureLayer.annotations()[0];
        annotation.style(this.createStyle());
        annotation.editHandleStyle(this.editHandleStyle());
        const geojson = {
          ...newGeojson,
          ...{
            properties: {
              annotationType: newGeojson.properties.annotationType,
            },
          },
          type: 'NewAnnotation', //indicates which geoJSONtoBounds to use
          refresh: true, // signals to update the annotation
        };
        // State doesn't change at the end of editing so this will
        // swap into edit mode once geoJS is done
        setTimeout(() => this.$emit('update:geojson', geojson), 0);
      }
      // Handles the adding of a brand new Detection
    }
  }

  handleEditAction(e) {
    if (e.action === geo.event.actionup) {
      // This will commit the change to the current annotation on mouse up while editing
      if (e.annotation.state() === 'edit') {
        this.handleAnnotationChange(e);
        this.changed = true;
      }
    }
  }

  /**
   * This is a helper function to commit changes to an annotation/Detection
   * @param {geo.event} e Annotation event for editing or changing state
   */
  handleAnnotationChange(e) {
    this.changed = false;
    const newGeojson = e.annotation.geojson();
    let geojson = this.formattedData;
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
        type: 'Feature',
      };
    }
    this.$emit('update:geojson', geojson);
  }

  redraw() {
    return null;
  }

  createStyle() {
    const baseStyle = super.createStyle();
    return {
      ...baseStyle,
      fill: false,
      strokeColor: this.stateStyling.selected.color,
    };
  }

  editHandleStyle() {
    return {
      handles: {
        rotate: false,
      },
    };
  }
}
