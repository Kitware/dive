/* eslint-disable class-methods-use-this */
import { RectBounds, boundToGeojson } from '../../utils';
import BaseLayer, { LayerStyle, BaseLayerParams } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

interface OverlapJSData{
  type: string;
  polygon: GeoJSON.Polygon;
  set?: string;
}

interface ComparingBounds {
    bounds: RectBounds;
    type: string;
    set?: string;
}

function createOverlappingComparingBounds(comparingBounds: ComparingBounds[]): ComparingBounds[] {
  const overlappingBounds: ComparingBounds[] = [];

  for (let i = 0; i < comparingBounds.length; i += 1) {
    for (let j = i + 1; j < comparingBounds.length; j += 1) {
      if (comparingBounds[i].type !== comparingBounds[j].type
        || comparingBounds[i].set === comparingBounds[j].set) {
        // eslint-disable-next-line no-continue
        continue;
      }
      const box1 = comparingBounds[i].bounds;
      const box2 = comparingBounds[j].bounds;

      const x1 = Math.max(box1[0], box2[0]);
      const y1 = Math.max(box1[1], box2[1]);
      const x2 = Math.min(box1[2], box2[2]);
      const y2 = Math.min(box1[3], box2[3]);

      if (x1 < x2 && y1 < y2) {
        overlappingBounds.push({
          bounds: [x1, y1, x2, y2],
          type: comparingBounds[i].type,
          set: comparingBounds[i].set,
        });
      }
    }
  }

  return overlappingBounds;
}


export default class OverlapLayer extends BaseLayer<OverlapJSData> {
    hoverOn: boolean; //to turn over annnotations on

    constructor(params: BaseLayerParams) {
      super(params);
      this.hoverOn = false;
      //Only initialize once, prevents recreating Layer each edit
      this.initialize();
    }

    initialize() {
      const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
        features: ['polygon'],
      });
      this.featureLayer = layer
        .createFeature('polygon', { selectionAPI: true });
      super.initialize();
    }

    formatData(frameData: FrameDataTrack[]) {
      const arr: OverlapJSData[] = [];
      // For each track Type we need to calcualte the overlap area between areas;
      const comparingBounds: ComparingBounds[] = [];
      for (let i = 0; i < frameData.length; i += 1) {
        const track = frameData[i];
        if (track.features && track.features.bounds) {
          comparingBounds.push({
            bounds: track.features.bounds,
            type: track.styleType[0],
            set: track.set,
          });
        }
      }
      const merged = createOverlappingComparingBounds(comparingBounds);
      merged.forEach((merge) => {
        const polygon = boundToGeojson(merge.bounds);

        const annotation: OverlapJSData = {
          polygon,
          type: merge.type,
        };
        arr.push(annotation);
      });
      return arr;
    }

    redraw() {
      this.featureLayer
        .data(this.formattedData)
        .polygon((d: OverlapJSData) => d.polygon.coordinates[0])
        .draw();
    }

    disable() {
      this.featureLayer
        .data([])
        .draw();
    }

    createStyle(): LayerStyle<OverlapJSData> {
      return {
        ...super.createStyle(),
        // Style conversion to get array objects to work in geoJS
        position: (point) => ({ x: point[0], y: point[1] }),
        strokeColor: (_point, _index, data) => {
          if (data.type) {
            return this.typeStyling.value.color(data.type);
          }
          return this.typeStyling.value.color('');
        },
        fill: (data) => {
          return true;
          if (data.type) {
            return this.typeStyling.value.fill(data.type);
          }
          return this.stateStyling.standard.fill;
        },
        fillColor: (_point, _index, data) => {
          if (data.type) {
            return this.typeStyling.value.color(data.type);
          }
          return this.typeStyling.value.color('');
        },
        fillOpacity: (_point, _index, data) => {
          return 0.25;
          if (data.type) {
            return this.typeStyling.value.opacity(data.type);
          }
          return this.stateStyling.standard.opacity;
        },
        strokeOpacity: (_point, _index, data) => {
        // Reduce the rectangle opacity if a polygon is also drawn
          if (data.type) {
            return this.typeStyling.value.opacity(data.type);
          }

          return this.stateStyling.standard.opacity;
        },
        strokeWidth: (_point, _index, data) => {
        //Reduce rectangle line thickness if polygon is also drawn

          if (data.type) {
            return this.typeStyling.value.strokeWidth(data.type);
          }
          return this.stateStyling.standard.strokeWidth;
        },
      };
    }
}
