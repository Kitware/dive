/* eslint-disable class-methods-use-this */
import { FrameDataTrack } from 'vue-media-annotator/layers/LayerTypes';
import BaseLayer, { LayerStyle, BaseLayerParams } from 'vue-media-annotator/layers/BaseLayer';
import { boundToGeojson } from 'vue-media-annotator/utils';
import geo, { GeoEvent } from 'geojs';

interface RectGeoJSData{
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  confidencePairs: [string, number] | null;
  polygon: GeoJSON.Polygon;
  hasPoly: boolean; //visual difference if the annotation has both bounds and polygon
}

interface AnnotationLayerParams {
  type: 'rectangle' | 'polygon';
}

export default class AnnotationLayer extends BaseLayer<RectGeoJSData> {
  type: 'rectangle' | 'polygon';

  drawingOther: boolean; //drawing another type of annotation at the same time?

  constructor(params: BaseLayerParams & AnnotationLayerParams) {
    super(params);
    this.type = params.type;
    this.drawingOther = false;
    if (!this.type) {
      this.type = 'rectangle';
    }
    //Only initialize once, prevents recreating Layer each edit
    this.initialize();
  }

  initialize() {
    const layer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point', 'line', 'polygon'],
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
            if (this.type !== 'polygon' || (this.type === 'polygon' && !this.drawingOther)) {
              this.$emit('annotation-clicked', e.data.trackId, false);
            }
          }
        } else if (e.mouse.buttonsDown.right) {
          if (!e.data.editing || (e.data.editing && !e.data.selected)) {
            if (this.type !== 'polygon' || (this.type === 'polygon' && !this.drawingOther)) {
              this.$emit('annotation-right-clicked', e.data.trackId, true);
            }
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
        if (this.type !== 'polygon' || (this.type === 'polygon' && !this.drawingOther)) {
          this.$emit('annotation-clicked', null, false);
        }
      }
    });
    super.initialize();
  }

  /**
   * Used to set the drawingOther parameter used to change styling if other types are drawn
   * and also handle selection clicking between different types
   * @param val - determines if we are drawing other types of annotations
   */
  setDrawingOther(val: boolean) {
    this.drawingOther = val;
  }

  formatData(frameData: FrameDataTrack[]) {
    const arr: RectGeoJSData[] = [];
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        let polygon = boundToGeojson(track.features.bounds);
        let hasPoly = false;
        if (track.features.polygon) {
          hasPoly = true;
          if (this.type === 'polygon') {
            polygon = track.features.polygon;
          }
        }
        //exit if in poly mode with no polygon available
        if (!hasPoly && this.type === 'polygon') {
          return;
        }
        const annotation: RectGeoJSData = {
          trackId: track.trackId,
          selected: track.selected,
          editing: track.editing,
          confidencePairs: track.confidencePairs,
          polygon,
          hasPoly,
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
        // Reduce the rectangle opacity if a polygon is also drawn
        if (this.drawingOther && data.hasPoly && this.type !== 'polygon') {
          return this.stateStyling.disabled.opacity;
        }
        if (data.selected) {
          return this.stateStyling.selected.opacity;
        }
        if (data.confidencePairs) {
          return this.typeStyling.value.opacity(data.confidencePairs[0]);
        }

        return this.stateStyling.standard.opacity;
      },
      strokeOffset: (_point, _index, data) => {
        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        if (data.confidencePairs) {
          return this.typeStyling.value.strokeWidth(data.confidencePairs[0]);
        }
        return this.stateStyling.standard.strokeWidth;
      },
      strokeWidth: (_point, _index, data) => {
        //Reduce rectangle line thickness if polygon is also drawn
        if (this.drawingOther && data.hasPoly && this.type !== 'polygon') {
          return this.stateStyling.disabled.strokeWidth;
        }
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
