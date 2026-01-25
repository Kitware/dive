/* eslint-disable class-methods-use-this */
import geo, { GeoEvent } from 'geojs';

import BaseLayer, { LayerStyle, BaseLayerParams } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

interface PolyGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  styleType: [string, number] | null;
  polygon: GeoJSON.Polygon;
  polygonKey: string;
  set?: string;
}

export default class PolygonLayer extends BaseLayer<PolyGeoJSData> {
  drawingOther: boolean; //drawing another type of annotation at the same time?

  hoverOn: boolean;

  constructor(params: BaseLayerParams) {
    super(params);
    this.drawingOther = true; // Initialized to true in case polygons aren't supported
    //Only initialize once, prevents recreating Layer each edit
    this.hoverOn = false;
    this.initialize();
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
        this.bus.$emit('annotation-clicked', null, false);
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
          frameData.features.geometry.features.forEach((feature) => {
            if (feature.geometry && feature.geometry.type === 'Polygon') {
              const polygon = feature.geometry;
              const polygonKey = feature.properties?.key || '';
              const annotation: PolyGeoJSData = {
                trackId: frameData.track.id,
                selected: frameData.selected,
                editing: frameData.editing,
                styleType: frameData.styleType,
                polygon,
                polygonKey,
                set: frameData.set,
              };
              arr.push(annotation);
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
      position: (point) => ({ x: point[0], y: point[1] }),
      strokeColor: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.styleType) {
          return this.typeStyling.value.color(data.styleType[0]);
        }
        return this.typeStyling.value.color('');
      },
      fill: (data) => {
        if (data.set) {
          return this.typeStyling.value.fill(data.set);
        }
        if (data.styleType) {
          return this.typeStyling.value.fill(data.styleType[0]);
        }
        return this.stateStyling.standard.fill;
      },
      fillColor: (_point, _index, data) => {
        if (data.styleType) {
          return this.typeStyling.value.color(data.styleType[0]);
        }
        return this.typeStyling.value.color('');
      },
      fillOpacity: (_point, _index, data) => {
        if (data.set) {
          return this.typeStyling.value.opacity(data.set);
        }
        if (data.styleType) {
          return this.typeStyling.value.opacity(data.styleType[0]);
        }
        return this.stateStyling.standard.opacity;
      },
      strokeOpacity: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.opacity;
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
