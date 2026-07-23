/* eslint-disable class-methods-use-this */
import geo, { GeoEvent } from 'geojs';
import { Ref } from 'vue';

import { cloneDeep } from 'lodash';
import {
  boundToGeojson,
  getRotationFromAttributes,
  getRotationArrowLine,
  hasSignificantRotation,
  rectBoundsArea,
  rotateGeoJSONCoordinates,
} from '../../utils';
import {
  resolveSuppressionDisplay,
  SuppressionDisplaySettings,
} from '../../types';
import BaseLayer, { LayerStyle, BaseLayerParams } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';
import LineLayer from './LineLayer';
import {
  candidateOwnsClick,
  type DisplayPolygon,
  type RectClickCandidate,
} from './rectangleClickTarget';

interface RectGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  styleType: [string, number] | null;
  polygon: GeoJSON.Polygon;
  hasPoly: boolean;
  /**
   * Detection polygons in native coords (each entry is outer ring + holes),
   * when hasPoly.
   */
  polyCoords: GeoJSON.Position[][][];
  /** Axis-aligned bounds area; used to prefer nested boxes on envelope clicks. */
  boxArea: number;
  /** Suppression type name when attribute-flagged as suppressed (dashed/fill styling). */
  suppressed?: string;
  set?: string;
  dashed?: boolean;
  rotation?: number;
  /** Small arrow on the right-edge midpoint when rotation is significant */
  rotationArrow?: GeoJSON.LineString | null;
}

interface RectangleLayerParams extends BaseLayerParams {
  suppressionDisplay?: Ref<SuppressionDisplaySettings | undefined>;
}

export default class RectangleLayer extends BaseLayer<RectGeoJSData> {
  drawingOther: boolean; //drawing another type of annotation at the same time?

  hoverOn: boolean; //to turn over annnotations on

  /**
   * When box display is off the rectangles are kept as invisible hit targets
   * so a detection can still be right-clicked into edit mode: nothing is
   * drawn and left-clicks are ignored, but right-click still works.
   */
  clickTargetsOnly: boolean;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  arrowFeatureLayer: any;

  suppressionDisplay: Ref<SuppressionDisplaySettings | undefined>;

  constructor(params: RectangleLayerParams) {
    super(params);
    this.drawingOther = false;
    this.hoverOn = false;
    this.clickTargetsOnly = false;
    this.suppressionDisplay = params.suppressionDisplay
      || ({ value: undefined } as Ref<SuppressionDisplaySettings | undefined>);
    //Only initialize once, prevents recreating Layer each edit
    this.initialize();
  }

  private suppressionStyle() {
    return resolveSuppressionDisplay(this.suppressionDisplay.value);
  }

  private styleSuppressed(data: { suppressed?: string }) {
    return !!(data.suppressed && this.suppressionStyle().enabled);
  }

  initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['polygon', 'line'],
    });
    this.featureLayer = layer
      .createFeature('polygon', { selectionAPI: true })
      .geoOn(geo.event.feature.mouseclick, (e: GeoEvent) => {
        /**
         * While polygons are drawn, prefer the detection whose polygon (or
         * smallest box) actually owns the click so nested annotations win
         * over larger envelopes.
         */
        if (!this.clickLandsOnDetection(e)) {
          return;
        }
        if (e.mouse.buttonsDown.left) {
          if (this.clickTargetsOnly) {
            // Hidden boxes are right-click edit targets only
            return;
          }
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
    this.arrowFeatureLayer = layer.createFeature('line');
    super.initialize();
    this.arrowFeatureLayer.style({
      position: (p: [number, number]) => this.transformPoint(p),
      stroke: true,
      fill: false,
      strokeColor: (_p: [number, number], _i: number, data: RectGeoJSData) => {
        if (data.selected) return this.stateStyling.selected.color;
        if (data.styleType) return this.typeStyling.value.color(data.styleType[0]);
        return this.typeStyling.value.color('');
      },
      strokeWidth: (_p: [number, number], _i: number, data: RectGeoJSData) => {
        if (data.selected) return this.stateStyling.selected.strokeWidth;
        if (data.styleType) return this.typeStyling.value.strokeWidth(data.styleType[0]);
        return this.stateStyling.standard.strokeWidth;
      },
      strokeOpacity: (_p: [number, number], _i: number, data: RectGeoJSData) => {
        if (data.selected) return this.stateStyling.selected.opacity;
        if (data.styleType) return this.typeStyling.value.opacity(data.styleType[0]);
        return this.stateStyling.standard.opacity;
      },
      strokeOffset: 0,
    });
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

  /**
   * Keep features as invisible right-click edit targets instead of
   * drawing them (used when box display is toggled off)
   */
  setClickTargetsOnly(val: boolean) {
    this.clickTargetsOnly = val;
  }

  private toClickCandidate(data: RectGeoJSData): RectClickCandidate {
    const polygons: DisplayPolygon[] = data.polyCoords
      .filter((rings) => rings[0]?.length)
      .map((rings) => ({
        outer: rings[0].map((p) => this.transformPoint([p[0], p[1]])),
        holes: rings.slice(1).map((ring) => ring.map((p) => this.transformPoint([p[0], p[1]]))),
      }));
    return {
      trackId: data.trackId,
      hasPoly: data.hasPoly,
      polygons,
      boxArea: data.boxArea,
    };
  }

  /**
   * Whether a click on this rectangle feature really lands on its detection.
   * While polygons are drawn, prefer shape hits; otherwise the smallest box
   * under the cursor owns the click (nested envelopes beat larger ones).
   */
  private clickLandsOnDetection(e: GeoEvent): boolean {
    if (!this.drawingOther) {
      return true;
    }
    const point = { x: e.mouse.geo.x, y: e.mouse.geo.y };
    const { found } = this.featureLayer.pointSearch(e.mouse.geo);
    const candidates = (found as RectGeoJSData[])
      .filter((d): d is RectGeoJSData => !!d)
      .map((d) => this.toClickCandidate(d));
    return candidateOwnsClick(e.data.trackId, candidates, point);
  }

  formatData(frameData: FrameDataTrack[], comparisonSets: string[] = []) {
    const arr: RectGeoJSData[] = [];
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        let polygon = boundToGeojson(track.features.bounds);
        let hasPoly = false;
        let polyCoords: GeoJSON.Position[][][] = [];
        if (track.features.geometry?.features) {
          const filtered = track.features.geometry.features.filter((feature) => feature.geometry && feature.geometry.type === 'Polygon');
          hasPoly = filtered.length > 0;
          polyCoords = filtered.map(
            (feature) => (feature.geometry as GeoJSON.Polygon).coordinates,
          );
        }

        // Get rotation from attributes if it exists
        const rotation = getRotationFromAttributes(track.features.attributes);

        // Apply rotation to polygon if rotation exists
        if (hasSignificantRotation(rotation)) {
          const updatedCoords = rotateGeoJSONCoordinates(polygon.coordinates[0], rotation ?? 0);
          polygon.coordinates[0] = updatedCoords;
        }

        // Comparison-set tracks and attribute-suppressed detections both use
        // dashed outlines (odd stroke segments are made transparent below).
        const suppStyle = this.suppressionStyle();
        const dashed = !!(
          (track.suppressed && suppStyle.enabled && suppStyle.dashed)
          || (track.set && comparisonSets?.includes(track.set))
        );
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
          polyCoords,
          boxArea: rectBoundsArea(track.features.bounds),
          suppressed: track.suppressed,
          set: track.set,
          dashed,
          rotation,
          rotationArrow: getRotationArrowLine(track.features.bounds, rotation || 0),
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
    const arrowData = this.clickTargetsOnly
      ? [] : this.formattedData.filter((d) => d.rotationArrow);
    this.arrowFeatureLayer
      .data(arrowData)
      .line((d: RectGeoJSData) => d.rotationArrow!.coordinates)
      .draw();
  }

  disable() {
    if (!this.featureLayer) {
      return;
    }
    try {
      this.featureLayer
        .data([])
        .draw();
      if (this.arrowFeatureLayer) {
        this.arrowFeatureLayer
          .data([])
          .draw();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Annotation layer disable skipped after map/renderer teardown', err);
    }
  }

  createStyle(): LayerStyle<RectGeoJSData> {
    return {
      ...super.createStyle(),
      // Style conversion to get array objects to work in geoJS
      position: (point) => this.transformPoint(point),
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
        if (this.clickTargetsOnly) {
          return false;
        }
        // When the polygon is also drawn, fill belongs to the polygon.
        // If the poly exists but isn't visible, keep fill on the rectangle.
        if (this.drawingOther && data.hasPoly) {
          return false;
        }
        if (this.styleSuppressed(data)) {
          return this.suppressionStyle().fillOpacity > 0;
        }
        if (data.set) {
          return this.typeStyling.value.fill(data.set, true);
        }
        if (data.styleType) {
          return this.typeStyling.value.fill(data.styleType[0]);
        }
        return this.stateStyling.standard.fill;
      },
      fillColor: (_point, _index, data) => {
        if (this.styleSuppressed(data)) {
          const { fillColor } = this.suppressionStyle();
          if (fillColor) {
            return fillColor;
          }
        }
        if (data.set) {
          return this.typeStyling.value.annotationSetColor(data.set);
        }
        if (data.styleType) {
          return this.typeStyling.value.color(data.styleType[0]);
        }
        return this.typeStyling.value.color('');
      },
      fillOpacity: (_point, _index, data) => {
        if (this.styleSuppressed(data)) {
          return this.suppressionStyle().fillOpacity;
        }
        if (data.set) {
          return this.typeStyling.value.opacity(data.set, true);
        }
        if (data.styleType) {
          return this.typeStyling.value.opacity(data.styleType[0]);
        }
        return this.stateStyling.standard.opacity;
      },
      strokeOpacity: (_point, _index, data) => {
        // Invisible click targets draw nothing
        if (this.clickTargetsOnly) {
          return 0.0;
        }
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
        if (this.styleSuppressed(data)) {
          return this.suppressionStyle().outlineOpacity;
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
