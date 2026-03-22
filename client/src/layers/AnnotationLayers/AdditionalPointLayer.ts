/* eslint-disable class-methods-use-this */
import geo, { GeoEvent } from 'geojs';
import BaseLayer, { LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';

interface AdditionalPointData {
  trackId: number;
  selected: boolean;
  editing: boolean | string;
  styleType: [string, number] | null;
  key: string;
  label: string;
  x: number;
  y: number;
  /** True when this is the named point being edited on the selected track. */
  keySelected: boolean;
}

export default class AdditionalPointLayer extends BaseLayer<AdditionalPointData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textFeatureLayer: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textLayer: any;

  private additionalPointEditActive = false;

  private additionalPointEditTrackId: number | null = null;

  private additionalPointEditKey = '';

  /**
   * Highlight the point that matches the current additional-points edit selection.
   */
  setAdditionalPointEditContext(active: boolean, trackId: number | null, key: string) {
    this.additionalPointEditActive = active;
    this.additionalPointEditTrackId = trackId;
    this.additionalPointEditKey = key || '';
  }

  initialize() {
    this.tryInitialize();
    super.initialize();
  }

  tryInitialize(): boolean {
    if (this.featureLayer && this.textFeatureLayer) {
      return true;
    }
    try {
      const pointLayer = this.annotator.geoViewerRef.value.createLayer('feature', {
        features: ['point'],
      });
      this.featureLayer = pointLayer
        .createFeature('point', { selectionAPI: true })
        .geoOn(geo.event.feature.mouseclick, (e: GeoEvent) => {
          if (e.mouse.buttonsDown.right) {
            this.bus.$emit('annotation-right-clicked', e.data.trackId, e.data.key);
          }
        });

      this.textLayer = this.annotator.geoViewerRef.value.createLayer('feature', {
        features: ['text'],
      });
      this.textFeatureLayer = this.textLayer
        .createFeature('text')
        .text((data: AdditionalPointData) => data.label)
        .position((data: AdditionalPointData) => ({ x: data.x, y: data.y }));
      this.textFeatureLayer.style({
        color: (data: AdditionalPointData) => {
          if (data.selected) {
            return this.stateStyling.selected.color;
          }
          if (data.styleType) {
            return this.typeStyling.value.color(data.styleType[0]);
          }
          return this.typeStyling.value.color('');
        },
        offset: () => ({ x: 10, y: -10 }),
        fontSize: '12px',
      });
      return true;
    } catch {
      // Some playback paths initialize layers before the GeoJS canvas is ready.
      this.featureLayer = null;
      this.textLayer = null;
      this.textFeatureLayer = null;
      return false;
    }
  }

  formatData(frameDataTracks: FrameDataTrack[]): AdditionalPointData[] {
    const arr: AdditionalPointData[] = [];
    frameDataTracks.forEach((frameData: FrameDataTrack) => {
      const additionalPoints = frameData.features?.additionalPoints;
      if (!additionalPoints) {
        return;
      }
      Object.entries(additionalPoints).forEach(([label, points]) => {
        points.forEach((point) => {
          const keySelected = !!(
            this.additionalPointEditActive
            && this.additionalPointEditTrackId === frameData.track.id
            && label === this.additionalPointEditKey
          );
          arr.push({
            trackId: frameData.track.id,
            selected: frameData.selected,
            editing: frameData.editing,
            styleType: frameData.styleType,
            key: label,
            label: point.label || label,
            x: point.coordinates[0],
            y: point.coordinates[1],
            keySelected,
          });
        });
      });
    });
    return arr;
  }

  createStyle(): LayerStyle<AdditionalPointData> {
    return {
      ...super.createStyle(),
      fill: true,
      fillColor: (data: AdditionalPointData) => {
        if (data.selected) {
          return this.stateStyling.selected.color;
        }
        if (data.styleType) {
          return this.typeStyling.value.color(data.styleType[0]);
        }
        return this.typeStyling.value.color('');
      },
      fillOpacity: 0.9,
      radius: (data: AdditionalPointData) => {
        if (data.keySelected) {
          return data.selected ? 11 : 9;
        }
        return data.selected ? 8 : 6;
      },
      strokeWidth: (data: AdditionalPointData) => (data.keySelected ? 4 : 2),
      strokeColor: (data: AdditionalPointData) => (data.keySelected ? '#ffeb3b' : '#ffffff'),
    };
  }

  redraw(): null {
    if (!this.tryInitialize()) {
      return null;
    }
    this.featureLayer.data(this.formattedData).draw();
    this.textFeatureLayer.data(this.formattedData).draw();
    return null;
  }

  disable() {
    if (!this.tryInitialize()) {
      return;
    }
    this.featureLayer.data([]).draw();
    this.textFeatureLayer.data([]).draw();
  }
}
