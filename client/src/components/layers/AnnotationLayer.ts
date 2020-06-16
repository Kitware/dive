/* eslint-disable class-methods-use-this */
import BaseLayer, { LayerStyle } from '@/components/layers/BaseLayer';
import { boundToGeojson } from '@/utils';
import geo, { GeoEvent } from 'geojs';
import { FrameDataTrack } from '@/components/layers/LayerTypes';

interface RectGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean;
  confidencePairs: [string, number] | null;
  polygon: GeoJSON.Polygon;
}

export default class AnnotationLayer extends BaseLayer<RectGeoJSData> {
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
      .polygon((d: RectGeoJSData) => d.polygon.coordinates[0])
      .draw();
  }

  createStyle(): LayerStyle<RectGeoJSData> {
    return {
      ...super.createStyle(),
      // Style conversion to get array objects to work in geoJS
      position: (point) => ({ x: point[0], y: point[1] }),
      strokeColor: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.confidencePairs) {
          return this.typeColorMap(data.confidencePairs[0]);
        }
        return this.typeColorMap.range()[0];
      },
      strokeOpacity: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.opacity;
        }
        return this.stateStyling.standard.opacity;
      },
      strokeWidth: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        return this.stateStyling.standard.strokeWidth;
      },
    };
  }
}
