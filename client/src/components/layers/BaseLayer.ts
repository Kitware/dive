/*eslint class-methods-use-this: "off"*/
import { Annotator } from '@/components/annotators/annotatorType';
import { FrameDataTrack } from '@/components/layers/LayerTypes';
import { StateStyles } from '@/use/useStyling';
import Vue from 'vue';

// eslint-disable-next-line max-len
export type StyleFunction<T> = T | ((point: [number, number], index: number, data: any) => T | undefined);

interface LayerStyle {
  strokeWidth?: StyleFunction<number>;
  strokeOpacity?: StyleFunction<number>;
  strokeColor?: StyleFunction<string>;
  [x: string]: unknown;
}

export interface BaseLayerParams {
    frameData?: FrameDataTrack;
    annotator: Annotator;
    stateStyling: StateStyles;
    typeColorMap: d3.ScaleOrdinal<string, string>;
    [x: string]: unknown;
}

export default abstract class BaseLayer extends Vue {
    formattedData: unknown;

    annotator: Annotator;

    stateStyling: StateStyles;

    style: LayerStyle;

    typeColorMap: d3.ScaleOrdinal<string, string>;

    featureLayer: any;

    selectedIndex: number[]; // sparse array


    constructor({
      annotator,
      stateStyling,
      typeColorMap,
    }: BaseLayerParams) {
      super();
      this.annotator = annotator;
      this.stateStyling = stateStyling;
      this.typeColorMap = typeColorMap;
      this.formattedData = null;
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

    abstract formatData(frameData: FrameDataTrack[]): unknown;

    createStyle(): LayerStyle {
      return {
        strokeColor: 'black',
        strokeOpacity: 1.0,
        strokeWidth: 1.0,
      };
    }
}
