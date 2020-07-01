/*eslint class-methods-use-this: "off"*/
import { Annotator } from '@/components/annotators/annotatorType';
import { FrameDataTrack } from '@/components/layers/LayerTypes';
import { StateStyles, TypeStyling } from '@/use/useStyling';
import Vue from 'vue';
import { Ref } from '@vue/composition-api';

// eslint-disable-next-line max-len
export type StyleFunction<T, D> = T | ((point: [number, number], index: number, data: D) => T | undefined);
export type ObjectFunction<T, D> = T | ((data: D, index: number) => T | undefined);

export interface LayerStyle<D> {
  strokeWidth?: StyleFunction<number, D>;
  strokeOffset?: StyleFunction<number, D>;
  strokeOpacity?: StyleFunction<number, D>;
  strokeColor?: StyleFunction<string, D>;
  position?: (point: [number, number]) => { x: number; y: number };
  fillColor?: StyleFunction<string, D>;
  fillOpacity?: StyleFunction<number, D>;
  color?: (data: D) => string;
  offset?: (data: D) => { x: number; y: number };
  fill?: ObjectFunction<boolean, D> | boolean;
  radius?: number;
  [x: string]: unknown;
}

export interface BaseLayerParams {
    frameData?: FrameDataTrack;
    annotator: Annotator;
    stateStyling: StateStyles;
    typeStyling: Ref<TypeStyling>;
}

export default abstract class BaseLayer<D> extends Vue {
    formattedData: D[];

    annotator: Annotator;

    stateStyling: StateStyles;

    style: LayerStyle<D>;

    typeStyling: Ref<TypeStyling>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    featureLayer: any;

    selectedIndex: number[]; // sparse array


    constructor({
      annotator,
      stateStyling,
      typeStyling,
    }: BaseLayerParams) {
      super();
      this.annotator = annotator;
      this.stateStyling = stateStyling;
      this.typeStyling = typeStyling;
      this.formattedData = [];
      this.style = {};
      this.featureLayer = null;
      this.selectedIndex = [];
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
        strokeOpacity: 1.0,
        strokeWidth: 1.0,
      };
    }
}
