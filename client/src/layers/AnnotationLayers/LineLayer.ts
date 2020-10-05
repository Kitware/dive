/* eslint-disable class-methods-use-this */
import { cloneDeep } from 'lodash';

import BaseLayer, { LayerStyle, BaseLayerParams } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

interface LineGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  confidencePairs: [string, number] | null;
  line: GeoJSON.LineString;
  dashed?: boolean;
}


export default class LineLayer extends BaseLayer<LineGeoJSData> {
  constructor(params: BaseLayerParams) {
    super(params);
    //Only initialize once, prevents recreating Layer each edit
    this.initialize();
  }

  initialize() {
    const layer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point', 'line'],
    });
    this.featureLayer = layer
      .createFeature('line', { selectionAPI: true });
    super.initialize();
  }

  /**
   * Creates a linear line of points that can be used to create a dashed line segment
   * @param {number} start - start point of the line segment
   * @param {number} end -end point of the line segment
   * @param {int} dashLength=5 - the length of the dashes that are displayed
   */
  static dashSegment(start: GeoJSON.Position, end: GeoJSON.Position, dashLength = 5) {
    const distance = Math.sqrt((start[0] - end[0]) ** 2 + (start[1] - end[1]) ** 2);
    const linearSubdivide = Math.round(distance / dashLength);

    const coordinates = [];
    for (let i = 0; i < linearSubdivide; i += 1) {
      const x = start[0] + ((end[0] - start[0]) / linearSubdivide) * i;
      const y = start[1] + ((end[1] - start[1]) / linearSubdivide) * i;
      coordinates.push([x, y]);
    }
    coordinates.push(end);
    return coordinates;
  }

  static dashLine(coordinates: GeoJSON.Position[], dashLength = 5) {
    //Iterate over and dash each segement
    let dashed: GeoJSON.Position[] = [];
    for (let i = 0; i + 1 < coordinates.length; i += 1) {
      const segment = LineLayer.dashSegment(coordinates[i], coordinates[i + 1], dashLength);
      dashed = dashed.concat(segment);
    }
    return dashed;
  }

  formatData(frameData: FrameDataTrack[]) {
    const arr: LineGeoJSData[] = [];
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        if (track.features.geometry?.features?.[0]) {
          track.features.geometry.features.forEach((feature) => {
            if (feature.geometry && feature.geometry.type === 'LineString') {
              const line = cloneDeep(feature.geometry);
              // line.coordinates = LineLayer.dashLine(line.coordinates);
              const annotation: LineGeoJSData = {
                trackId: track.trackId,
                selected: track.selected,
                editing: track.editing,
                confidencePairs: track.confidencePairs,
                line,
                dashed: true,
              };
              arr.push(annotation);
            }
          });
        }
      }
    });
    return arr;
  }

  redraw() {
    this.featureLayer
      .data(this.formattedData)
      .line((d: LineGeoJSData) => d.line.coordinates)
      .draw();
  }

  disable() {
    this.featureLayer
      .data([])
      .draw();
  }

  createStyle(): LayerStyle<LineGeoJSData> {
    return {
      ...super.createStyle(),
      // Style conversion to get array objects to work in geoJS
      position: (point) => ({ x: point[0], y: point[1] }),
      strokeColor: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.confidencePairs) {
          return this.typeStyling.value.color(data.confidencePairs[0]);
        }
        return this.typeStyling.value.color('');
      },
      fill: (data) => {
        if (data.confidencePairs) {
          return this.typeStyling.value.fill(data.confidencePairs[0]);
        }
        return this.stateStyling.standard.fill;
      },
      fillColor: (_point, _index, data) => {
        if (data.confidencePairs) {
          return this.typeStyling.value.color(data.confidencePairs[0]);
        }
        return this.typeStyling.value.color('');
      },
      fillOpacity: (_point, _index, data) => {
        if (data.confidencePairs) {
          return this.typeStyling.value.opacity(data.confidencePairs[0]);
        }
        return this.stateStyling.standard.opacity;
      },
      strokeOpacity: (_point, _index, data) => {
        // if (_index % 2 === 1 && data.dashed) {
        //   return 0.0;
        // }
        if (data.selected) {
          return this.stateStyling.selected.opacity;
        }
        if (data.confidencePairs) {
          return this.typeStyling.value.opacity(data.confidencePairs[0]);
        }

        return this.stateStyling.standard.opacity;
      },
      strokeOffset: 0,
      strokeWidth: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        if (data.confidencePairs) {
          return this.typeStyling.value.strokeWidth(data.confidencePairs[0]);
        }
        return this.stateStyling.standard.strokeWidth;
      },
    };
  }
}
