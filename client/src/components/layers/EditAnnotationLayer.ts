/*eslint class-methods-use-this: "off"*/
import BaseLayer, { BaseLayerParams, LayerStyle } from '@/components/layers/BaseLayer';
import { boundToGeojson } from '@/utils';
import { StateStyles } from '@/use/useStyling';
import geo from 'geojs';
import { FrameDataTrack } from '@/components/layers/LayerTypes';

interface EditAnnotationLayerParams {
  editing: 'point' | 'rectangle';
}

/**
 * This class is used to edit annotations within the viewer
 * It will do and display different things based on it either being in
 * rectangle or edit modes
 * Basic operation is that changedData will start the edited annotation
 * emits 'update:geojson' when data is changed
 */
export default class EditAnnotationLayer extends BaseLayer<unknown> {
  changed: boolean;

  editing: 'point' | 'rectangle';

  constructor(params: BaseLayerParams & EditAnnotationLayerParams) {
    super(params);
    this.changed = false;
    this.editing = params.editing;
    //Only initialize once, prevents recreating Layer each edit
    this.initialize();
  }

  /**
   * Initialization of the layer should only be done once for edit layers
   * Handlers for edit_action and state which will emit data when necessary
   */
  initialize() {
    if (!this.featureLayer && this.editing) {
      this.featureLayer = this.annotator.geoViewer.createLayer('annotation', {
        clickToEdit: true,
        showLabels: false,
      });
      // For these we need to use an anonymous function to prevent geoJS from erroring
      this.featureLayer.geoOn(geo.event.annotation.edit_action, (e) => this.handleEditAction(e));
      this.featureLayer.geoOn(geo.event.annotation.state, (e) => this.handleEditStateChange(e));
    }
  }

  /**
   * Removes the current annotation and resets the mode when completed editing
   */
  disable() {
    if (this.featureLayer) {
      this.featureLayer.removeAllAnnotations();
      this.featureLayer.mode(null);
    }
  }

  /** overrides default function to disable and clear anotations before drawing again */
  changeData(frameData: FrameDataTrack[]) {
    this.disable();
    this.formattedData = this.formatData(frameData);
    this.redraw();
  }


  /**
   *
   * @param frameData a single FrameDataTrack Array that is the editing item
   */
  formatData(frameData: FrameDataTrack[]) {
    if (frameData.length > 0) {
      const track = frameData[0];
      if (track.features && track.features.bounds) {
        const geojsonPolygon = boundToGeojson(track.features.bounds);
        const geojsonFeature: GeoJSON.Feature = {
          type: 'Feature',
          geometry: geojsonPolygon,
          properties: {
            annotationType: this.editing,
          },
        };
        this.featureLayer.geojson(geojsonFeature);
        const annotation = this.featureLayer.annotations()[0];
        //Setup styling for rectangle and point editing
        annotation.style(this.createStyle());
        annotation.editHandleStyle(this.editHandleStyle());
        annotation.highlightStyle(this.highlightStyle());
        if (this.editing) {
          this.featureLayer.mode('edit', annotation);
          this.featureLayer.draw();
        }
      }
    } else {
      this.changed = true;
      if (typeof this.editing !== 'string') {
        throw new Error(
          `editing props needs to be a string of value 
            ${geo.listAnnotations().join(', ')}
             when geojson prop is not set`,
        );
      } else {
        // point or rectangle mode for the editor
        this.featureLayer.mode(this.editing);
      }
    }
  }


  /**
   *
   * @param e geo.event emitting by handlers
   */
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
        annotation.highlightStyle(this.highlightStyle());
        newGeojson.refresh = true;
        // State doesn't change at the end of editing so this will
        // swap into edit mode once geoJS is done
        setTimeout(() => this.$emit('update:geojson', newGeojson), 0);
      }
    }
  }

  /**
   * If we release the mouse after movement we want to signal for the annotation to update
   * @param e geo.event
   */
  handleEditAction(e) {
    if (this.featureLayer === e.annotation.layer()) {
      if (e.action === geo.event.actionup) {
      // This will commit the change to the current annotation on mouse up while editing
        if (e.annotation.state() === 'edit') {
          this.handleAnnotationChange(e);
          this.changed = true;
        }
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

  /**
   * Drawing for annotations are handled during initialization they don't need the standard redraw
   * function from BaseLayer
   */
  redraw() {
    return null;
  }

  /**
   * The base style used to represent the annotation
   */
  createStyle(): LayerStyle<unknown> {
    const baseStyle = super.createStyle();
    if (this.editing === 'rectangle') {
      return {
        ...baseStyle,
        fill: false,
        strokeColor: this.stateStyling.selected.color,
      };
    }
    return {
      fill: false,
      strokeWidth: 0,
      strokeColor: 'none',
    };
  }

  /**
   * Styling for the handles used to drag the annotation for ediing
   */
  editHandleStyle() {
    if (this.editing === 'rectangle') {
      return {
        handles: {
          rotate: false,
        },
      };
    }
    if (this.editing === 'point') {
      return {
        handles: false,
      };
    }
    return {
      handles: {
        rotate: false,
      },
    };
  }

  /**
   * Should never have highlighting enabled but this will remove any highlighting style
   * from the annotation.  NOTE: this will not remove styling from handles
   */
  highlightStyle() {
    if (this.editing === 'rectangle') {
      return {
        handles: {
          rotate: false,
        },
      };
    }
    if (this.editing === 'point') {
      return {
        stroke: false,
      };
    }
    return {
      handles: {
        rotate: false,
      },
    };
  }
}
