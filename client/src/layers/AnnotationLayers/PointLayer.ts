import BaseLayer, { LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

interface PointGeoJSData {
    trackId: number;
    selected: boolean;
    editing: boolean | string;
    trackType: [string, number] | null;
    feature: string;
    x: number;
    y: number;
}

export default class PointLayer extends BaseLayer<PointGeoJSData> {
  initialize() {
    const layer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point'],
    });
    this.featureLayer = layer.createFeature('point');
    super.initialize();
  }

  // eslint-disable-next-line class-methods-use-this
  formatData(frameData: FrameDataTrack[]): PointGeoJSData[] {
    const arr: PointGeoJSData[] = []; //(this.checkHeadTail(frameData));
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        if (track.features.geometry?.features?.[0]) {
          track.features.geometry.features.forEach((feature) => {
            if (feature.geometry && feature.geometry.type === 'Point') {
              const [x, y] = feature.geometry.coordinates;
              let key = 'point';
              if (feature.properties && feature.properties.key) {
                key = feature.properties.key;
              }
              const annotation: PointGeoJSData = {
                trackId: track.trackId,
                selected: track.selected,
                editing: track.editing,
                trackType: track.trackType,
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
      fill: true,
      fillColor: (data: PointGeoJSData) => (data.feature === 'tail' ? 'orange' : 'blue'),
      radius: (data: PointGeoJSData) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth * 2;
        }
        if (data.trackType) {
          return this.typeStyling.value.strokeWidth(data.trackType[0]) * 2;
        }
        return this.stateStyling.standard.strokeWidth * 2;
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
