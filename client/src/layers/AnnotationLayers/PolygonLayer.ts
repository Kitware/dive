/* eslint-disable class-methods-use-this */
import geo, { GeoEvent } from 'geojs';
import { Ref } from 'vue';

import { cloneDeep } from 'lodash';
import {
  resolveSuppressionDisplay,
  SuppressionDisplaySettings,
} from '../../types';
import BaseLayer, { LayerStyle, BaseLayerParams } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';
import LineLayer from './LineLayer';

interface PolyGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  styleType: [string, number] | null;
  polygon: GeoJSON.Polygon;
  polygonKey: string;
  /** Suppression type name when displaying as suppressed (dashed outline) */
  suppressed?: string;
  set?: string;
  dashed?: boolean;
  isHole?: boolean; // True if this is a hole polygon (for styling)
}

interface PolygonLayerParams extends BaseLayerParams {
  suppressionDisplay?: Ref<SuppressionDisplaySettings | undefined>;
}

/**
 * Darken a hex color by a given factor (0-1, where 0 = black, 1 = original)
 */
function darkenColor(color: string, factor: number): string {
  // Handle hex colors
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const newR = Math.round(r * factor);
    const newG = Math.round(g * factor);
    const newB = Math.round(b * factor);
    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
  }
  // For non-hex colors, return as-is (could extend to support rgb(), etc.)
  return color;
}

export default class PolygonLayer extends BaseLayer<PolyGeoJSData> {
  drawingOther: boolean; //drawing another type of annotation at the same time?

  hoverOn: boolean;

  suppressionDisplay: Ref<SuppressionDisplaySettings | undefined>;

  constructor(params: PolygonLayerParams) {
    super(params);
    this.drawingOther = true; // Initialized to true in case polygons aren't supported
    //Only initialize once, prevents recreating Layer each edit
    this.hoverOn = false;
    this.suppressionDisplay = params.suppressionDisplay
      || ({ value: undefined } as Ref<SuppressionDisplaySettings | undefined>);
    this.initialize();
  }

  private suppressionStyle() {
    return resolveSuppressionDisplay(this.suppressionDisplay.value);
  }

  private styleSuppressed(data: { suppressed?: string }) {
    return !!(data.suppressed && this.suppressionStyle().enabled);
  }

  initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['polygon'],
    });
    this.featureLayer = layer
      .createFeature('polygon', { selectionAPI: true })
      .geoOn(geo.event.feature.mouseclick, (e: GeoEvent) => {
        /**
         * Handle clicking on individual annotations, if DrawingOther is true we use the
         * Rectangle type for track selection. However, polygon key events are always
         * emitted so that multi-polygon selection works regardless of drawingOther.
         * */
        if (e.mouse.buttonsDown.left) {
          // Always emit polygon-clicked for multi-polygon support, regardless of drawingOther
          const polygonKey = e.data.polygonKey || '';
          if (e.data.selected) {
            // Already selected track - user may be selecting a different polygon
            this.bus.$emit('polygon-clicked', e.data.trackId, polygonKey);
          }
          // Track-level events only when not drawingOther (rectangle layer handles those)
          if (!this.drawingOther) {
            if (!e.data.editing || (e.data.editing && !e.data.selected)) {
              if (e.mouse.modifiers.ctrl) {
                this.bus.$emit('annotation-ctrl-clicked', e.data.trackId, false, { ctrl: true });
              } else {
                this.bus.$emit('polygon-clicked', e.data.trackId, polygonKey);
                this.bus.$emit('annotation-clicked', e.data.trackId, false);
              }
            }
          }
        } else if (e.mouse.buttonsDown.right) {
          // Always emit polygon key for right-click so the correct polygon can be selected
          const polygonKey = e.data.polygonKey || '';
          this.bus.$emit('polygon-right-clicked', e.data.trackId, polygonKey);
          // Track-level events only when not drawingOther
          if (!this.drawingOther) {
            if (!e.data.editing || (e.data.editing && !e.data.selected)) {
              this.bus.$emit('annotation-right-clicked', e.data.trackId, true);
            }
          }
        }
      });
    this.featureLayer.geoOn(
      geo.event.feature.mouseclick_order,
      this.featureLayer.mouseOverOrderClosestBorder,
    );
    this.featureLayer.geoOn(geo.event.mouseclick, (e: GeoEvent) => {
      // If we aren't clicking on an annotation we can deselect the current track
      if (this.featureLayer.pointSearch(e.geo).found.length === 0 && !this.drawingOther) {
        if (e.mouse.buttonsDown.left) {
          this.bus.$emit('annotation-clicked', null, false);
        } else if (e.mouse.buttonsDown.right) {
          // Right-click outside polygons - emit event to finalize/cancel creation
          this.bus.$emit('polygon-right-clicked-outside');
        }
      }
    });
    super.initialize();
  }

  hoverAnnotations(e: GeoEvent) {
    if (!this.drawingOther) {
      const { found } = this.featureLayer.pointSearch(e.mouse.geo);
      this.bus.$emit('annotation-hover', found, e.mouse.geo);
    }
  }

  setHoverAnnotations(val: boolean) {
    if (!this.hoverOn && val) {
      this.featureLayer.geoOn(
        geo.event.feature.mouseover,
        (e: GeoEvent) => this.hoverAnnotations(e),
      );
      this.featureLayer.geoOn(
        geo.event.feature.mouseoff,
        (e: GeoEvent) => this.hoverAnnotations(e),
      );
      this.hoverOn = true;
    } else if (this.hoverOn && !val) {
      this.featureLayer.geoOff(geo.event.feature.mouseover);
      this.featureLayer.geoOff(geo.event.feature.mouseoff);
      this.hoverOn = false;
    }
  }

  /**
   * Used to set the drawingOther parameter used to change styling if other types are drawn
   * and also handle selection clicking between different types
   * @param val - determines if we are drawing other types of annotations
   */
  setDrawingOther(val: boolean) {
    this.drawingOther = val;
  }

  formatData(frameDataTracks: FrameDataTrack[]) {
    const arr: PolyGeoJSData[] = [];
    frameDataTracks.forEach((frameData: FrameDataTrack) => {
      if (frameData.features && frameData.features.bounds) {
        if (frameData.features.geometry?.features?.[0]) {
          const suppStyle = this.suppressionStyle();
          const dashed = !!(frameData.suppressed && suppStyle.enabled && suppStyle.dashed);
          const width = frameData.features.bounds[2] - frameData.features.bounds[0];
          const height = frameData.features.bounds[3] - frameData.features.bounds[1];
          const dashSize = Math.min(width, height) / 20.0;
          frameData.features.geometry.features.forEach((feature) => {
            if (feature.geometry && feature.geometry.type === 'Polygon') {
              let polygon = feature.geometry as GeoJSON.Polygon;
              if (dashed) {
                const temp = cloneDeep(polygon);
                temp.coordinates = temp.coordinates.map(
                  (ring) => LineLayer.dashLine(ring, dashSize),
                );
                polygon = temp;
              }
              const polygonKey = feature.properties?.key || '';
              const annotation: PolyGeoJSData = {
                trackId: frameData.track.id,
                selected: frameData.selected,
                editing: frameData.editing,
                styleType: frameData.styleType,
                polygon,
                polygonKey,
                suppressed: frameData.suppressed,
                set: frameData.set,
                dashed,
                isHole: false,
              };
              arr.push(annotation);

              // Also add holes as separate polygon entries for distinct styling
              const coords = polygon.coordinates as GeoJSON.Position[][];
              if (coords.length > 1) {
                // coords[0] is outer ring, coords[1..n] are holes
                for (let i = 1; i < coords.length; i += 1) {
                  const holePolygon: GeoJSON.Polygon = {
                    type: 'Polygon',
                    coordinates: [coords[i]], // Hole as its own polygon
                  };
                  const holeAnnotation: PolyGeoJSData = {
                    trackId: frameData.track.id,
                    selected: frameData.selected,
                    editing: frameData.editing,
                    styleType: frameData.styleType,
                    polygon: holePolygon,
                    polygonKey, // Same key as parent polygon
                    suppressed: frameData.suppressed,
                    set: frameData.set,
                    dashed,
                    isHole: true,
                  };
                  arr.push(holeAnnotation);
                }
              }
            }
          });
        }
      }
    });
    return arr;
  }

  redraw() {
    this.featureLayer
      .data(this.formattedData)
      .polygon((d: PolyGeoJSData) => {
        // GeoJS expects outer ring as array of points for simple polygons
        // For polygons with holes, return object with outer/inner properties
        if (d.polygon.coordinates.length > 1) {
          return {
            outer: d.polygon.coordinates[0],
            inner: d.polygon.coordinates.slice(1),
          };
        }
        return d.polygon.coordinates[0];
      })
      .draw();
  }

  disable() {
    this.featureLayer
      .data([])
      .draw();
  }

  createStyle(): LayerStyle<PolyGeoJSData> {
    return {
      ...super.createStyle(),
      // Style conversion to get array objects to work in geoJS
      position: (point) => this.transformPoint(point),
      strokeColor: (_point, _index, data) => {
        let color: string;
        if (data.selected) {
          color = this.stateStyling.selected.color;
        } else if (data.styleType) {
          color = this.typeStyling.value.color(data.styleType[0]);
        } else {
          color = this.typeStyling.value.color('');
        }
        // Darken color for holes
        return data.isHole ? darkenColor(color, 0.5) : color;
      },
      fill: (data) => {
        // Holes should always be filled to show the darker color
        if (data.isHole) {
          return true;
        }
        if (this.styleSuppressed(data)) {
          return this.suppressionStyle().fillOpacity > 0;
        }
        if (data.set) {
          return this.typeStyling.value.fill(data.set);
        }
        if (data.styleType) {
          return this.typeStyling.value.fill(data.styleType[0]);
        }
        return this.stateStyling.standard.fill;
      },
      fillColor: (_point, _index, data) => {
        let color: string;
        if (this.styleSuppressed(data) && this.suppressionStyle().fillColor) {
          color = this.suppressionStyle().fillColor;
        } else if (data.styleType) {
          color = this.typeStyling.value.color(data.styleType[0]);
        } else {
          color = this.typeStyling.value.color('');
        }
        // Darken color for holes
        return data.isHole ? darkenColor(color, 0.5) : color;
      },
      fillOpacity: (_point, _index, data) => {
        // Holes get higher opacity to stand out
        if (data.isHole) {
          return 0.5;
        }
        if (this.styleSuppressed(data)) {
          return this.suppressionStyle().fillOpacity;
        }
        if (data.set) {
          return this.typeStyling.value.opacity(data.set);
        }
        if (data.styleType) {
          return this.typeStyling.value.opacity(data.styleType[0]);
        }
        return this.stateStyling.standard.opacity;
      },
      strokeOpacity: (_point, _index, data) => {
        if (_index % 2 === 1 && data.dashed) {
          return 0.0;
        }
        if (data.selected) {
          return this.stateStyling.selected.opacity;
        }
        if (this.styleSuppressed(data)) {
          return this.suppressionStyle().outlineOpacity;
        }
        if (data.styleType) {
          return this.typeStyling.value.opacity(data.styleType[0]);
        }

        return this.stateStyling.standard.opacity;
      },
      strokeOffset: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        if (data.styleType) {
          return this.typeStyling.value.strokeWidth(data.styleType[0]);
        }
        return this.stateStyling.standard.strokeWidth;
      },
      strokeWidth: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        if (data.styleType) {
          return this.typeStyling.value.strokeWidth(data.styleType[0]);
        }
        return this.stateStyling.standard.strokeWidth;
      },
    };
  }
}
