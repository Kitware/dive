/*eslint class-methods-use-this: "off"*/
import Vue, { Ref } from 'vue';

import { MediaController } from '../components/annotators/mediaControllerType';
import { applyHomography, Matrix3 } from '../alignedView/homography';
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
  fontSize?: (data: D) => string | undefined;
  offset?: (data: D) => { x: number; y: number };
  rotation?: (data: D) => number;
  fill?: ObjectFunction<boolean, D> | boolean;
  radius?: PointFunction<number, D> | number;
  textAlign?: ((data: D) => string) | string;
  textScaled?: ((data: D) => number | undefined) | number | undefined;
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

  /**
   * Draw-time display transform (native image space -> aligned/reference
   * space), set while the multicam aligned view warps this camera's display.
   * Stored annotation geometry always stays native (decision D3); the layers
   * apply this only in their geojs `position` accessors, so rendered
   * geometry lands on the warped imagery. Null (the default) keeps behavior
   * byte-identical to an unwarped viewer.
   */
  private displayTransform: Matrix3 | null = null;

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

    /**
     * Set (or clear) the aligned-view display transform. Callers must
     * trigger a data refresh afterwards so geojs re-evaluates positions.
     */
    setDisplayTransform(matrix: Matrix3 | null) {
      this.displayTransform = matrix;
    }

    /** Map a native-space vertex into display space (identity when unwarped). */
    protected transformPoint(point: [number, number]): { x: number; y: number } {
      if (!this.displayTransform) {
        return { x: point[0], y: point[1] };
      }
      const [x, y] = applyHomography(this.displayTransform, point);
      return { x, y };
    }

    /** Map a native-space `{x, y}` datum into display space (identity when unwarped). */
    protected transformXY(data: { x: number; y: number }): { x: number; y: number } {
      if (!this.displayTransform) {
        return { x: data.x, y: data.y };
      }
      const [x, y] = applyHomography(this.displayTransform, [data.x, data.y]);
      return { x, y };
    }

    changeData(frameData: FrameDataTrack[], comparisons: string[] = []) {
      this.formattedData = this.formatData(frameData, comparisons);
      if (!this.annotator.geoViewerRef?.value || !this.featureLayer) {
        return;
      }
      this.redraw();
    }

    abstract formatData(frameData: FrameDataTrack[], comparisons: string[]): D[];

    createStyle(): LayerStyle<D> {
      return {
        strokeColor: 'black',
        strokeWidth: 1.0,
        antialiasing: 0,
      };
    }
}
