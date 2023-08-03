/* eslint-disable max-len */
import type { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import { StringKeyObject } from 'vue-media-annotator/BaseAnnotation';
import { RectBounds } from 'vue-media-annotator/utils';
import { TypeStyling } from '../../StyleManager';
import BaseLayer, { BaseLayerParams, LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

export interface AttributeTextData {
  selected: boolean;
  editing: boolean | string;
  color: string;
  fontSize: string;
  text: string;
  x: number;
  y: number;
  offsetY?: number;
  offsetX?: number;
  // currentPair: boolean;
}

export type FormatTextRow = (
  annotation: FrameDataTrack,
  renderAttr: Attribute[],
  user: string,
  typeStyling: TypeStyling) => AttributeTextData[] | null;

interface AttributeLayerParams {
  formatter?: FormatTextRow;
}

// function to calculate x,y as well as bounds based on render settings
export function calculateAttributeArea(baseBounds: RectBounds, renderSettings: Attribute['render'], renderIndex: number, renderAttrLength: number) {
  // Calculate X Position
  if (renderSettings) {
    const trackWidth = baseBounds[2] - baseBounds[0];
    const widthType = renderSettings.displayWidth.type;
    let width = renderSettings.displayWidth.val; //px is the type so the width is this
    if (widthType === '%') {
      width = trackWidth * 0.01 * renderSettings.displayWidth.val;
    }
    // calculate center position for point
    const x = baseBounds[2] + 0.5 * width;
    // Calcualte Y Position
    const trackHeight = baseBounds[3] - baseBounds[1];
    const heightType = renderSettings.displayHeight.type;
    let height = renderSettings.displayHeight.val; // px is the height
    if (heightType === 'auto') { //The height is auto calculated based on length of attributes being rendered
      height = (trackHeight / renderAttrLength);
    }
    if (heightType === '%') {
      height = trackHeight * 0.01 * renderSettings.displayHeight.val;
    }
    // So I think we want to set Display/Value
    const displayHeight = baseBounds[1] + (height * renderIndex) + height * (1 / 3);
    const valueHeight = baseBounds[1] + (height * renderIndex) + height * (2 / 3);

    // [x1, y1, x2, y2] as (left, top), (bottom, right)
    const newBounds: RectBounds = [baseBounds[2], baseBounds[1] + (height * renderIndex), baseBounds[2] + width, baseBounds[1] + (height * renderIndex) + height];

    return {
      x, displayHeight, valueHeight, newBounds,
    };
  }
  return {
    x: 0, displayHeight: 0, valueHeight: 0, newBounds: [0, 0, 0, 0] as RectBounds,
  };
}

/**
 * @param track - standard frameDataTrack info
 * @param maxPairs - maximum number of lines to show
 * @param lineHeight - height of each text line
 * @returns value or null.  null indicates that the text should not be displayed.
 */
function defaultFormatter(
  annotation: FrameDataTrack,
  renderAttr: Attribute[],
  user: string,
  typeStyling: TypeStyling,
): AttributeTextData[] | null {
  if (annotation.features && annotation.features.bounds) {
    const { bounds } = annotation.features;
    const arr: AttributeTextData[] = [];
    // figure out the attributes we are displaying:
    const renderFiltered = renderAttr.filter((item) => {
      if (item.render) {
        if (!item.render.typeFilter.includes('all')) {
          return item.render.typeFilter.includes(annotation.styleType[0]);
        }
        if (item.render.selected && !annotation.selected) {
          return false;
        }
        if (item.render.typeFilter.includes('all')) {
          return true;
        }
      }
      return false;
    });

    for (let i = 0; i < renderFiltered.length; i += 1) {
      const currentRender = renderFiltered[i].render;
      const { name } = renderFiltered[i];
      if (currentRender !== undefined) {
        const { displayName } = currentRender;
        const type = renderFiltered[i].belongs;
        // Calculate Value
        let value: string | number | boolean = '';
        if (type === 'detection') {
          if (annotation.features && annotation.features.attributes) {
            const { attributes } = annotation.features;
            if (renderFiltered[i].user && user && attributes.userAttributes && attributes.userAttributes[user]) {
              value = (attributes.userAttributes[user] as StringKeyObject)[name] as string | boolean | number;
            } else {
              value = attributes[name] as string | boolean | number;
            }
          }
        }
        if (type === 'track') {
          const { attributes } = annotation.track;
          if (attributes) {
            if (renderAttr[i].user && user && attributes.userAttributes && attributes.userAttributes[user]) {
              value = (attributes.userAttributes[user] as StringKeyObject)[name] as string | boolean | number;
            } else {
              value = attributes[name] as string | boolean | number;
            }
          }
        }

        const { x, displayHeight, valueHeight } = calculateAttributeArea(bounds, currentRender, i, renderFiltered.length);

        const displayColor = currentRender.displayColor === 'auto' ? renderAttr[i].color : currentRender.displayColor;
        const { displayTextSize } = currentRender;
        arr.push({
          selected: annotation.selected,
          editing: annotation.editing,
          color: displayColor || 'white',
          text: displayName,
          fontSize: `${displayTextSize}px`,
          x,
          y: displayHeight,
          offsetX: 20,
        });
        let valueColor = currentRender.valueColor === 'auto' ? renderAttr[i].color : currentRender.valueColor;
        if (renderAttr[i].datatype === 'text' && currentRender.valueColor === 'auto' && renderAttr[i].valueColors && typeof value === 'string') {
          const list = renderAttr[i].valueColors;
          if (list) {
            valueColor = list[value] || valueColor;
          }
        }
        const { valueTextSize } = currentRender;
        if (value === undefined) {
          value = '';
        }
        arr.push({
          selected: annotation.selected,
          editing: annotation.editing,
          color: valueColor || 'white',
          text: value.toString(),
          fontSize: `${valueTextSize}px`,
          x,
          y: valueHeight,
          offsetX: 20,
        });
      }
    }
    return arr;
    // .sort((a, b) => (+b.currentPair) - (+a.currentPair)) // sort currentPair=true first
    // .map((v, i) => ({ ...v, y: bounds[1] - (lineHeight * i) })); // calculate y after sort
  }
  return null;
}

export default class AttributeLayer extends BaseLayer<AttributeTextData> {
  formatter: FormatTextRow;

  renderAttributes: Attribute[];

  user: string;

  constructor(params: BaseLayerParams & AttributeLayerParams) {
    super(params);
    this.formatter = defaultFormatter;
    this.renderAttributes = [];
    this.user = '';
  }

  initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['text'],
    });
    this.featureLayer = layer
      .createFeature('text')
      .text((data: AttributeTextData) => data.text)
      .position((data: AttributeTextData) => ({ x: data.x, y: data.y }));
    super.initialize();
  }

  updateRenderAttributes(attributes: Attribute[], user: string) {
    this.renderAttributes = attributes;
    this.user = user;
  }

  formatData(frameData: FrameDataTrack[]) {
    const arr = [] as AttributeTextData[];
    const typeStyling = this.typeStyling.value;
    frameData.forEach((track: FrameDataTrack) => {
      const formatted = this.formatter(track, this.renderAttributes, this.user, typeStyling);
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

  createStyle(): LayerStyle<AttributeTextData> {
    const baseStyle = super.createStyle();
    return {
      ...baseStyle,
      textAlign: 'center',
      color: (data) => data.color,
      fontSize: (data) => data.fontSize,
      textScaled: 0,
    };
  }
}
