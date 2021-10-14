import { TypeStyling } from 'vue-media-annotator/use/useStyling';
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

export type FormatTextRow = (track: FrameDataTrack, typeStyling?: TypeStyling) => TextData[] | null;

interface TextLayerParams {
  formatter?: FormatTextRow;
}

/**
 * @param track - standard frameDataTrack info
 * @param maxPairs - maximum number of lines to show
 * @param lineHeight - height of each text line
 * @returns value or null.  null indicates that the text should not be displayed.
 */
function defaultFormatter(
  track: FrameDataTrack,
  typeStyling?: TypeStyling,
  maxPairs = 1,
  lineHeight = 20,
): TextData[] | null {
  if (track.features && track.features.bounds) {
    const { bounds } = track.features;
    if (bounds && track.confidencePairs !== null) {
      const arr: TextData[] = [];
      const totalVisiblePairs = Math.min(track.confidencePairs.length, maxPairs);
      for (let i = 0; i < track.confidencePairs.length; i += 1) {
        const [type, confidence] = track.confidencePairs[i];
        const isCurrentPair = (type === track.trackType[0]);
        const currentTypeIndication = (isCurrentPair && totalVisiblePairs > 1) ? '**' : '';
        let text = '';
        if (typeStyling) {
          const { showLabel, showConfidence } = typeStyling.labelSettings(type);
          if (showLabel && !showConfidence) {
            text = `${currentTypeIndication}${type}`;
          } else if (showConfidence && !showLabel) {
            text = `${currentTypeIndication}${confidence.toFixed(2)}`;
          } else if (showConfidence && showLabel) {
            text = `${currentTypeIndication}${type}: ${confidence.toFixed(2)}`;
          }
        }
        arr.push({
          selected: track.selected,
          editing: track.editing,
          type,
          confidence,
          text,
          x: bounds[2],
          y: -1, // updated below
          currentPair: isCurrentPair,
        });
      }
      return arr
        .sort((a, b) => (+b.currentPair) - (+a.currentPair)) // sort currentPair=true first
        .slice(0, totalVisiblePairs)
        .map((v, i) => ({ ...v, y: bounds[1] - (lineHeight * i) })); // calculate y after sort
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
      const formatted = this.formatter(track, this.typeStyling.value);
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
          if (data.selected && data.currentPair) {
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
