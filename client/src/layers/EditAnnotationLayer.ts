/*eslint class-methods-use-this: "off"*/
import geo, { GeoEvent } from 'geojs';
import { boundToGeojson, reOrdergeoJSON } from '../utils';
import { FrameDataTrack } from './LayerTypes';
import BaseLayer, { BaseLayerParams, LayerStyle } from './BaseLayer';

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
 * correct matching of drag handle to cursor direction relies on strict ordering of
 * vertices within the GeoJSON coordinate list using utils.reOrdergeoJSON()
 * and utils.reOrderBounds()
 */
const rectVertex = [
  'sw-resize',
  'nw-resize',
  'ne-resize',
  'se-resize',
];
const rectEdge = [
  'w-resize',
  'n-resize',
  'e-resize',
  's-resize',
];
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

  styleType?: string;

  selectedKey?: string;

  selectedHandleIndex: number;

  hoverHandleIndex: number;

  disableModeSync: boolean; //Disables fallthrough mouse clicks when ending an annotation

  leftButtonCheckTimeout: number; //Fallthough mouse down when ending lineStrings

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
    this.disableModeSync = false;
    this.leftButtonCheckTimeout = -1;

    //Only initialize once, prevents recreating Layer each edit
    this.initialize();
  }

  /**
   * Initialization of the layer should only be done once for edit layers
   * Handlers for edit_action and state which will emit data when necessary
   */
  initialize() {
    if (!this.featureLayer && this.type) {
      this.featureLayer = this.annotator.geoViewerRef.value.createLayer('annotation', {
        clickToEdit: true,
        showLabels: false,
        continuousPointProximity: false,
        finalPointProximity: 1,
        adjacentPointProximity: 1,
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
        //Used to sync clicks that kick out of editing mode with application
        //This prevents that pseudo Edit state when left clicking on a object in edit mode
        if (!this.disableModeSync && (e.buttonsDown.left)
          && this.getMode() === 'disabled' && this.featureLayer.annotations()[0]) {
          this.bus.$emit('editing-annotation-sync', false);
        } else if (e.buttonsDown.left) {
          const newIndex = this.hoverHandleIndex;
          // Click features like a toggle: unselect if it's clicked twice.
          if (newIndex === this.selectedHandleIndex) {
            this.selectedHandleIndex = -1;
          } else {
            this.selectedHandleIndex = newIndex;
          }
          let divisor = 1;
          if (this.type === 'Polygon' && this.selectedHandleIndex >= 0) {
            divisor = 2;
          }
          window.setTimeout(() => this.redraw(), 0); //Redraw timeout to update the selected handle
          if (this.type !== 'rectangle') {
            this.bus.$emit('update:selectedIndex',
              this.selectedHandleIndex / divisor, this.type, this.selectedKey);
          }
        }
        this.disableModeSync = false;
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
    // Allow middle click movement when placing points
    if (e.mouse.buttons.middle && !e.propogated) {
      return;
    }
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
      this.bus.$emit(
        'update:geojson',
        'in-progress',
        false, // Geometry isn't complete
        {
          type: 'Feature',
          geometry: this.shapeInProgress,
          properties: {},
        }, this.type, this.selectedKey, this.skipNextFunc(),
      );
      // triggers a mouse up while editing to make it seem like a point was placed
      window.setTimeout(() => this.annotator.geoViewerRef.value.interactor().simulateEvent('mouseup',
        { map: { x: e.mouse.geo.x, y: e.mouse.geo.y }, button: 'left' }), 0);
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
    } else if (e.enable && e.handle.handle.type === 'center') {
      this.hoverHandleIndex = -1;
    }
    if (e.enable) {
      if (this.type === 'rectangle') {
        if (e.handle.handle.type === 'vertex') {
          this.annotator.setCursor(rectVertex[e.handle.handle.index]);
        } else if (e.handle.handle.type === 'edge') {
          this.annotator.setCursor(rectEdge[e.handle.handle.index]);
        }
      } else if (e.handle.handle.type === 'vertex') {
        this.annotator.setCursor('grab');
      } else if (e.handle.handle.type === 'edge') {
        this.annotator.setCursor('copy');
      }
      if (e.handle.handle.type === 'center') {
        this.annotator.setCursor('move');
      } else if (e.handle.handle.type === 'resize') {
        this.annotator.setCursor('nwse-resize');
      }
    } else if (this.getMode() !== 'creation') {
      this.annotator.setCursor('default');
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
        this.annotator.setCursor('default');
      } else if (typeMapper.has(mode)) {
        this._mode = 'creation';
        newLayerMode = typeMapper.get(mode) as string;
        this.annotator.setCursor('crosshair');
      } else {
        throw new Error(`No such mode ${mode}`);
      }
      this.featureLayer.mode(newLayerMode, geom);
    } else {
      this.featureLayer.mode(null);
    }
  }

  calculateCursorImage() {
    if (this.getMode() === 'creation') {
      // TODO:  we may want to make this more generic or utilize the icons from editMenu
      this.annotator.setImageCursor(`mdi-vector-${typeMapper.get(this.type)}`);
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
      this.annotator.setCursor('default');
      this.annotator.setImageCursor('');
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
      //TODO: Find a better way to track mouse up after placing a point or completing geometry
      //For line drawings and the actions of any recipes we want
      if (this.annotator.geoViewerRef.value.interactor().mouse().buttons.left) {
        this.leftButtonCheckTimeout = window.setTimeout(() => this.changeData(frameData), 20);
      } else {
        clearTimeout(this.leftButtonCheckTimeout);
        this.formattedData = this.formatData(frameData);
      }
    } else {
      // prevent was called and it has prevented this update.
      // disable the skip for next time.
      this.skipNextExternalUpdate = false;
    }
    this.calculateCursorImage();
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

          if (track.styleType) {
            [this.styleType] = track.styleType;
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
      // Only calls this once on completion of an annotation
      if (e.annotation.state() === 'done' && this.getMode() === 'creation') {
        const geoJSONData = [e.annotation.geojson()];
        if (this.type === 'rectangle') {
          geoJSONData[0].geometry.coordinates[0] = reOrdergeoJSON(
            geoJSONData[0].geometry.coordinates[0] as GeoJSON.Position[],
          );
        }
        this.formattedData = geoJSONData;
        // The new annotation is in a state without styling, so apply local stypes
        this.applyStylesToAnnotations();
        //This makes sure the click for the end point doesn't kick us out of the mode
        this.disableModeSync = true;

        this.bus.$emit(
          'update:geojson',
          'editing',
          this.getMode() === 'creation',
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
            if (this.type === 'rectangle') {
              /* Updating the corners for the proper cursor icons
              Also allows for regrabbing of the handle */
              newGeojson.geometry.coordinates[0] = reOrdergeoJSON(
                newGeojson.geometry.coordinates[0] as GeoJSON.Position[],
              );
              // The corners need to update for the indexes to update
              // coordinates are in a different system than display
              const coords = newGeojson.geometry.coordinates[0].map(
                (coord) => ({ x: coord[0], y: coord[1] }),
              );
              // only use the 4 coords instead of 5
              const remapped = this.annotator.geoViewerRef.value.worldToGcs(coords.splice(0, 4));
              e.annotation.options('corners', remapped);
              //This will retrigger highlighting of the current handle after releasing the mouse
              setTimeout(() => this.annotator.geoViewerRef
                .value.interactor().retriggerMouseMove(), 0);
            }
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
            this.getMode() === 'creation',
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
          if (this.styleType) {
            return this.typeStyling.value.color(this.styleType);
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
        fillOpacity: (_: EditHandleStyle, index: number) => {
          if (index === this.selectedHandleIndex) {
            return 1;
          }
          return 0.25;
        },
        strokeColor: (_: EditHandleStyle, index: number) => {
          if (index === this.selectedHandleIndex) {
            return '#FF0000';
          }
          if (this.styleType) {
            return this.typeStyling.value.color(this.styleType);
          }
          return this.typeStyling.value.color('');
        },
        fillColor: (_data: EditHandleStyle, index: number) => {
          if (index === this.selectedHandleIndex) {
            return '#FF0000';
          }
          if (this.styleType) {
            return this.typeStyling.value.color(this.styleType);
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
