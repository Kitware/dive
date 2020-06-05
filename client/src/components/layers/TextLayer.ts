import BaseLayer from '@/components/layers/BaseLayer';
import { FrameDataTrack } from '@/components/layers/LayerTypes';

interface TextData {
  selected: boolean;
  editing: boolean;
  type: string;
  confidence: number;
  text: string;
  x: number;
  y: number;
  offsetY?: number;
  offsetX?: number;
}

export default class TextLayer extends BaseLayer {
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
        if (bounds && track.confidencePairs !== undefined) {
          track.confidencePairs.forEach(([type, confidence], i) => {
            arr.push({
              selected: track.selected,
              editing: track.editing,
              type,
              confidence,
              text: `${type}: ${confidence.toFixed(2)}`,
              x: bounds[2],
              y: bounds[1],
              offsetY: i * 14,
            });
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

  createStyle() {
    const baseStyle = super.createStyle();
    return {
      ...baseStyle,
      color: (data: TextData) => {
        if (data.editing || data.selected) {
          if (!data.selected) {
            if (this.stateStyling.disabled.color !== 'type') {
              return this.stateStyling.disabled.color;
            }
            return this.typeColorMap(data.type);
          }
          return this.stateStyling.selected.color;
        }
        return this.typeColorMap(data.type);
      },
      offset: (data: TextData) => ({
        x: data.offsetY || 3,
        y: data.offsetX || -8,
      }),
    };
  }
}
