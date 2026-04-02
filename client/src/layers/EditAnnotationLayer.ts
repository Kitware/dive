/*eslint class-methods-use-this: "off"*/
import geo, { GeoEvent } from 'geojs';
import {
  boundToGeojson,
  reOrdergeoJSON,
  getRotationFromAttributes,
  getRotationArrowLine,
  hasSignificantRotation,
  ROTATION_ATTRIBUTE_NAME,
  RectBounds,
  getRotationBetweenCoordinateArrays,
  rotateGeoJSONCoordinates,
  areRectangleSidesParallel,
} from '../utils';
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

  selectedPolygonIndex: number;

  selectedHandleIndex: number;

  hoverHandleIndex: number;

  disableModeSync: boolean; //Disables fallthrough mouse clicks when ending an annotation

  leftButtonCheckTimeout: number; //Fallthough mouse down when ending lineStrings

  /* in-progress events only emitted for lines and polygons */
  shapeInProgress: GeoJSON.LineString | GeoJSON.Polygon | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arrowFeatureLayer: any;

  unrotatedGeoJSONCoords: GeoJSON.Position[] | null;

  constructor(params: BaseLayerParams & EditAnnotationLayerParams) {
    super(params);
    this.skipNextExternalUpdate = false;
    this._mode = 'editing';
    this.selectedKey = '';
    this.selectedPolygonIndex = 0;
    this.type = params.type;
    this.selectedHandleIndex = -1;
    this.hoverHandleIndex = -1;
    this.shapeInProgress = null;
    this.disableModeSync = false;
    this.leftButtonCheckTimeout = -1;
    this.unrotatedGeoJSONCoords = null;

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
      this.featureLayer.geoOn(
        geo.event.annotation.edit_action,
        (e: GeoEvent) => this.handleEditAction(e),
      );
      this.featureLayer.geoOn(
        geo.event.annotation.state,
        (e: GeoEvent) => this.handleEditStateChange(e),
      );
      //Event name is misleading, this means hovering over an edit handle
      this.featureLayer.geoOn(
        geo.event.annotation.select_edit_handle,
        (e: GeoEvent) => this.hoverEditHandle(e),
      );
      this.featureLayer.geoOn(geo.event.mouseclick, (e: GeoEvent) => {
        //Used to sync clicks that kick out of editing mode with application
        //This prevents that pseudo Edit state when left clicking on a object in edit mode
        if (!this.disableModeSync && (e.buttonsDown.left)
          && this.getMode() === 'disabled' && this.featureLayer.annotations()[0]) {
          this.bus.$emit('editing-annotation-sync', false);
        } else if (e.buttonsDown.left) {
          const newIndex = this.hoverHandleIndex;
          // If not hovering over an edit handle and not on the edit polygon,
          // emit event so other layers can handle the click (e.g., selecting different polygon)
          if (newIndex < 0 && this.type === 'Polygon') {
            const annotations = this.featureLayer.annotations();
            if (annotations.length > 0) {
              const annotation = annotations[0];
              const geojson = annotation.geojson();
              if (geojson && geojson.geometry && geojson.geometry.type === 'Polygon') {
                const coords = geojson.geometry.coordinates[0] as [number, number][];
                const point: [number, number] = [e.geo.x, e.geo.y];
                // Ray casting algorithm to check if point is inside polygon
                let inside = false;
                for (let i = 0, j = coords.length - 1; i < coords.length; j = i, i += 1) {
                  const xi = coords[i][0];
                  const yi = coords[i][1];
                  const xj = coords[j][0];
                  const yj = coords[j][1];
                  const intersect = ((yi > point[1]) !== (yj > point[1]))
                    && (point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi);
                  if (intersect) inside = !inside;
                }
                if (!inside) {
                  // Click is outside the current edit polygon - emit passthrough event
                  this.bus.$emit('click-outside-edit', e.geo);
                  return;
                }
              }
            }
          }
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
            this.bus.$emit(
              'update:selectedIndex',
              this.selectedHandleIndex / divisor,
              this.type,
              this.selectedKey,
            );
          }
        }
        this.disableModeSync = false;
      });
      this.featureLayer.geoOn(geo.event.actiondown, (e: GeoEvent) => this.setShapeInProgress(e));

      const arrowLayer = this.annotator.geoViewerRef.value.createLayer('feature', { features: ['line'] });
      this.arrowFeatureLayer = arrowLayer.createFeature('line');
      this.arrowFeatureLayer.style({
        position: (p: [number, number]) => ({ x: p[0], y: p[1] }),
        stroke: true,
        fill: false,
        strokeColor: () => (this.styleType ? this.typeStyling.value.color(this.styleType) : this.stateStyling.selected.color),
        strokeWidth: () => (this.styleType ? this.typeStyling.value.strokeWidth(this.styleType) : this.stateStyling.selected.strokeWidth),
        strokeOpacity: () => (this.styleType ? this.typeStyling.value.opacity(this.styleType) : this.stateStyling.selected.opacity),
        strokeOffset: 0,
      });
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
        },
        this.type,
        this.selectedKey,
        this.skipNextFunc(),
      );
      // triggers a mouse up while editing to make it seem like a point was placed
      window.setTimeout(() => this.annotator.geoViewerRef.value.interactor().simulateEvent(
        'mouseup',
        { map: { x: e.mouse.geo.x, y: e.mouse.geo.y }, button: 'left' },
      ), 0);
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
        } else if (e.handle.handle.type === 'rotate') {
          this.annotator.setCursor('grab');
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
      } else if (e.handle.handle.type === 'rotate') {
        this.annotator.setCursor('grab');
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
      if (this.arrowFeatureLayer) {
        this.arrowFeatureLayer.data([]).draw();
      }
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
   * @param track
   * @param polygonIndex optional index to get a specific polygon when multiple exist
   */
  getGeoJSONData(
    track: FrameDataTrack,
    polygonIndex?: number,
  ): GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString | undefined {
    let geoJSONData: GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString | undefined;
    if (track && track.features && track.features.geometry) {
      const matchingFeatures: (GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString)[] = [];
      track.features.geometry.features.forEach((feature) => {
        if (feature.geometry
            && feature.geometry.type.toLowerCase() === this.type.toLowerCase()) {
          // Get the feature key, defaulting to '' for undefined/null keys
          const featureKey = feature.properties?.key ?? '';
          if (featureKey === this.selectedKey) {
            matchingFeatures.push(
              feature.geometry as GeoJSON.Point | GeoJSON.Polygon | GeoJSON.LineString,
            );
          }
        }
      });
      // If polygonIndex is specified and valid, use it; otherwise use first match
      if (polygonIndex !== undefined && polygonIndex >= 0 && polygonIndex < matchingFeatures.length) {
        geoJSONData = matchingFeatures[polygonIndex];
      } else if (matchingFeatures.length > 0) {
        [geoJSONData] = matchingFeatures;
      }
    }
    return geoJSONData;
  }

  /**
   * Set which polygon index to edit when multiple polygons exist
   */
  setPolygonIndex(index: number) {
    this.selectedPolygonIndex = index;
  }

  /**
   * Get the currently selected polygon index
   */
  getPolygonIndex() {
    return this.selectedPolygonIndex;
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
          this.unrotatedGeoJSONCoords = geoJSONData.coordinates[0] as GeoJSON.Position[];

          // Restore rotation if it exists
          const rotation = getRotationFromAttributes(track.features.attributes);
          if (hasSignificantRotation(rotation)) {
            // Apply rotation to restore the rotated rectangle for editing
            const updatedCoords = rotateGeoJSONCoordinates(geoJSONData.coordinates[0], rotation ?? 0);
            geoJSONData.coordinates[0] = updatedCoords;
          }
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
              // Preserve rotation in properties
              ...(getRotationFromAttributes(track.features.attributes) !== undefined
                ? { [ROTATION_ATTRIBUTE_NAME]: getRotationFromAttributes(track.features.attributes) }
                : {}),
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

        this.unrotatedGeoJSONCoords = geoJSONData[0].geometry.coordinates[0] as GeoJSON.Position[];
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
          const newCoords = newGeojson.geometry.coordinates[0] as GeoJSON.Position[];
          let rotationBetween: number;
          if (this.formattedData.length > 0 && this.type === 'rectangle') {
            const existingRotation = getRotationFromAttributes(this.formattedData[0].properties as Record<string, unknown>) ?? 0;
            const oldCoords = rotateGeoJSONCoordinates(
              this.unrotatedGeoJSONCoords || [],
              existingRotation,
            );
            if (areRectangleSidesParallel(oldCoords, newCoords)) {
              rotationBetween = existingRotation;
            } else {
              rotationBetween = getRotationBetweenCoordinateArrays(
                this.unrotatedGeoJSONCoords || [],
                newCoords,
              );
            }
          } else {
            rotationBetween = getRotationBetweenCoordinateArrays(
              this.unrotatedGeoJSONCoords || [],
              newCoords,
            );
          }
          if (this.formattedData.length > 0) {
            if (this.type === 'rectangle') {
              // If rotated, keep the rotated coordinates for editing

              // The corners need to update for the indexes to update
              // Use the actual coordinates (rotated or not) to set corners correctly
              const currentCoords = newGeojson.geometry.coordinates[0] as GeoJSON.Position[];
              const cornerCoords = currentCoords.map(
                (coord: GeoJSON.Position) => ({ x: coord[0], y: coord[1] }),
              );
              // only use the 4 coords instead of 5
              const remapped = this.annotator.geoViewerRef.value.worldToGcs(cornerCoords.splice(0, 4));
              e.annotation.options('corners', remapped);
              //This will retrigger highlighting of the current handle after releasing the mouse
              setTimeout(() => this.annotator.geoViewerRef
                .value.interactor().retriggerMouseMove(), 0);

              // For rectangles, convert to axis-aligned bounds with rotation when saving
              // Convert to axis-aligned for storage, but keep rotation in properties
              const axisAlignedCoords = rotateGeoJSONCoordinates(newCoords, 0 - rotationBetween);
              newGeojson.properties = {
                ...newGeojson.properties,
                [ROTATION_ATTRIBUTE_NAME]: rotationBetween,
              };
              newGeojson.geometry.coordinates[0] = reOrdergeoJSON(axisAlignedCoords);
            }

            // update existing feature
            this.formattedData[0].geometry = newGeojson.geometry;
            if (newGeojson.properties) {
              this.formattedData[0].properties = {
                ...this.formattedData[0].properties,
                ...newGeojson.properties,
              };
            }
          } else {
            // create new feature
            // For rectangles, convert to axis-aligned bounds with rotation when saving
            if (this.type === 'rectangle') {
              const coords = newGeojson.geometry.coordinates[0] as GeoJSON.Position[];

              // Convert to axis-aligned for storage, but keep rotation in properties
              newGeojson.properties = {
                ...(newGeojson.properties || {}),
                [ROTATION_ATTRIBUTE_NAME]: rotationBetween,
              };
              newGeojson.geometry.coordinates[0] = rotateGeoJSONCoordinates(coords, 0 - (rotationBetween ?? 0));
            }

            this.formattedData = [{
              ...newGeojson,
              properties: {
                annotationType: this.type,
                ...(newGeojson.properties || {}),
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

    if (this.arrowFeatureLayer) {
      if (this.type === 'rectangle') {
        const ann = this.featureLayer.annotations()[0];
        if (ann) {
          const g = ann.geojson();
          if (g && g.geometry && g.geometry.type === 'Polygon') {
            const coords = (g.geometry as GeoJSON.Polygon).coordinates[0];
            const rotation = getRotationFromAttributes(g.properties as Record<string, unknown>);
            const unrotated = rotateGeoJSONCoordinates(coords, 0 - (rotation ?? 0));
            // create RectBounds from unrotated coordinates
            const bounds: RectBounds = [Math.min(unrotated[0][0], unrotated[2][0]), Math.min(unrotated[0][1], unrotated[2][1]), Math.max(unrotated[0][0], unrotated[2][0]), Math.max(unrotated[0][1], unrotated[2][1])];
            const arrow = getRotationArrowLine(bounds, rotation ?? 0);
            if (arrow) {
              this.arrowFeatureLayer.data([{ c: arrow.coordinates }]).line((d: { c: GeoJSON.Position[] }) => d.c).draw();
              return;
            }
          }
        }
      }
    }
    this.arrowFeatureLayer.data([]).draw();
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
          rotate: true,
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
