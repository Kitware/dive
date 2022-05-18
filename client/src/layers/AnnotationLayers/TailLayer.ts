/**
 * GeoJS Track Lines
 * Based on geo.trackFeature https://opengeoscience.github.io/geojs/apidocs/geo.trackFeature.html
 * Example implementation: https://opengeoscience.github.io/geojs/tutorials/tracks/
 *
 * Track layer is a-typical because it requires extra temporal context,
 * so it cannot be based on the a-temporal BaseLayer.
 */
import BaseLayer, { LayerStyle, BaseLayerParams, MarkerStyle } from '../BaseLayer';
import { TrackId } from '../../track';
import TrackStore from '../../TrackStore';
import { FrameDataTrack } from '../LayerTypes';

interface TailData {
  trackId: TrackId;
  confidencePairs: [string, number] | null;
  selected: boolean;
  t: number; // GeoJS tail data t(time)
  x: number;
  y: number;
  interpolated: boolean;
}

export default class TailLayer extends BaseLayer<TailData[]> {
  currentFrame: number;

  before: number;

  after: number;

  markerSize: number;

  markerOpacity: number;

  /** Hold a reference to the trackStore */
  trackStore: Readonly<TrackStore>;

  constructor(params: BaseLayerParams, trackStore: Readonly<TrackStore>) {
    super(params);
    this.currentFrame = 0;
    this.before = 10;
    this.after = 5;
    this.markerSize = 10;
    this.markerOpacity = 1.0;
    this.trackStore = trackStore;
    this.initialize();
  }

  generateDataForTrack(fd: FrameDataTrack): TailData[] {
    const track = this.trackStore.get(fd.track.id);
    const tailData: TailData[] = [];
    let lastPoint: TailData | null = null;
    const start = Math.max(this.currentFrame - this.before, 0);
    const end = Math.min(this.currentFrame + this.after, track.end);
    const inputFeatures = track.features.slice(start, end);
    const firstFeature = track.getFeature(start)[0];
    const lastFeature = track.getFeature(end)[0];
    if (firstFeature) inputFeatures.splice(0, 0, firstFeature);
    if (lastFeature) inputFeatures.push(lastFeature);
    inputFeatures.forEach((feature) => {
      const { bounds, frame, interpolate } = feature;
      if (bounds) {
        const point: TailData = {
          trackId: track.trackId,
          confidencePairs: track.getType(),
          selected: fd.selected,
          t: frame,
          x: bounds[0] + (bounds[2] - bounds[0]) / 2.0,
          y: bounds[1] + (bounds[3] - bounds[1]) / 2.0,
          interpolated: !!interpolate,
        };
        if (!interpolate && lastPoint?.interpolated) {
          // Close the end of an interpolated region.
          const pointCopy = { ...point, interpolated: true };
          tailData.push(pointCopy, point);
        } else if (interpolate && !lastPoint?.interpolated) {
          // Open the beginning of an interpolated region.
          const pointCopy = { ...point, interpolated: false };
          tailData.push(pointCopy, point);
        } else {
          tailData.push(point);
        }
        lastPoint = point;
      }
    });
    /** Make sure first and last frame in range are accounted for */
    return tailData;
  }

  initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['line'],
    });
    this.featureLayer = layer.createFeature('track');
    super.initialize();
    this.featureLayer
      .markerStyle(this.createMarkerStyle())
      .futureStyle('strokeOpacity', 0.5);
  }

  changeData(frameData: FrameDataTrack[]): void {
    const data = frameData.map((d) => this.generateDataForTrack(d));
    this.featureLayer
      .data(data)
      .startTime(0)
      .endTime(this.currentFrame)
      .draw();
  }

  updateSettings(currentFrame: number, before: number, after: number) {
    this.currentFrame = currentFrame;
    this.before = before;
    this.after = after;
  }

  redraw() {
    throw new Error(`${this}.redraw Unimplemented`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  formatData(_: FrameDataTrack[]): TailData[][] {
    throw new Error(`${this}.formatData Unimplemented`);
  }

  disable() {
    this.featureLayer
      .data([])
      .draw();
  }

  createMarkerStyle(): MarkerStyle<TailData[]> {
    return {
      symbol: 16,
      symbolValue: [1, 1, 0, false],
      radius: this.markerSize,
      fillColor: (trackData: TailData[]) => {
        if (trackData[0]) {
          if (trackData[0].selected) {
            return this.stateStyling.selected.color;
          }
          if (trackData[0].confidencePairs) {
            return this.typeStyling.value.color(trackData[0].confidencePairs[0]);
          }
        }

        return this.typeStyling.value.color('');
      },
      strokeOpacity: this.markerOpacity,
      fillOpacity: 0.7,
      strokeColor: (trackData: TailData[]) => {
        if (trackData[0]) {
          if (trackData[0].selected) {
            return this.stateStyling.selected.color;
          }
          if (trackData[0].confidencePairs) {
            return this.typeStyling.value.color(trackData[0].confidencePairs[0]);
          }
        }

        return this.typeStyling.value.color('');
      },
    };
  }

  createStyle(): LayerStyle<TailData[]> {
    return {
      strokeColor: (point, _, trackData) => {
        if (trackData[0]) {
          if (trackData[0].selected) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
            // @ts-ignore
            if ((point as { interpolated: boolean }).interpolated) {
              return 'yellow';
            }
            return this.stateStyling.selected.color;
          }
          if (trackData[0].confidencePairs) {
            return this.typeStyling.value.color(trackData[0].confidencePairs[0]);
          }
        }
        return this.typeStyling.value.color('');
      },
      antialiasing: false,
      fill: false,
      strokeWidth: 3,
    };
  }
}
