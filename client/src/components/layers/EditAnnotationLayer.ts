/*eslint class-methods-use-this: "off"*/
import BaseLayer, { BaseLayerParams, LayerStyle } from '@/components/layers/BaseLayer';
import { boundToGeojson } from '@/utils';
import geo, { GeoEvent } from 'geojs';
import { FrameDataTrack } from '@/components/layers/LayerTypes';

export type EditAnnotationTypes = 'point' | 'rectangle' | 'polygon' | 'line';
interface EditAnnotationLayerParams {
  type: EditAnnotationTypes;
}

interface EditHandleStyle {
  type: string;
  x: number;
  y: number;
  index: number;
  editHandle: boolean;
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

  mode: 'editing' | 'creation';

  type: EditAnnotationTypes;

  trackType?: string;

  selectedHandleIndex: number;

  hoverHandleIndex: number;

  constructor(params: BaseLayerParams & EditAnnotationLayerParams) {
    super(params);
    this.changed = false;
    this.mode = 'editing';
    this.type = params.type;
    this.selectedHandleIndex = -1;
    this.hoverHandleIndex = -1;
    //Only initialize once, prevents recreating Layer each edit
    this.initialize();
  }

  /**
   * Initialization of the layer should only be done once for edit layers
   * Handlers for edit_action and state which will emit data when necessary
   */
  initialize() {
    if (!this.featureLayer && this.type) {
      this.featureLayer = this.annotator.geoViewer.createLayer('annotation', {
        clickToEdit: true,
        showLabels: false,
      });
      // For these we need to use an anonymous function to prevent geoJS from erroring
      this.featureLayer.geoOn(geo.event.annotation.edit_action,
        (e: GeoEvent) => this.handleEditAction(e));
      this.featureLayer.geoOn(geo.event.annotation.state,
        (e: GeoEvent) => this.handleEditStateChange(e));
      //Event name is misleading, this means hovering over an edit handle
      this.featureLayer.geoOn(geo.event.annotation.select_edit_handle,
        (e: GeoEvent) => this.hoverEditHandle(e));
      this.featureLayer.geoOn(geo.event.mouseclick, (e: GeoEvent) => {
        if (e.buttonsDown.left && this.hoverHandleIndex !== -1) {
          this.selectedHandleIndex = this.hoverHandleIndex;
          setTimeout(() => this.redraw(), 0); //Redraw timeout to update the selected handle
          const divisor = 2.0; // used for polygon because edge handles
          if (this.type !== 'rectangle') {
            this.$emit('update:selectedIndex', this.selectedHandleIndex / divisor);
          }
        }
      });
    }
  }

  hoverEditHandle(e: GeoEvent) {
    let divisor = 2; //For Polygons we skip over edge handles (midpoints)
    if (this.type === 'line') {
      divisor = 1;
    }
    if (e.enable) {
      if (e.handle.handle.selected
        && (e.handle.handle.index * divisor) !== this.hoverHandleIndex) {
        this.hoverHandleIndex = e.handle.handle.index * divisor;
      } if (!e.handle.handle.selected) {
        this.hoverHandleIndex = -1;
      }
    }
  }

  applyStylesToAnnotations() {
    const annotation = this.featureLayer.annotations()[0];
    //Setup styling for rectangle and point editing
    if (annotation) {
      annotation.style(this.createStyle());
      annotation.editHandleStyle(this.editHandleStyle());
      annotation.highlightStyle(this.highlightStyle());
    }
    return annotation;
  }

  /**
   * Set the current Editing type for switching between editing polygons or rects.
   * */
  setType(type: EditAnnotationTypes) {
    this.type = type;
  }

  /**
   * Provides whether the user is creating a new annotation or editing one
   */
  getMode(): 'creation' | 'editing' {
    return this.mode;
  }

