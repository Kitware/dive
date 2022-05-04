import { TypeStyling } from '../../StyleManager';
import BaseLayer, { BaseLayerParams, LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

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
  // currentPair: boolean;
}

export type FormatTextRow = (
  annotation: FrameDataTrack, typeStyling?: TypeStyling) => TextData[] | null;

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
  annotation: FrameDataTrack,
  typeStyling?: TypeStyling,
): TextData[] | null {
  if (annotation.features && annotation.features.bounds) {
    const { bounds } = annotation.features;
    let confidencePairs = [annotation.styleType];
    if (annotation.groups.length) {
      const trackType = annotation.track.getType();
      confidencePairs = annotation.groups.map(({ confidencePairs: cp }) => {
        const [_type, _conf] = cp[0];
        return [
          `${trackType[0]}::${_type}`, _conf,
        ];
      });
    }
    const arr: TextData[] = [];

    for (let i = 0; i < confidencePairs.length; i += 1) {
      const [type, confidence] = confidencePairs[i];

      let text = '';
      if (typeStyling) {
        const { showLabel, showConfidence } = typeStyling.labelSettings(type);
        if (showLabel && !showConfidence) {
          text = type;
        } else if (showConfidence && !showLabel) {
          text = `${confidence.toFixed(2)}`;
        } else if (showConfidence && showLabel) {
          text = `${type}: ${confidence.toFixed(2)}`;
        }
      }
      arr.push({
        selected: annotation.selected,
        editing: annotation.editing,
        type: annotation.styleType[0],
        confidence,
        text,
        x: bounds[2],
        y: bounds[1],
      });
    }
    return arr;
    // .sort((a, b) => (+b.currentPair) - (+a.currentPair)) // sort currentPair=true first
    // .map((v, i) => ({ ...v, y: bounds[1] - (lineHeight * i) })); // calculate y after sort
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
    const typeStyling = this.typeStyling.value;
    frameData.forEach((track: FrameDataTrack) => {
      const formatted = this.formatter(track, typeStyling);
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
          if (!data.selected) {
            if (this.stateStyling.disabled.color !== 'type') {
              return this.stateStyling.disabled.color;
            }
            return this.typeStyling.value.color(data.type);
          }
          if (data.selected) {
            return this.stateStyling.selected.color;
          }
          return this.typeStyling.value.color(data.type);
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
