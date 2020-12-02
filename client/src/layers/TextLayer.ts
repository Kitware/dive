import BaseLayer, { LayerStyle } from './BaseLayer';
import { FrameDataTrack } from './LayerTypes';

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
  currentPair?: boolean;
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
          const lineHeight = 25;
          let currentHeight = bounds[1] - lineHeight * (track.confidencePairs.length - 1);
          track.confidencePairs.forEach((pair) => {
            const type = pair[0];
            const confidence = pair[1];
            arr.push({
              selected: track.selected,
              editing: track.editing,
              type,
              confidence,
              text: `${type}: ${confidence.toFixed(2)}`,
              x: bounds[2],
              y: currentHeight,
              currentPair: track.trackType === pair,
            });
            currentHeight += lineHeight;
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
      textOpacity: ((data) => {
        if (data.currentPair) {
          return 1.0;
        }
        return this.stateStyling.disabled.opacity;
      }),
      offset: (data) => ({
        x: data.offsetY || 3,
        y: data.offsetX || -8,
      }),
    };
  }
}
