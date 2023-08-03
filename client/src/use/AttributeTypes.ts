import { LineChartData } from './useLineChart';

export interface NumericAttributeEditorOptions {
  type: 'combo'| 'slider';
  range?: number[];
  steps?: number;
}
export interface StringAttributeEditorOptions {
  type: 'locked'| 'freeform';
}

export interface AttributeRendering {
  typeFilter: string[];
  selected?: boolean;
  displayName: string;
  displayColor: 'auto' | string;
  displayTextSize: number;
  valueColor: 'auto' | string;
  valueTextSize: number;
  order: number;
  location: 'inside' | 'outside';
  box: boolean;
  boxColor: 'auto' | string;
  boxThickness: number;
  boxBackground?: string;
  boxOpacity?: number;
  layout: 'vertical' | 'horizontal';
  displayWidth: {
    type: 'px' | '%';
    val: number;
  };
  displayHeight: {
    type: 'px' | 'auto' | '%';
    val: number;
  };
}
export interface Attribute {
  belongs: 'track' | 'detection';
  datatype: 'text' | 'number' | 'boolean';
  values?: string[];
  valueColors?: Record<string, string>;
  name: string;
  key: string;
  color?: string;
  user?: boolean;
  editor?: NumericAttributeEditorOptions | StringAttributeEditorOptions;
  render?: AttributeRendering;

}

export type Attributes = Record<string, Attribute>;
type ValueOf<T> = T[keyof T];

export interface AttributeNumberFilter {
  type: 'range' | 'top'; // range filters for number values, top will show highest X values
  comp: '>' | '<' | '>=' | '<=';
  value: number; //current value
  active: boolean; // if this filter is active
  // Settings for Number Fitler
  range: [number, number]; // Pairs of number indicating start/stop ranges
  appliedTo: string[];
}

export interface AttributeStringFilter {
  comp: '=' | '!=' | 'contains' | 'starts';
  value: string[]; //Compares with array of items
  appliedTo: string[];
  active: boolean; // if this filter is active
}

export interface AttributeKeyFilter {
  appliedTo: string[];
  active: boolean; // if this filter is active
  value: boolean;
  type: 'key';
}
export interface AttributeBoolFilter {
  value: boolean;
  type: 'is' | 'not';
  appliedTo: string[];
  active: boolean; // if this filter is active
}
export interface AttributeFilter {
  dataType: Attribute['datatype'] | 'key';
  filterData:
  AttributeNumberFilter
  | AttributeStringFilter
  | AttributeBoolFilter
  | AttributeKeyFilter;
}

export interface TimelineAttribute {
  data: LineChartData;
  minFrame: number;
  maxFrame: number;
  minValue?: number;
  maxValue?: number;
  avgValue?: number;
  type: Attribute['datatype'];
}
