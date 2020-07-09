/*eslint class-methods-use-this: "off"*/
import BaseLayer, { BaseLayerParams, LayerStyle } from '@/components/layers/BaseLayer';
import { boundToGeojson } from '@/utils';
import geo, { GeoEvent } from 'geojs';
import { FrameDataTrack } from '@/components/layers/LayerTypes';

interface EditAnnotationLayerParams {
  editing: 'point' | 'rectangle' | 'polygon';
}

/**
 * This class is used to edit annotations within the viewer
 * It will do and display different things based on it either being in
 * rectangle or edit modes
 * Basic operation is that changedData will start the edited annotation
 * emits 'update:geojson' when data is changed
 */
export default class EditAnnotationLayer extends BaseLayer<GeoJSON.Feature> {
  changed: boolean;

  editing: 'point' | 'rectangle' | 'polygon';

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
      this.featureLayer.geoOn(geo.event.annotation.edit_action,
        (e: GeoEvent) => this.handleEditAction(e));
      this.featureLayer.geoOn(geo.event.annotation.state,
        (e: GeoEvent) => this.handleEditStateChange(e));
    }
  }

  applyStylesToAnnotations() {
    const annotation = this.featureLayer.annotations()[0];
    //Setup styling for rectangle and point editing
    annotation.style(this.createStyle());
    annotation.editHandleStyle(this.editHandleStyle());
    annotation.highlightStyle(this.highlightStyle());
    return annotation;
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
    /* An edited annotation calls updateLayers immediately.  This will
      prevent it from updating so the geoJS editor can handle the state.
    */
    if (this.changed) {
      this.changed = false;
    } else {
      this.disable();
      this.formattedData = this.formatData(frameData);
    }
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
        const annotation = this.applyStylesToAnnotations();
        if (this.editing) {
          this.featureLayer.mode('edit', annotation);
          this.featureLayer.draw();
        }
        return [geojsonFeature];
      }
    }
    // if there wasn't a valid track in frameData
    // then put the component into annotation create mode
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
    return [];
  }


  /**
   *
   * @param e geo.event emitting by handlers
   */
  handleEditStateChange(e: GeoEvent) {
    if (this.featureLayer === e.annotation.layer()) {
      if (e.annotation.state() === 'done' && this.formattedData.length === 0) {
        //geoJS insists on calling done multiple times, this will prevent that
        this.formattedData = [e.annotation.geojson()];
        //The new annotation is in a state without styling, so apply local stypes
        this.applyStylesToAnnotations();
        // State doesn't change at the end of editing so this will
        // swap into edit mode once geoJS is done
        setTimeout(() => this.$emit('update:geojson', this.formattedData[0], this.editing), 0);
      }
    }
  }

  /**
   * If we release the mouse after movement we want to signal for the annotation to update
   * @param e geo.event
   */
  handleEditAction(e: GeoEvent) {
    if (this.featureLayer === e.annotation.layer()) {
      if (e.action === geo.event.actionup) {
        // This will commit the change to the current annotation on mouse up while editing
        if (e.annotation.state() === 'edit') {
          const newGeojson: GeoJSON.Feature<GeoJSON.Point|GeoJSON.Polygon> = (
            e.annotation.geojson()
          );
          if (this.formattedData.length > 0) {
            // update existing feature
            this.formattedData[0].geometry = newGeojson.geometry;
          } else {
            // create new feature
            this.formattedData = [{
              ...newGeojson,
              properties: {
                annotationType: this.editing,
              },
              type: 'Feature',
            }];
          }
          // must ALWAYS emit a polygon or point
          this.changed = true;
          this.$emit('update:geojson', this.formattedData[0], this.editing);
        }
      }
    }
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
  createStyle(): LayerStyle<GeoJSON.Feature> {
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
