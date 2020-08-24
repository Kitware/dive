import BaseLayer, { LayerStyle } from 'vue-media-annotator/layers/BaseLayer';
import { FrameDataTrack } from 'vue-media-annotator/layers/LayerTypes';

interface TextData {
  selected: boolean;
  editing: boolean | string;
  type: string;
  confidence: number;
  text: string;
  x: number;
  y: number;
  offsetY?: number;
  offsetX?: number;
}

export default class TextLayer extends BaseLayer<TextData> {
  initialize() {
    const layer = this.annotator.geoViewer.createLayer('feature', {
      features: ['text'],
    });
    this.featureLayer = layer
      .createFeature('text')
      .text((data: TextData) => data.text)
      .position((data: TextData) => ({ x: data.x, y: data.y }));
    super.initialize();
  }

  // eslint-disable-next-line class-methods-use-this
  formatData(frameData: FrameDataTrack[]) {
    const arr = [] as TextData[];
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        const { bounds } = track.features;
        if (bounds && track.confidencePairs !== null) {
          const type = track.confidencePairs[0];
          const confidence = track.confidencePairs[1];
          arr.push({
            selected: track.selected,
            editing: track.editing,
            type,
            confidence,
            text: `${type}: ${confidence.toFixed(2)}`,
            x: bounds[2],
            y: bounds[1],
          });
        }
      }
    });
    return arr;
  }

  redraw() {
    this.featureLayer.data(this.formattedData).draw();
    return null;
  }

  disable() {
    this.featureLayer.data([]).draw();
  }

  createStyle(): LayerStyle<TextData> {
    const baseStyle = super.createStyle();
    return {
      ...baseStyle,
      color: (data) => {
        if (data.editing || data.selected) {
          if (!data.selected) {
            if (this.stateStyling.disabled.color !== 'type') {
              return this.stateStyling.disabled.color;
            }
            return this.typeStyling.value.color(data.type);
          }
          return this.stateStyling.selected.color;
        }
        return this.typeStyling.value.color(data.type);
      },
      offset: (data) => ({
        x: data.offsetY || 3,
        y: data.offsetX || -8,
      }),
    };
  }
}
