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
  currentPair: boolean;
}

export type FormatTextRow = (track: FrameDataTrack) => TextData[] | null;

interface TextLayerParams {
  formatter?: FormatTextRow;
}
/**
 * @param track - standard frameDataTrack info
 * @param additionalNum Number of additional pairs to display, top pair is the current pair
 * followed by more in descending order.
 * @returns value or null.  null indicates that the text should not be displayed.
 */
function defaultFormatter(track: FrameDataTrack, additionalNum = 0): TextData[] | null {
  if (track.features && track.features.bounds) {
    const { bounds } = track.features;

    if (bounds && track.confidencePairs !== null) {
      const lineHeight = 20;
      const arr: TextData[] = [];
      const baseType = track.trackType[0];
      const baseConfidence = track.trackType[1];
      const currentTypeIndication = additionalNum > 0 && track.confidencePairs.length > 1 ? '**' : '';
      arr.push({
        selected: track.selected,
        editing: track.editing,
        type: track.trackType[0],
        confidence: baseConfidence,
        text: `${currentTypeIndication}${baseType}: ${baseConfidence.toFixed(2)}`,
        x: bounds[2],
        y: bounds[1],
        currentPair: true,
      });
      //Now we display any additional types besides the default type
      const maxAdditionalPairs = Math.min(track.confidencePairs.length, additionalNum);
      let currentHeight = bounds[1] - (lineHeight * (maxAdditionalPairs));
      let pairCount = 0;
      for (let i = 0; i < track.confidencePairs.length; i += 1) {
        if (pairCount >= maxAdditionalPairs) {
          break;
        }
        if (track.trackType !== track.confidencePairs[i]) {
          const type = track.confidencePairs[i][0];
          const confidence = track.confidencePairs[i][1];
          arr.push({
            selected: track.selected,
            editing: track.editing,
            type,
            confidence,
            text: `${type}: ${confidence.toFixed(2)}`,
            x: bounds[2],
            y: currentHeight,
            currentPair: false,
          });
          currentHeight += lineHeight;
          pairCount += 1;
        }
      }

      return arr;
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
        arr.push(...formatted);
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
          if (!data.selected && !data.currentPair) {
            if (this.stateStyling.disabled.color !== 'type') {
              return this.stateStyling.disabled.color;
            }
            return this.typeStyling.value.color(data.type);
          }
          if (data.currentPair) {
            return this.stateStyling.selected.color;
          }
          return this.typeStyling.value.color(data.type);
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
