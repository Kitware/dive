import BaseLayer, { LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

interface PointGeoJSData {
    trackId: number;
    selected: boolean;
    editing: boolean | string;
  styleType: [string, number] | null;
    feature: string;
    x: number;
    y: number;
}

export default class PointLayer extends BaseLayer<PointGeoJSData> {
  initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['point'],
    });
    this.featureLayer = layer.createFeature('point');
    super.initialize();
  }

  // eslint-disable-next-line class-methods-use-this
  formatData(frameDataTracks: FrameDataTrack[]): PointGeoJSData[] {
    const arr: PointGeoJSData[] = []; //(this.checkHeadTail(frameData));
    frameDataTracks.forEach((frameData: FrameDataTrack) => {
      if (frameData.features && frameData.features.bounds) {
        if (frameData.features.geometry?.features?.[0]) {
          frameData.features.geometry.features.forEach((feature) => {
            if (feature.geometry && feature.geometry.type === 'Point') {
              const [x, y] = feature.geometry.coordinates;
              let key = 'point';
              if (feature.properties && feature.properties.key) {
                key = feature.properties.key;
              }
              const annotation: PointGeoJSData = {
                trackId: frameData.track.id,
                selected: frameData.selected,
                editing: frameData.editing,
                styleType: frameData.styleType,
                feature: key,
                x,
                y,
              };
              arr.push(annotation);
            }
          });
        }
      }
    });
    return arr;
  }

  createStyle(): LayerStyle<PointGeoJSData> {
    return {
      ...super.createStyle(),
      fill: (data: PointGeoJSData) => data.feature === 'head',
      fillColor: (data: PointGeoJSData) => {
        if (data.styleType) {
          return this.typeStyling.value.color(data.styleType[0]);
        }
        return this.typeStyling.value.color('');
      },
      fillOpacity: (data: PointGeoJSData) => {
        if (data.styleType) {
          return this.typeStyling.value.opacity(data.styleType[0]);
        }
        return this.stateStyling.standard.opacity;
      },
      radius: (data: PointGeoJSData) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth * 2;
        }
        if (data.styleType) {
          return this.typeStyling.value.strokeWidth(data.styleType[0]) * 2;
        }
        return this.stateStyling.standard.strokeWidth * 2;
      },
      strokeWidth: (data: PointGeoJSData) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        if (data.styleType) {
          return this.typeStyling.value.strokeWidth(data.styleType[0]);
        }
        return this.stateStyling.standard.strokeWidth;
      },
      strokeColor: (data: PointGeoJSData) => {
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.styleType) {
          return this.typeStyling.value.color(data.styleType[0]);
        }
        return this.typeStyling.value.color('');
      },
    };
  }

  redraw(): null {
    return this.featureLayer.data(this.formattedData).draw();
  }

  disable() {
    this.featureLayer
      .data([])
      .draw();
  }
}
