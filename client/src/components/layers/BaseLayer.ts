/*eslint class-methods-use-this: "off"*/
import Track, { Feature, ConfidencePair, TrackId } from '@/lib/track';
import { FrameDataTrack, CoordinateList } from '@/components/layers/LayerTypes';

import { boundToGeojson } from '@/utils';
import { StateStyles } from '@/use/useStyling';
import geo from 'geojs';


interface LayerStyle {
    strokeWidth?: (number | ((a: any, b: any, data: any) => number));
    strokeOpacity?: (number | ((a: any, b: any, data: any) => number));
    strokeColor?: (string | ((a: any, b: any, data: any) => string));
}

interface BaseLayerParams {
    frameData?: FrameDataTrack;
    annotator?: any;
    stateStyling?: StateStyles;
    typeColorMap?: (t: string) => string;
    signals?: Record<string, any>;
}

export default class BaseLayer {
    frameData?: FrameDataTrack[];

    formattedData: any;

    annotator: any;

    stateStyling: StateStyles;

    style: LayerStyle;

    typeColorMap: (t: string) => string;

    redrawSignalers: any[];

    featureLayer: any;

    signals: any;

    constructor({
      frameData,
      annotator,
      stateStyling,
      typeColorMap,
      signals = {
        annotationClicked: () => null, annotationRightClicked: () => null,
      },
    }: BaseLayerParams) {
      this.annotator = annotator;
      this.stateStyling = stateStyling;
      this.typeColorMap = typeColorMap;
      this.formattedData = null;
      this.style = {};
      this.redrawSignalers = [];
      this.featureLayer = null;
      this.signals = signals;
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
      this.featureLayer.style(style);
    }

    redraw() {
      return null;
    }

    changeData(frameData: FrameDataTrack[]) {
      this.redrawSignalers = [];
      this.frameData = frameData;
      this.formattedData = this.formatData(frameData);
      this.redraw();
    }

    formatData(frameData: FrameDataTrack[]) {
      return [];
    }

    createStyle(): LayerStyle {
      return {
        strokeColor: 'black',
        strokeOpacity: 1.0,
        strokeWidth: 1.0,
      };
    }
}
