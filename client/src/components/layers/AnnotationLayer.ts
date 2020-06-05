/* eslint-disable class-methods-use-this */
import BaseLayer from '@/components/layers/BaseLayer';
import { boundToGeojson } from '@/utils';
import geo, { Polygon, GeoEvent } from 'geojs';
import { FrameDataTrack } from '@/components/layers/LayerTypes';

 interface RectGeoJSData{
   trackId: number;
   selected: boolean;
   editing: boolean;
   confidencePairs?: [string, number] | null;
   polygon: Polygon;
 }

export default class AnnotationLayer extends BaseLayer {
  initialize() {
    const layer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point', 'line', 'polygon'],
    });
    this.featureLayer = layer
      .createFeature('polygon', { selectionAPI: true })
      .geoOn(geo.event.feature.mouseclick, (e: GeoEvent) => {
        if (e.mouse.buttonsDown.left) {
          if (!e.data.editing || (e.data.editing && !e.data.selected)) {
            this.$emit('annotationClicked', e.data.trackId, false);
          }
        } else if (e.mouse.buttonsDown.right) {
          if (!e.data.editing || (e.data.editing && !e.data.selected)) {
            this.$emit('annotationRightClicked', e.data.trackId, true);
          }
        }
      });
    this.featureLayer.geoOn(
      geo.event.feature.mouseclick_order,
      this.featureLayer.mouseOverOrderClosestBorder,
    );
    this.featureLayer.geoOn(geo.event.mouseclick, (e: GeoEvent) => {
      // If we aren't clicking on an annotation we can deselect the current track
      if (this.featureLayer.pointSearch(e.geo).found.length === 0) {
        this.$emit('annotationClicked', null, false);
      }
    });
    super.initialize();
  }

  formatData(frameData: FrameDataTrack[]) {
    const arr: RectGeoJSData[] = [];
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        const polygon = boundToGeojson(track.features.bounds);
        const annotation: RectGeoJSData = {
          trackId: track.trackId,
          selected: track.selected,
          editing: track.editing,
          confidencePairs: track.confidencePairs,
          polygon,
        };
        arr.push(annotation);
      }
    });
    return arr;
  }

  redraw() {
    this.featureLayer
      .data(this.formattedData)
      .polygon((d: RectGeoJSData) => d.polygon.coordinates)
      .draw();
    return null;
  }

  createStyle() {
    const baseStyle = super.createStyle();
    return {
      ...baseStyle,
      // Style conversion to get array objects to work in geoJS
      position: (data: [number, number]) => {
        const obj = { x: data[0], y: data[1] };
        return obj;
      },
      strokeColor: (point: [number, number], index: number, data: RectGeoJSData) => {
        if (data.editing) {
          if (!data.selected) {
            if (this.stateStyling.disabled && this.stateStyling.disabled.color !== 'type') {
              return this.stateStyling.disabled.color;
            }
            if (data.confidencePairs && data.confidencePairs.length) {
              return this.typeColorMap(data.confidencePairs[0][0]);
            }
          }
          return this.stateStyling.selected.color;
        }
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.confidencePairs && data.confidencePairs.length) {
          return this.typeColorMap(data.confidencePairs[0][0]);
        }
        return this.typeColorMap.range()[0];
      },
      strokeOpacity: (point: [number, number], index: number, data: RectGeoJSData) => {
        if (data.editing) {
          if (this.stateStyling.disabled && !data.selected) {
            return this.stateStyling.disabled.opacity;
          }
          if (this.stateStyling.selected) {
            return this.stateStyling.selected.opacity;
          }
        }

        if (data.selected) {
          return this.stateStyling.selected.opacity;
        }
        return this.stateStyling.standard.opacity;
      },
      strokeWidth: (point: [number, number], index: number, data: RectGeoJSData) => {
        if (data.editing) {
          if (!data.selected) {
            return this.stateStyling.disabled.strokeWidth;
          }
          return this.stateStyling.selected.strokeWidth;
        }

        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        return this.stateStyling.standard.strokeWidth;
      },
    };
  }
}
