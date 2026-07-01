import geo, { GeoEvent } from 'geojs';
import BaseLayer, { BaseLayerParams, LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';
import CameraCalibrationStore from '../../CameraCalibrationStore';
import { applyHomography } from '../../homography';

export interface CalibrationPointData {
  x: number;
  y: number;
  label: string;
  pending: boolean;
}

export interface CameraImage {
  image: HTMLImageElement;
  width: number;
  height: number;
}

interface CalibrationLayerParams {
  calibration: CameraCalibrationStore;
  /** Resolve another camera's currently displayed frame image (for the overlay). */
  getCameraImage?: (camera: string) => CameraImage | null;
}

/**
 * Renders this camera's picked calibration points (numbered markers, the pending
 * "blue" point highlighted) and, when alignment mode is active, a ghost overlay
 * of the other camera's frame warped through the fitted homography (geojs
 * quadFeature). One instance is created per camera in LayerManager.
 */
export default class CalibrationKeypointLayer extends BaseLayer<CalibrationPointData> {
  calibration: CameraCalibrationStore;

  getCameraImage?: (camera: string) => CameraImage | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textFeature: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quadFeature: any;

  constructor(params: BaseLayerParams & CalibrationLayerParams) {
    super(params);
    this.calibration = params.calibration;
    this.getCameraImage = params.getCameraImage;
    // Listen on the map, which is what emits geo.event.mouseclick. The event
    // exposes button state and image (gcs) coordinates at the top level.
    this.annotator.geoViewerRef.value.geoOn(
      geo.event.mouseclick,
      (e: GeoEvent) => this.handleClick(e),
    );
    this.update();
  }

  initialize() {
    const geoViewer = this.annotator.geoViewerRef.value;
    // quad, point, and text features require different geojs renderers, so each
    // must live in its own feature layer. Create the quad first so the overlay
    // image renders beneath the picked points and labels.
    const quadLayer = geoViewer.createLayer('feature', {
      features: ['quad'],
      autoshareRenderer: false,
      renderer: 'canvas',
    });
    this.quadFeature = quadLayer.createFeature('quad');

    const pointLayer = geoViewer.createLayer('feature', { features: ['point'] });
    this.featureLayer = pointLayer.createFeature('point');

    const textLayer = geoViewer.createLayer('feature', { features: ['text'] });
    this.textFeature = textLayer
      .createFeature('text')
      .text((data: CalibrationPointData) => data.label)
      .position((data: CalibrationPointData) => ({ x: data.x, y: data.y }))
      .style({
        color: 'white',
        fontSize: '14px',
        textAlign: 'center',
        textBaseline: 'bottom',
        offset: { x: 0, y: -10 },
      });
    super.initialize();
  }

  /** Map-level click handler: records a point when picking is active for this camera. */
  handleClick(e: GeoEvent) {
    if (!this.calibration || !this.calibration.pickingEnabled.value) {
      return;
    }
    // Map-level mouseclick exposes buttonsDown at the top level; feature-level
    // events nest it under `mouse`. Respond to left clicks only.
    const buttonsDown = e.buttonsDown || (e.mouse && e.mouse.buttonsDown);
    if (buttonsDown && !buttonsDown.left) {
      return;
    }
    const pair = this.calibration.activePair.value;
    const cam = this.annotator.cameraName.value;
    if (!pair || (cam !== pair.camA && cam !== pair.camB)) {
      return;
    }
    if (!e.geo) {
      return;
    }
    // e.geo is already in image (gcs) coordinates.
    this.calibration.pickPoint(cam, [e.geo.x, e.geo.y]);
  }

  // eslint-disable-next-line class-methods-use-this, @typescript-eslint/no-unused-vars
  formatData(_frameData: FrameDataTrack[]): CalibrationPointData[] {
    const result: CalibrationPointData[] = [];
    if (!this.calibration) {
      return result;
    }
    const pair = this.calibration.activePair.value;
    const cam = this.annotator.cameraName.value;
    if (!pair || (cam !== pair.camA && cam !== pair.camB)) {
      return result;
    }
    const key = this.calibration.pairKey(pair.camA, pair.camB);
    const list = this.calibration.correspondences.value[key] || [];
    list.forEach((c, i) => {
      const coord = cam === pair.camA ? c.a : c.b;
      result.push({
        x: coord[0], y: coord[1], label: `${i + 1}`, pending: false,
      });
    });
    const pending = this.calibration.pendingPoint.value;
    if (pending && pending.camera === cam) {
      result.push({
        x: pending.coord[0],
        y: pending.coord[1],
        label: `${list.length + 1}`,
        pending: true,
      });
    }
    return result;
  }

  /**
   * Render (or clear) the aligned ghost quad. The ghost is drawn in the
   * destination camera's pane: the source camera's image is warped through the
   * fitted homography for the selected alignment mode. Uses the same
   * `homog[mode]` matrix that {@link CameraCalibrationStore.pickPoint} inverts to
   * attribute a ghost-pane click back to the source camera, so rendering and
   * click attribution stay direction-consistent.
   */
  updateGhost() {
    if (!this.quadFeature) {
      return;
    }
    const clear = () => this.quadFeature.data([]).draw();
    const alignment = this.calibration?.alignment.value;
    const pair = this.calibration?.activePair.value;
    if (!alignment || alignment.mode === 'original' || !pair || !this.getCameraImage) {
      clear();
      return;
    }
    const key = this.calibration.pairKey(pair.camA, pair.camB);
    const homog = this.calibration.homographies.value[key];
    if (!homog) {
      clear();
      return;
    }
    const { mode } = alignment;
    const srcCam = mode === 'BtoA' ? pair.camB : pair.camA;
    const dstCam = mode === 'BtoA' ? pair.camA : pair.camB;
    if (this.annotator.cameraName.value !== dstCam) {
      clear();
      return;
    }
    const src = this.getCameraImage(srcCam);
    if (!src || !src.width || !src.height) {
      clear();
      return;
    }
    const h = homog[mode];
    const { width: w, height: hgt } = src;
    const ul = applyHomography(h, [0, 0]);
    const ur = applyHomography(h, [w, 0]);
    const lr = applyHomography(h, [w, hgt]);
    const ll = applyHomography(h, [0, hgt]);
    this.quadFeature
      .data([{
        ul: { x: ul[0], y: ul[1] },
        ur: { x: ur[0], y: ur[1] },
        lr: { x: lr[0], y: lr[1] },
        ll: { x: ll[0], y: ll[1] },
        image: src.image,
      }])
      .style('opacity', alignment.opacity)
      .draw();
  }

  /** Recompute points and the ghost overlay from the store and redraw. */
  update() {
    this.formattedData = this.formatData([]);
    this.redraw();
    this.updateGhost();
  }

  redraw(): null {
    this.featureLayer.data(this.formattedData).draw();
    this.textFeature.data(this.formattedData).draw();
    return null;
  }

  disable() {
    this.featureLayer.data([]).draw();
    this.textFeature.data([]).draw();
    if (this.quadFeature) {
      this.quadFeature.data([]).draw();
    }
  }

  // eslint-disable-next-line class-methods-use-this
  createStyle(): LayerStyle<CalibrationPointData> {
    return {
      ...super.createStyle(),
      fill: true,
      fillColor: (data: CalibrationPointData) => (data.pending ? 'cyan' : 'yellow'),
      fillOpacity: 1,
      radius: 6,
      strokeColor: (data: CalibrationPointData) => (data.pending ? 'blue' : 'red'),
      strokeWidth: 2,
    };
  }
}
