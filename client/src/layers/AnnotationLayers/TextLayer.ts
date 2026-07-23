import { Ref } from 'vue';
import { TypeStyling } from '../../StyleManager';
import BaseLayer, { BaseLayerParams, LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

export interface TextData {
  selected: boolean;
  editing: boolean | string;
  type: string;
  /** Suppression type name when displaying as suppressed (label indicator) */
  suppressed?: string;
  confidence: number;
  text: string;
  x: number;
  y: number;
  offsetY?: number;
  offsetX?: number;
  set?: string;
}

export type FormatTextRow = (
  annotation: FrameDataTrack,
  typeStyling?: TypeStyling,
  showUserCreatedIcon?: boolean,
  showSuppressedTags?: boolean,
) => TextData[] | null;

interface TextLayerParams {
  formatter?: FormatTextRow;
  showUserCreatedIcon?: Ref<boolean>;
  showSuppressedTags?: Ref<boolean>;
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
  showUserCreatedIcon: boolean = true,
  showSuppressedTags: boolean = true,
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
      const userModified = annotation.features?.attributes?.userModified === true;
      const userCreated = annotation.track.attributes?.userCreated === true;
      // mdi-pencil (U+F03EB) / mdi-eye-off (U+F0209) — rendered via Material Design Icons
      const modifiedIndicator = (showUserCreatedIcon && (userModified || userCreated))
        ? ' \u{F03EB}' : '';
      const suppressedIndicator = (showSuppressedTags && annotation.suppressed) ? ' \u{F0209}' : '';
      if (typeStyling) {
        const { showLabel, showConfidence } = typeStyling.labelSettings(type);
        if (showLabel && !showConfidence) {
          text = type + suppressedIndicator + modifiedIndicator;
        } else if (showConfidence && !showLabel) {
          text = `${confidence.toFixed(2)}${suppressedIndicator}${modifiedIndicator}`;
        } else if (showConfidence && showLabel) {
          text = `${type}${suppressedIndicator}: ${confidence.toFixed(2)}${modifiedIndicator}`;
        }
      }
      arr.push({
        selected: annotation.selected,
        editing: annotation.editing,
        type: annotation.styleType[0],
        suppressed: annotation.suppressed,
        confidence,
        text,
        x: bounds[2],
        y: bounds[1],
      });
    }
    if (annotation.track.set && confidencePairs.length) {
      const { set } = annotation.track;
      let text = '';
      const [type, confidence] = confidencePairs[0];
      if (typeStyling) {
        const { showLabel } = typeStyling.labelSettings(set, true);
        if (showLabel) {
          text = set;
          arr.push({
            selected: annotation.selected,
            editing: annotation.editing,
            type,
            confidence,
            text,
            x: bounds[2],
            y: bounds[3],
            offsetX: 10,
            set,
          });
        }
      }
    }
    return arr;
  }
  return null;
}

export default class TextLayer extends BaseLayer<TextData> {
  formatter: FormatTextRow;

  showUserCreatedIcon: Ref<boolean>;

  showSuppressedTags: Ref<boolean>;

  constructor(params: BaseLayerParams & TextLayerParams) {
    super(params);
    this.showUserCreatedIcon = params.showUserCreatedIcon || { value: true } as Ref<boolean>;
    this.showSuppressedTags = params.showSuppressedTags || { value: true } as Ref<boolean>;
    this.formatter = params.formatter || defaultFormatter;
  }

  initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['text'],
    });
    this.featureLayer = layer
      .createFeature('text')
      .text((data: TextData) => data.text)
      .position((data: TextData) => this.transformXY(data));
    super.initialize();
  }

  formatData(frameData: FrameDataTrack[]) {
    const arr = [] as TextData[];
    const typeStyling = this.typeStyling.value;
    const showIcon = this.showUserCreatedIcon.value;
    const showTags = this.showSuppressedTags.value;
    frameData.forEach((track: FrameDataTrack) => {
      const formatted = this.formatter(track, typeStyling, showIcon, showTags);
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
      // Include MDI so label glyphs (mdi-pencil, mdi-eye-off) render alongside text
      font: 'bold 16px sans-serif, "Material Design Icons"',
      color: (data) => {
        if (data.set) {
          return this.typeStyling.value.annotationSetColor(data.set);
        }
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
