import BaseLayer from '@/components/layers/BaseLayer';
import { boundToGeojson } from '@/utils';
import { StateStyles } from '@/use/useStyling';
import geo from 'geojs';
import { GeojsonGeometry } from '@/use/useFeaturePointing';
import { FrameDataTrack } from '@/components/layers/LayerTypes';


export default class AnnotationLayer extends BaseLayer {
  initialize() {
    const layer = this.annotator.geoViewer.createLayer('feature', {
      features: ['point', 'line', 'polygon'],
    });
    this.featureLayer = layer
      .createFeature('polygon', { selectionAPI: true })
      .geoOn(geo.event.feature.mouseclick, (e: any) => {
        if (e.mouse.buttonsDown.left) {
          if (!e.data.deting || (e.data.editing && !e.data.selected)) {
            this.$emit('annotationClicked', e.data.trackId, false);
          }
        } else if (e.mouse.buttonsDown.right) {
          this.$emit('annotationRightClicked', e.data.trackId, true);
        }
      });
    this.featureLayer.geoOn(
      geo.event.feature.mouseclick_order,
      this.featureLayer.mouseOverOrderClosestBorder,
    );
    this.featureLayer.geoOn(geo.event.mouseclick, (e) => {
      // If we aren't clicking on an annotation we can deselect the current track
      if (this.featureLayer.pointSearch(e.geo).found.length === 0) {
        this.$emit('annotationClicked', null, false);
      }
    });
    super.initialize();
  }

  updateBounds(trackId, bounds) {
    const polygon = boundToGeojson(bounds);
    const coords = polygon.coordinates[0];
    if (this.selectedIndex[trackId] !== undefined) {
      console.log(this.formattedData[this.selectedIndex[trackId]].geometry.outer);

      this.formattedData[this.selectedIndex[trackId]].geometry = {
        ...this.formattedData[this.selectedIndex[trackId]].geometry,
        outer: [
          { x: coords[0][0], y: coords[0][1] },
          { x: coords[1][0], y: coords[1][1] },
          { x: coords[2][0], y: coords[2][1] },
          { x: coords[3][0], y: coords[3][1] },
        ],
      };
      this.redraw();
    }
  }

  formatData(frameData: FrameDataTrack[]) {
    this.selectedIndex = [];
    const arr = super.formatData(frameData);
    frameData.forEach((track: FrameDataTrack) => {
      if (track.features && track.features.bounds) {
        const polygon = boundToGeojson(track.features.bounds);
        const coords = polygon.coordinates[0];
        const annotation = {
          trackId: track.trackId,
          selected: track.selected,
          editing: track.editing,
          confidencePairs: track.confidencePairs,
          geometry: {
            outer: [
              { x: coords[0][0], y: coords[0][1] },
              { x: coords[1][0], y: coords[1][1] },
              { x: coords[2][0], y: coords[2][1] },
              { x: coords[3][0], y: coords[3][1] },
            ],
          },
        };
        arr.push(annotation);
        // Create a sparse array of selected tracks for updating them
        if (track.selected) {
          this.selectedIndex[track.trackId] = arr.length;
        }
      }
    });
    return arr;
  }

  redraw() {
    this.featureLayer
      .data(this.formattedData)
      .polygon((d: GeojsonGeometry) => d.geometry)
      .draw();
    return null;
  }

  createStyle() {
    const baseStyle = super.createStyle();
    return {
      ...baseStyle,
      strokeColor: (a, b, data) => {
        if (data.editing) {
          if (!data.selected) {
            if (this.stateStyling.disabled && this.stateStyling.disabled.color !== 'type') {
              return this.stateStyling.disabled.color;
            }
            if (data.confidencePairs.length) {
              return this.typeColorMap(data.confidencePairs[0][0]);
            }
          }
          return this.stateStyling.selected.color;
        }
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.confidencePairs.length) {
          return this.typeColorMap(data.confidencePairs[0][0]);
        }
        return this.typeColorMap.range()[0];
      },
      strokeOpacity: (a, b, data) => {
        if (data.editing) {
          if (this.stateStyling.disabled && !data.selected) {
            return this.stateStyling.disabled.opacity;
          }
          if (this.stateStyling.selected) {
            return this.stateStyling.selected.opacity;
          }
        }

        if (data.selected) {
          return this.stateStyling.selected.opacity;
        }
        return this.stateStyling.standard.opacity;
      },
      strokeWidth: (a, b, data) => {
        if (data.editing) {
          if (!data.selected) {
            return this.stateStyling.disabled.strokeWidth;
          }
          return this.stateStyling.selected.strokeWidth;
        }

        if (data.selected) {
          return this.stateStyling.selected.strokeWidth;
        }
        return this.stateStyling.standard.strokeWidth;
      },
    };
  }
}
