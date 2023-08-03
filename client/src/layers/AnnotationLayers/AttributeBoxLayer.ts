/* eslint-disable max-len */
/* eslint-disable class-methods-use-this */

import { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import { boundToGeojson } from '../../utils';
import BaseLayer, { LayerStyle, BaseLayerParams } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';
import { calculateAttributeArea } from './AttributeLayer';

interface RectGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  styleType: [string, number] | null;
  lineColor: string;
  lineThickness: number;
  boxBackground?: string;
  boxOpacity?: number;
  polygon: GeoJSON.Polygon;
}


export default class AttributeBoxLayer extends BaseLayer<RectGeoJSData> {
    renderAttributes: Attribute[];

    constructor(params: BaseLayerParams) {
      super(params);
      //Only initialize once, prevents recreating Layer each edit
      this.renderAttributes = [];
      this.initialize();
    }

    initialize() {
      const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
        features: ['polygon'],
      });
      this.featureLayer = layer
        .createFeature('polygon');

      super.initialize();
    }

    updateRenderAttributes(attributes: Attribute[]) {
      this.renderAttributes = attributes;
    }

    formatData(frameData: FrameDataTrack[]) {
      const arr: RectGeoJSData[] = [];
      frameData.forEach((track: FrameDataTrack) => {
        if (track.features && track.features.bounds) {
          // So we need to go through the renderAttr and create a bounds for each renderAttr based on the settings
          const renderFiltered = this.renderAttributes.filter((item) => {
            if (item.render) {
              if (!item.render.typeFilter.includes('all')) {
                return item.render.typeFilter.includes(track.styleType[0]);
              }
              if (item.render.selected && !track.selected) {
                return false;
              }
              if (item.render.typeFilter.includes('all')) {
                return true;
              }
            }
            return false;
          });
          for (let i = 0; i < renderFiltered.length; i += 1) {
            const currentRender = renderFiltered[i].render;
            if (currentRender && currentRender.box) {
              const { newBounds } = calculateAttributeArea(track.features.bounds, renderFiltered[i].render, i, renderFiltered.length);
              const polygon = boundToGeojson(newBounds);
              const lineColor = currentRender.boxColor === 'auto' ? renderFiltered[i].color || 'white' : currentRender.boxColor;
              const lineThickness = currentRender.boxThickness || 1;
              const { boxBackground } = currentRender;
              const { boxOpacity } = currentRender;
              const annotation: RectGeoJSData = {
                trackId: track.track.id,
                selected: track.selected,
                editing: track.editing,
                styleType: track.styleType,
                lineColor,
                lineThickness,
                boxBackground,
                boxOpacity,
                polygon,
              };
              arr.push(annotation);
            }
          }
        }
      });
      return arr;
    }

    redraw() {
      this.featureLayer
        .data(this.formattedData)
        .polygon((d: RectGeoJSData) => d.polygon.coordinates[0])
        .draw();
    }

    disable() {
      this.featureLayer
        .data([])
        .draw();
    }

    createStyle(): LayerStyle<RectGeoJSData> {
      return {
        ...super.createStyle(),
        // Style conversion to get array objects to work in geoJS
        position: (point) => ({ x: point[0], y: point[1] }),
        strokeColor: (_point, _index, data) => data.lineColor,
        fill: (data) => {
          if (data.boxOpacity) {
            return !!data.boxOpacity;
          }
          if (data.styleType) {
            return this.typeStyling.value.fill(data.styleType[0]);
          }
          return this.stateStyling.standard.fill;
        },
        fillColor: (_point, _index, data) => {
          if (data.boxBackground) {
            return data.boxBackground;
          }
          if (data.styleType) {
            return this.typeStyling.value.color(data.styleType[0]);
          }
          return this.typeStyling.value.color('');
        },
        fillOpacity: (_point, _index, data) => {
          if (data.boxOpacity) {
            return data.boxOpacity;
          }
          if (data.styleType) {
            return this.typeStyling.value.opacity(data.styleType[0]);
          }
          return this.stateStyling.standard.opacity;
        },
        strokeOpacity: (_point, _index, data) => {
        // Reduce the rectangle opacity if a polygon is also drawn
          if (data.boxOpacity) {
            return data.boxOpacity;
          }
          if (data.selected) {
            return this.stateStyling.selected.opacity;
          }
          if (data.styleType) {
            return this.typeStyling.value.opacity(data.styleType[0]);
          }

          return this.stateStyling.standard.opacity;
        },
        strokeOffset: (_point, _index, data) => {
          if (data.lineThickness) {
            return data.lineThickness;
          }
          return this.stateStyling.standard.strokeWidth;
        },
        strokeWidth: (_point, _index, data) => {
          if (data.lineThickness) {
            return data.lineThickness;
          }
          return this.stateStyling.standard.strokeWidth;
        },
      };
    }
}
