/*eslint class-methods-use-this: "off"*/
import { FrameDataTrack } from 'vue-media-annotator/layers/LayerTypes';
import BaseLayer, { BaseLayerParams, LayerStyle } from 'vue-media-annotator/layers/BaseLayer';
import { boundToGeojson } from 'vue-media-annotator/utils';
import geo, { GeoEvent } from 'geojs';

export type EditAnnotationTypes = 'Point' | 'rectangle' | 'Polygon' | 'LineString';
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

const typeMapper = new Map([
  ['LineString', 'line'],
  ['Polygon', 'polygon'],
  ['Point', 'point'],
  ['rectangle', 'rectangle'],
]);
/**
 * This class is used to edit annotations within the viewer
 * It will do and display different things based on it either being in
 * rectangle or edit modes
 * Basic operation is that changedData will start the edited annotation
 * emits 'update:geojson' when data is changed
 */
export default class EditAnnotationLayer extends BaseLayer<GeoJSON.Feature> {
  skipNextExternalUpdate: boolean;

  _mode: 'editing' | 'creation';

  type: EditAnnotationTypes;

  trackType?: string;

  selectedKey?: string;

  selectedHandleIndex: number;

  hoverHandleIndex: number;

  /* in-progress events only emitted for lines and polygons */
  shapeInProgress: GeoJSON.LineString | GeoJSON.Polygon | null;

