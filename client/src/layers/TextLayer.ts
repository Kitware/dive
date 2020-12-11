import BaseLayer, { BaseLayerParams, LayerStyle } from './BaseLayer';
import { FrameDataTrack } from './LayerTypes';

export interface TextData {
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

export type FormatTextRow = (track: FrameDataTrack) => TextData | null;

interface TextLayerParams {
  formatter?: FormatTextRow;
}

/**
 * @returns value or null.  null indicates that the text should not be displayed.
 */
function defaultFormatter(track: FrameDataTrack): TextData | null {
  if (track.features && track.features.bounds) {
    const { bounds } = track.features;
    if (bounds && track.confidencePairs !== null) {
      const type = track.confidencePairs[0];
      const confidence = track.confidencePairs[1];
      return {
        selected: track.selected,
        editing: track.editing,
        type,
        confidence,
        text: `${type}: ${confidence.toFixed(2)}`,
        x: bounds[2],
        y: bounds[1],
      };
    }
  }
  return null;
}

export default class TextLayer extends BaseLayer<TextData> {
  formatter: FormatTextRow;

  constructor(params: BaseLayerParams & TextLayerParams) {
    super(params);
    this.formatter = params.formatter || defaultFormatter;
  }

  initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['text'],
    });
    this.featureLayer = layer
      .createFeature('text')
      .text((data: TextData) => data.text)
      .position((data: TextData) => ({ x: data.x, y: data.y }));
    super.initialize();
  }

  formatData(frameData: FrameDataTrack[]) {
    const arr = [] as TextData[];
    frameData.forEach((track: FrameDataTrack) => {
      const formatted = this.formatter(track);
      if (formatted !== null) {
        arr.push(formatted);
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
