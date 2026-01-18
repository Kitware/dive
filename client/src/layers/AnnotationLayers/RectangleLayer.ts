/* eslint-disable class-methods-use-this */
import geo, { GeoEvent } from 'geojs';

import { cloneDeep } from 'lodash';
import {
  boundToGeojson,
  applyRotationToPolygon,
  getRotationFromAttributes,
  hasSignificantRotation,
} from '../../utils';
import BaseLayer, { LayerStyle, BaseLayerParams } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';
import LineLayer from './LineLayer';

interface RectGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  styleType: [string, number] | null;
  polygon: GeoJSON.Polygon;
  hasPoly: boolean;
  set?: string;
  dashed?: boolean;
  rotation?: number;
}

export default class RectangleLayer extends BaseLayer<RectGeoJSData> {
  drawingOther: boolean; //drawing another type of annotation at the same time?

  hoverOn: boolean; //to turn over annnotations on

  constructor(params: BaseLayerParams) {
    super(params);
    this.drawingOther = false;
    this.hoverOn = false;
    //Only initialize once, prevents recreating Layer each edit
    this.initialize();
  }

  initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['polygon'],
    });
    this.featureLayer = layer
      .createFeature('polygon', { selectionAPI: true })
      .geoOn(geo.event.feature.mouseclick, (e: GeoEvent) => {
        /**
         * Handle clicking on individual annotations, if DrawingOther is true we use the
         * Rectangle type if only the polygon is visible we use the polygon bounds
         * */
        if (e.mouse.buttonsDown.left) {
          if (!e.data.editing || (e.data.editing && !e.data.selected)) {
            if (e.mouse.modifiers.ctrl) {
              this.bus.$emit('annotation-ctrl-clicked', e.data.trackId, false, { ctrl: true });
            } else {
              this.bus.$emit('annotation-clicked', e.data.trackId, false);
            }
          }
        } else if (e.mouse.buttonsDown.right) {
          if (!e.data.editing || (e.data.editing && !e.data.selected)) {
            this.bus.$emit('annotation-right-clicked', e.data.trackId, true);
          }
        }
      });
    this.featureLayer.geoOn(
      geo.event.feature.mouseclick_order,
      this.featureLayer.mouseOverOrderClosestBorder,
    );
    this.featureLayer.geoOn(geo.event.mouseclick, (e: GeoEvent) => {
      // If we aren't clicking on an annotation we can deselect the current track
      if (this.featureLayer.pointSearch(e.geo).found.length === 0) {
        this.bus.$emit('annotation-clicked', null, false);
      }
    });
    super.initialize();
  }

  hoverAnnotations(e: GeoEvent) {
    const { found } = this.featureLayer.pointSearch(e.mouse.geo);
    this.bus.$emit('annotation-hover', found, e.mouse.geo);
  }

  setHoverAnnotations(val: boolean) {
    if (!this.hoverOn && val) {
      this.featureLayer.geoOn(
        geo.event.feature.mouseover,
        (e: GeoEvent) => this.hoverAnnotations(e),
      );
      this.featureLayer.geoOn(
        geo.event.feature.mouseoff,
        (e: GeoEvent) => this.hoverAnnotations(e),
      );
      this.hoverOn = true;
    } else if (this.hoverOn && !val) {
      this.featureLayer.geoOff(geo.event.feature.mouseover);
      this.featureLayer.geoOff(geo.event.feature.mouseoff);
      this.hoverOn = false;
    }
  }

  /**
   * Used to set the drawingOther parameter used to change styling if other types are drawn
   * and also handle selection clicking between different types
   * @param val - determines if we are drawing other types of annotations
   */
  setDrawingOther(val: boolean) {
    this.drawingOther = val;
  }

  formatData(frameData: FrameDataTrack[], comparisonSets: string[] = []) {
    const arr: RectGeoJSData[] = [];
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        let polygon = boundToGeojson(track.features.bounds);
        let hasPoly = false;
        if (track.features.geometry?.features) {
          const filtered = track.features.geometry.features.filter((feature) => feature.geometry && feature.geometry.type === 'Polygon');
          hasPoly = filtered.length > 0;
        }

        // Get rotation from attributes if it exists
        const rotation = getRotationFromAttributes(track.features.attributes);

        // Apply rotation to polygon if rotation exists
        if (hasSignificantRotation(rotation)) {
          polygon = applyRotationToPolygon(polygon, track.features.bounds, rotation!);
        }

        const dashed = !!(track.set && comparisonSets?.includes(track.set));
        if (dashed) {
          const temp = cloneDeep(polygon);
          const width = track.features.bounds[2] - track.features.bounds[0];
          const height = track.features.bounds[3] - track.features.bounds[1];
          const dashSize = Math.min(width, height) / 20.0;
          temp.coordinates[0] = LineLayer.dashLine(temp.coordinates[0], dashSize);
          polygon = temp;
        }

        const annotation: RectGeoJSData = {
          trackId: track.track.id,
          selected: track.selected,
          editing: track.editing,
          styleType: track.styleType,
          polygon,
          hasPoly,
          set: track.set,
          dashed,
          rotation,
        };
        arr.push(annotation);
      }
    });
    return arr;
  }

  redraw() {
    this.featureLayer
      .data(this.formattedData)
      .polygon((d: RectGeoJSData) => d.polygon.coordinates[0])
      .draw();
  }

  disable() {
    this.featureLayer
      .data([])
      .draw();
  }

  createStyle(): LayerStyle<RectGeoJSData> {
    return {
      ...super.createStyle(),
      // Style conversion to get array objects to work in geoJS
      position: (point) => ({ x: point[0], y: point[1] }),
      strokeColor: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.styleType) {
          return this.typeStyling.value.color(data.styleType[0]);
        }
        return this.typeStyling.value.color('');
      },
      fill: (data) => {
        if (data.set) {
          return this.typeStyling.value.fill(data.set, true);
        }
        if (data.styleType) {
          return this.typeStyling.value.fill(data.styleType[0]);
        }
        return this.stateStyling.standard.fill;
      },
      fillColor: (_point, _index, data) => {
        if (data.set) {
          return this.typeStyling.value.annotationSetColor(data.set);
        }
        if (data.styleType) {
          return this.typeStyling.value.color(data.styleType[0]);
        }
        return this.typeStyling.value.color('');
      },
      fillOpacity: (_point, _index, data) => {
        if (data.set) {
          return this.typeStyling.value.opacity(data.set, true);
        }
        if (data.styleType) {
          return this.typeStyling.value.opacity(data.styleType[0]);
        }
        return this.stateStyling.standard.opacity;
      },
      strokeOpacity: (_point, _index, data) => {
        // Reduce the rectangle opacity if a polygon is also drawn
        if (_index % 2 === 1 && data.dashed) {
          return 0.0;
        }

        if (this.drawingOther && data.hasPoly) {
          return this.stateStyling.disabled.opacity;
        }
        if (data.selected) {
          return this.stateStyling.selected.opacity;
        }
        if (data.styleType) {
          return this.typeStyling.value.opacity(data.styleType[0]);
        }

        return this.stateStyling.standard.opacity;
      },
      strokeOffset: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        if (data.styleType) {
          return this.typeStyling.value.strokeWidth(data.styleType[0]);
        }
        return this.stateStyling.standard.strokeWidth;
      },
      strokeWidth: (_point, _index, data) => {
        //Reduce rectangle line thickness if polygon is also drawn
        if (this.drawingOther && data.hasPoly) {
          return this.stateStyling.disabled.strokeWidth;
        }
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        if (data.styleType) {
          return this.typeStyling.value.strokeWidth(data.styleType[0]);
        }
        return this.stateStyling.standard.strokeWidth;
      },
    };
  }
}