  constructor(params: BaseLayerParams & EditAnnotationLayerParams) {
    super(params);
    this.skipNextExternalUpdate = false;
    this._mode = 'editing';
    this.selectedKey = '';
    this.type = params.type;
    this.selectedHandleIndex = -1;
    this.hoverHandleIndex = -1;
    this.shapeInProgress = null;

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
          const divisor = this.type === 'LineString' ? 1 : 2; // used for polygon because edge handles
          if (this.type !== 'rectangle') {
            this.bus.$emit('update:selectedIndex',
              this.selectedHandleIndex / divisor, this.type, this.selectedKey);
          }
        }
      });
      this.featureLayer.geoOn(geo.event.actiondown, (e: GeoEvent) => this.setShapeInProgress(e));
    }
  }

  skipNextFunc() {
    return () => { this.skipNextExternalUpdate = true; };
  }

  /**
   * Listen to mousedown events and build a replica of the in-progress annotation
   * shape that GeoJS is keeps internally.  Emit the shape as update:in-progress-geojson
   */
  setShapeInProgress(e: GeoEvent) {
    if (this.getMode() === 'creation' && ['LineString', 'Polygon'].includes(this.type)) {
      if (this.shapeInProgress === null) {
        // Initialize a new in-progress shape
        this.shapeInProgress = {
          type: this.type as ('Polygon' | 'LineString'),
          coordinates: this.type === 'Polygon' ? [[]] : [],
        };
      }
      // Update the coordinates of the existing shape
      const newPoint: GeoJSON.Position = [Math.round(e.mouse.geo.x), Math.round(e.mouse.geo.y)];
      if (this.type === 'Polygon') {
        const coords = this.shapeInProgress?.coordinates as GeoJSON.Position[][];
        // Magic 0: there can only be a single polygon in progress at a time
        coords[0].push(newPoint);
      } else {
        const coords = this.shapeInProgress?.coordinates as GeoJSON.Position[];
        coords.push(newPoint);
      }
      this.bus.$emit('update:geojson', 'in-progress', {
        type: 'Feature',
        geometry: this.shapeInProgress,
        properties: {},
      }, this.type, this.selectedKey, this.skipNextFunc());
    } else if (this.shapeInProgress) {
      this.shapeInProgress = null;
    }
  }

  hoverEditHandle(e: GeoEvent) {
    const divisor = this.type === 'LineString' ? 1 : 2; //For Polygons we skip over edge handles (midpoints)
    if (e.enable && e.handle.handle.type === 'vertex') {
      if (e.handle.handle.selected
        && (e.handle.handle.index * divisor) !== this.hoverHandleIndex) {
        this.hoverHandleIndex = e.handle.handle.index * divisor;
      }
      if (!e.handle.handle.selected) {
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

  setKey(key: string) {
    if (typeof key === 'string') {
      this.selectedKey = key;
    } else {
      throw new Error(`${key} is invalid`);
    }
  }

  /**
   * Provides whether the user is creating a new annotation or editing one
   */
  getMode(): 'creation' | 'editing' | 'disabled' {
    const layermode = this.featureLayer.mode();
    return layermode ? this._mode : 'disabled';
  }

  /**
   * Change the layer mode
   */
  setMode(
    mode: EditAnnotationTypes | null,
    geom?: GeoJSON.Feature,
  ) {
    if (mode !== null) {
      let newLayerMode: string;
      if (geom) {
        this._mode = 'editing';
        newLayerMode = 'edit';
      } else if (typeMapper.has(mode)) {
        this._mode = 'creation';
        newLayerMode = typeMapper.get(mode) as string;
      } else {
        throw new Error(`No such mode ${mode}`);
      }
      this.featureLayer.mode(newLayerMode, geom);
    } else {
      this.featureLayer.mode(null);
    }
  }

  /**
   * Removes the current annotation and resets the mode when completed editing
   */
  disable() {
    if (this.featureLayer) {
      this.skipNextExternalUpdate = false;
      this.setMode(null);
      this.featureLayer.removeAllAnnotations(false);
      this.shapeInProgress = null;
      if (this.selectedHandleIndex !== -1) {
        this.selectedHandleIndex = -1;
        this.hoverHandleIndex = -1;
        this.bus.$emit('update:selectedIndex', this.selectedHandleIndex, this.type, this.selectedKey);
      }
    }
  }

  /**
   * retrieves geoJSON data based on the key and type
   * @param frameData
   */
  getGeoJSONData(track: FrameDataTrack) {
    let geoJSONData;
    if (track && track.features && track.features.geometry) {
      track.features.geometry.features.forEach((feature) => {
        if (feature.geometry
            && feature.geometry.type.toLowerCase() === this.type.toLowerCase()) {
          if (feature.properties && feature.properties.key !== 'undefined') {
            if (feature.properties.key === this.selectedKey) {
              geoJSONData = feature.geometry;
            }
          }
        }
      });
    }
    return geoJSONData;
  }

  /** overrides default function to disable and clear anotations before drawing again */
  async changeData(frameData: FrameDataTrack[]) {
    if (this.skipNextExternalUpdate === false) {
      // disable resets things before we load a new/different shape or mode
      this.disable();
      this.formattedData = this.formatData(frameData);
    } else {
      // prevent was called and it has prevented this update.
      // disable the skip for next time.
      this.skipNextExternalUpdate = false;
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
    this.bus.$emit('update:selectedIndex', this.selectedHandleIndex, this.type, this.selectedKey);
    if (frameData.length > 0) {
      const track = frameData[0];
      if (track.features && track.features.bounds) {
        let geoJSONData: GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString | undefined;
        if (this.type === 'rectangle') {
          geoJSONData = boundToGeojson(track.features.bounds);
        } else {
          // TODO: this assumes only one polygon
          geoJSONData = this.getGeoJSONData(track);
        }
        if (!geoJSONData || this.type === 'Point') {
          this.setMode(this.type);
        } else {
          const geojsonFeature: GeoJSON.Feature = {
            type: 'Feature',
            geometry: geoJSONData,
            properties: {
              annotationType: typeMapper.get(this.type),
            },
          };

          if (track.confidencePairs) {
            [this.trackType] = track.confidencePairs;
          }

          this.featureLayer.geojson(geojsonFeature);
          const annotation = this.applyStylesToAnnotations();
          this.setMode(this.type, annotation);
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
      this.setMode(this.type);
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
        // geoJS insists on calling done multiple times, this will prevent that
        this.formattedData = [e.annotation.geojson()];
        // The new annotation is in a state without styling, so apply local stypes
        this.applyStylesToAnnotations();
        this.bus.$emit(
          'update:geojson',
          'editing',
          this.formattedData[0],
          this.type,
          this.selectedKey,
          this.skipNextFunc(),
        );
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
          const newGeojson: GeoJSON.Feature<GeoJSON.Point|GeoJSON.Polygon|GeoJSON.LineString> = (
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
          this.bus.$emit(
            'update:geojson',
            'editing',
            this.formattedData[0],
            this.type,
            this.selectedKey,
            this.skipNextFunc(),
          );
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
    if (this.type === 'rectangle' || this.type === 'Polygon' || this.type === 'LineString') {
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
    if (this.type === 'Point') {
      return {
        handles: false,
      };
    }
    if (this.type === 'Polygon' || this.type === 'LineString') {
      return {
        handles: {
          rotate: false,
          edge: this.type !== 'LineString',
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
    if (this.type === 'rectangle' || this.type === 'Polygon') {
      return {
        handles: {
          rotate: false,
        },
      };
    }
    if (this.type === 'Point') {
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