  /**
   * Removes the current annotation and resets the mode when completed editing
   */
  disable() {
    if (this.featureLayer) {
      this.featureLayer.removeAllAnnotations();
      this.featureLayer.mode(null);
      if (this.selectedHandleIndex !== -1) {
        this.selectedHandleIndex = -1;
        this.hoverHandleIndex = -1;
        this.$emit('update:selectedIndex', this.selectedHandleIndex);
      }
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
    this.selectedHandleIndex = -1;
    this.hoverHandleIndex = -1;
    this.$emit('update:selectedIndex', this.selectedHandleIndex);
    if (frameData.length > 0) {
      const track = frameData[0];
      if (track.features && track.features.bounds) {
        let geoJSONData: GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString | undefined;
        if (this.type === 'rectangle') {
          geoJSONData = boundToGeojson(track.features.bounds);
        } else if (this.type === 'polygon') {
          // TODO: this assumes only one polygon
          geoJSONData = track.features.geometry?.features?.[0]?.geometry;
        }
        if (!geoJSONData) {
          this.mode = 'creation';
          this.featureLayer.mode(this.type);
        } else {
          const geojsonFeature: GeoJSON.Feature = {
            type: 'Feature',
            geometry: geoJSONData,
            properties: {
              annotationType: this.type,
            },
          };

          if (track.confidencePairs) {
            [this.trackType] = track.confidencePairs;
          }

          this.featureLayer.geojson(geojsonFeature);
          const annotation = this.applyStylesToAnnotations();
          if (this.type) {
            this.mode = 'editing';
            this.featureLayer.mode('edit', annotation);
          }
          return [geojsonFeature];
        }
      }
    }
    // if there wasn't a valid track in frameData
    // then put the component into annotation create mode
    if (typeof this.type !== 'string') {
      throw new Error(
        `editing props needs to be a string of value 
          ${geo.listAnnotations().join(', ')}
            when geojson prop is not set`,
      );
    } else {
      // point or rectangle mode for the editor
      this.mode = 'creation';
      this.featureLayer.mode(this.type);
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
        setTimeout(() => this.$emit('update:geojson', this.formattedData[0], this.type), 0);
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
                annotationType: this.type,
              },
              type: 'Feature',
            }];
          }
          // must ALWAYS emit a polygon or point
          this.changed = true;
          this.$emit('update:geojson', this.formattedData[0], this.type);
        }
      }
    }
  }

  /**
   * Drawing for annotations are handled during initialization they don't need the standard redraw
   * function from BaseLayer
   */
  redraw() {
    this.applyStylesToAnnotations();
    this.featureLayer.draw();

    return null;
  }

  /**
   * The base style used to represent the annotation
   */
  createStyle(): LayerStyle<GeoJSON.Feature> {
    const baseStyle = super.createStyle();
    if (this.type === 'rectangle' || this.type === 'polygon') {
      return {
        ...baseStyle,
        fill: false,
        strokeColor: () => {
          if (this.trackType) {
            return this.typeStyling.value.color(this.trackType);
          }
          return this.stateStyling.selected.color;
        },

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
    if (this.type === 'rectangle') {
      return {
        handles: {
          rotate: false,
        },
      };
    }
    if (this.type === 'point') {
      return {
        handles: false,
      };
    }
    if (this.type === 'polygon') {
      return {
        handles: {
          rotate: false,
        },
        fill: true,
        radius: (handle: EditHandleStyle): number => {
          if (handle.type === 'edge') {
            return 5;
          }
          return 8;
        },
        fillOpacity: 0.25,
        strokeColor: () => {
          if (this.trackType) {
            return this.typeStyling.value.color(this.trackType);
          }
          return this.typeStyling.value.color('');
        },
        fillColor: (_data: EditHandleStyle, index: number) => {
          if (index === this.selectedHandleIndex) {
            return '#00FF00';
          }
          if (this.trackType) {
            return this.typeStyling.value.color(this.trackType);
          }
          return this.typeStyling.value.color('');
        },
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
    if (this.type === 'rectangle' || this.type === 'polygon') {
      return {
        handles: {
          rotate: false,
        },
      };
    }
    if (this.type === 'point') {
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
