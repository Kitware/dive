import BaseLayer, { LayerStyle } from './BaseLayer';
import { FrameDataTrack } from './LayerTypes';

interface FormattedMarkerFeature {
  feature: 'head' | 'tail';
  x: number;
  y: number;
}

export default class MarkerLayer extends BaseLayer<FormattedMarkerFeature> {
  initialize() {
    const layer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point'],
    });
    this.featureLayer = layer.createFeature('point');
    super.initialize();
  }

  // eslint-disable-next-line class-methods-use-this
  formatData(frameData: FrameDataTrack[]): FormattedMarkerFeature[] {
    const data = [] as FormattedMarkerFeature[];
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

  createStyle(): LayerStyle<FormattedMarkerFeature> {
    return {
      ...super.createStyle(),
      fill: true,
      fillColor: (data: FormattedMarkerFeature) => (data.feature === 'tail' ? 'orange' : 'blue'),
      radius: 4,
    };
  }

  redraw(): null {
    return this.featureLayer.data(this.formattedData).draw();
  }
}
