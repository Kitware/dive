import BaseLayer, { BaseLayerParams } from './BaseLayer';
import { FrameDataTrack } from './LayerTypes';

interface FormattedMarkerFeature {
  feature: 'head' | 'tail';
  x: number;
  y: number;
}

export default class MarkerLayer extends BaseLayer {
  pointFeature: any;

  constructor(params: BaseLayerParams) {
    super(params);
    this.pointFeature = this.featureLayer.createFeature('point');
    this.pointFeature.style(this.createStyle());
  }

  initialize() {
    this.featureLayer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point'],
    });
  }

  formatData(frameData: FrameDataTrack[]): FormattedMarkerFeature[] {
    const data = super.formatData(frameData) as FormattedMarkerFeature[];
    frameData.forEach((fd) => {
      const feature = fd.features;
      if (feature?.head) {
        data.push({
          feature: 'head',
          x: feature.head[0],
          y: feature.head[1],
        });
      }
      if (feature?.tail) {
        data.push({
          feature: 'tail',
          x: feature.tail[0],
          y: feature.tail[1],
        });
      }
    });
    return data;
  }

  createStyle() {
    const baseStyle = super.createStyle();
    return {
      ...baseStyle,
      fill: true,
      fillColor: (data: FormattedMarkerFeature) => (
        data.feature === 'tail' ? 'orange' : 'blue'
      ),
      radius: 4,
    };
  }

  redraw(): null {
    return this.pointFeature.data(this.formattedData).draw();
  }
}
