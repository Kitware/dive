/* eslint-disable class-methods-use-this */
import geo, { GeoEvent } from 'geojs';

import BaseLayer, { LayerStyle, BaseLayerParams } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

interface PolyGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  trackType: [string, number] | null;
  polygon: GeoJSON.Polygon;
}


export default class PolygonLayer extends BaseLayer<PolyGeoJSData> {
    drawingOther: boolean; //drawing another type of annotation at the same time?

    constructor(params: BaseLayerParams) {
      super(params);
      this.drawingOther = true; // Initialized to true in case polygons aren't supported
      //Only initialize once, prevents recreating Layer each edit
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
         * Rectangle type if only the polygon is visible we use the polygon bounds
         * */
          if (e.mouse.buttonsDown.left && !this.drawingOther) {
            if (!e.data.editing || (e.data.editing && !e.data.selected)) {
              this.bus.$emit('annotation-clicked', e.data.trackId, false);
            }
          } else if (e.mouse.buttonsDown.right && !this.drawingOther) {
            if (!e.data.editing || (e.data.editing && !e.data.selected)) {
              this.bus.$emit('annotation-right-clicked', e.data.trackId, true);
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

    /**
   * Used to set the drawingOther parameter used to change styling if other types are drawn
   * and also handle selection clicking between different types
   * @param val - determines if we are drawing other types of annotations
   */
    setDrawingOther(val: boolean) {
      this.drawingOther = val;
    }


    formatData(frameData: FrameDataTrack[]) {
      const arr: PolyGeoJSData[] = [];
      frameData.forEach((track: FrameDataTrack) => {
        if (track.features && track.features.bounds) {
          if (track.features.geometry?.features?.[0]) {
            track.features.geometry.features.forEach((feature) => {
              if (feature.geometry && feature.geometry.type === 'Polygon') {
                const polygon = feature.geometry;
                const annotation: PolyGeoJSData = {
                  trackId: track.trackId,
                  selected: track.selected,
                  editing: track.editing,
                  trackType: track.trackType,
                  polygon,
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
        .polygon((d: PolyGeoJSData) => d.polygon.coordinates[0])
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
          if (data.trackType) {
            return this.typeStyling.value.color(data.trackType[0]);
          }
          return this.typeStyling.value.color('');
        },
        fill: (data) => {
          if (data.trackType) {
            return this.typeStyling.value.fill(data.trackType[0]);
          }
          return this.stateStyling.standard.fill;
        },
        fillColor: (_point, _index, data) => {
          if (data.trackType) {
            return this.typeStyling.value.color(data.trackType[0]);
          }
          return this.typeStyling.value.color('');
        },
        fillOpacity: (_point, _index, data) => {
          if (data.trackType) {
            return this.typeStyling.value.opacity(data.trackType[0]);
          }
          return this.stateStyling.standard.opacity;
        },
        strokeOpacity: (_point, _index, data) => {
          if (data.selected) {
            return this.stateStyling.selected.opacity;
          }
          if (data.trackType) {
            return this.typeStyling.value.opacity(data.trackType[0]);
          }

          return this.stateStyling.standard.opacity;
        },
        strokeOffset: (_point, _index, data) => {
          if (data.selected) {
            return this.stateStyling.selected.strokeWidth;
          }
          if (data.trackType) {
            return this.typeStyling.value.strokeWidth(data.trackType[0]);
          }
          return this.stateStyling.standard.strokeWidth;
        },
        strokeWidth: (_point, _index, data) => {
          if (data.selected) {
            return this.stateStyling.selected.strokeWidth;
          }
          if (data.trackType) {
            return this.typeStyling.value.strokeWidth(data.trackType[0]);
          }
          return this.stateStyling.standard.strokeWidth;
        },
      };
    }
}
