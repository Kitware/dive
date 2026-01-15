import { MediaController } from '../../components/annotators/mediaControllerType';

interface SegmentationPointData {
  x: number;
  y: number;
  label: number; // 1=foreground, 0=background
}

/**
 * Layer for displaying segmentation prompt points (green=foreground, red=background)
 * This is a simple layer that doesn't follow the BaseLayer pattern since it's
 * not tied to track data - it's UI feedback during the segmentation process.
 */
export default class SegmentationPointsLayer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private featureLayer: any;

  private annotator: MediaController;

  private points: SegmentationPointData[] = [];

  constructor(annotator: MediaController) {
    this.annotator = annotator;
    this.initialize();
  }

  private initialize() {
    const layer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['point'],
    });
    this.featureLayer = layer.createFeature('point');
    this.featureLayer.style({
      radius: 8,
      strokeWidth: 2,
      strokeColor: (data: SegmentationPointData) => (data.label === 1 ? '#00FF00' : '#FF0000'),
      fillColor: (data: SegmentationPointData) => (data.label === 1 ? '#00FF00' : '#FF0000'),
      fillOpacity: 0.6,
      strokeOpacity: 1,
    });
    this.featureLayer.position((data: SegmentationPointData) => ({
      x: data.x,
      y: data.y,
    }));
  }

  /**
   * Update the displayed points
   * @param points - Array of [x, y] coordinates
   * @param labels - Array of labels (1=foreground, 0=background)
   */
  updatePoints(points: [number, number][], labels: number[]) {
    this.points = points.map((p, i) => ({
      x: p[0],
      y: p[1],
      label: labels[i] ?? 1,
    }));
    this.redraw();
  }

  /**
   * Clear all displayed points
   */
  clear() {
    this.points = [];
    this.redraw();
  }

  private redraw() {
    this.featureLayer.data(this.points).draw();
  }

  disable() {
    this.points = [];
    this.featureLayer.data([]).draw();
  }
}
