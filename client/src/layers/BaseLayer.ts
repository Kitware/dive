/*eslint class-methods-use-this: "off"*/
import Vue from 'vue';
import { Ref } from '@vue/composition-api';

import { MediaController } from '../components/annotators/mediaControllerType';
import { StateStyles, TypeStyling } from '../StyleManager';
import { FrameDataTrack } from './LayerTypes';

// eslint-disable-next-line max-len
export type StyleFunction<T, D> = T | ((point: [number, number], index: number, data: D) => T | undefined);
export type ObjectFunction<T, D> = T | ((data: D, index: number) => T | undefined);
export type PointFunction<T, D> = T | ((data: D) => T | undefined);

export interface LayerStyle<D> {
  strokeWidth?: StyleFunction<number, D> | PointFunction<number, D>;
  strokeOffset?: StyleFunction<number, D> | PointFunction<string, D>;
  strokeOpacity?: StyleFunction<number, D> | PointFunction<string, D>;
  strokeColor?: StyleFunction<string, D> | PointFunction<string, D>;
  fillColor?: StyleFunction<string, D> | PointFunction<string, D>;
  fillOpacity?: StyleFunction<number, D> | PointFunction<number, D>;
  position?: (point: [number, number]) => { x: number; y: number };
  color?: (data: D) => string;
  textOpacity?: (data: D) => number;
  offset?: (data: D) => { x: number; y: number };
  fill?: ObjectFunction<boolean, D> | boolean;
  radius?: PointFunction<number, D> | number;
  [x: string]: unknown;
}

export interface MarkerStyle<D> {
  symbol: number;
  symbolValue: (number | boolean)[];
  radius?: PointFunction<number, D> | number;
  strokeWidth?: StyleFunction<number, D> | number;
  strokeOffset?: StyleFunction<number, D> | number;
  strokeOpacity?: StyleFunction<number, D> | number;
  strokeColor?: StyleFunction<string, D> | ObjectFunction<string, D>;
  fillColor?: StyleFunction<string, D> | ObjectFunction<string, D>;
  fillOpacity?: StyleFunction<number, D> | ObjectFunction<string, D> | number;
}

export interface BaseLayerParams {
    frameData?: FrameDataTrack;
    annotator: MediaController;
    stateStyling: StateStyles;
    typeStyling: Ref<TypeStyling>;
}

export default abstract class BaseLayer<D> {
    formattedData: D[];

    annotator: MediaController;

    stateStyling: StateStyles;

    style: LayerStyle<D>;

    typeStyling: Ref<TypeStyling>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    featureLayer: any;

    selectedIndex: number[]; // sparse array

    bus: Vue;

    constructor({
      annotator,
      stateStyling,
      typeStyling,
    }: BaseLayerParams) {
      this.annotator = annotator;
      this.stateStyling = stateStyling;
      this.typeStyling = typeStyling;
      this.formattedData = [];
      this.style = {};
      this.featureLayer = null;
      this.selectedIndex = [];
      this.bus = new Vue();
      this.initialize();
    }

    initialize() {
      this.style = this.createStyle();
      const style = {
        ...{
          stroke: true,
          uniformPolygon: true,
          strokeColor: this.stateStyling.standard && this.stateStyling.standard.color,
          strokeWidth: 1,
          fill: false,
        },
        ...this.style,
      };
      if (this.featureLayer && this.featureLayer.style) {
        this.featureLayer.style(style);
      }
    }

    abstract redraw(): void;

    changeData(frameData: FrameDataTrack[]) {
      this.formattedData = this.formatData(frameData);
      this.redraw();
    }

    abstract formatData(frameData: FrameDataTrack[]): D[];

    createStyle(): LayerStyle<D> {
      return {
        strokeColor: 'black',
        strokeWidth: 1.0,
        antialiasing: 0,
      };
    }
}
