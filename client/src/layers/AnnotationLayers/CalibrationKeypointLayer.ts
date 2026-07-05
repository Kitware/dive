import geo, { GeoEvent } from 'geojs';
import BaseLayer, { BaseLayerParams, LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';
import CameraCalibrationStore from '../../CameraCalibrationStore';
import { subdivideWarpQuads, warpGridSize } from '../../homography';

export interface CalibrationPointData {
  x: number;
  y: number;
  label: string;
  pending: boolean;
  /** Owning correspondence id; undefined for the pending (blue) point. */
  correspondenceId?: number;
}

export interface CameraImage {
  /** The texture source for the geojs quad feature: an `<img>` for image sequences, a `<video>` for video datasets. */
  source: HTMLImageElement | HTMLVideoElement;
  /** Which quad-feature data key `source` must be assigned to (geojs' canvas renderer branches on this). */
  kind: 'image' | 'video';
  width: number;
  height: number;
}

interface CalibrationLayerParams {
  calibration: CameraCalibrationStore;
  /** Resolve another camera's currently displayed frame image (for the overlay). */
  getCameraImage?: (camera: string) => CameraImage | null;
}

/**
 * How many animation frames to keep re-checking whether the ghost source
 * camera's displayed image element has changed after an update trigger (image
 * sequences swap their quad datum asynchronously once the new frame loads).
 * ~60 frames is about one second at typical refresh rates.
 */
const GHOST_REFRESH_MAX_ATTEMPTS = 60;

/** Display-pixel radius within which a mousedown grabs an existing marker to drag-refine it. */
const DRAG_HIT_RADIUS_PX = 10;

/**
 * Renders this camera's picked calibration points (numbered markers, the pending
 * "blue" point highlighted) and, when alignment mode is active, a ghost overlay
 * of the other camera's frame warped through the fitted homography (geojs
 * quadFeature). One instance is created per camera in LayerManager.
 */
export default class CalibrationKeypointLayer extends BaseLayer<CalibrationPointData> {
  calibration: CameraCalibrationStore;

  getCameraImage?: (camera: string) => CameraImage | null;

  /** The source element currently rendered as the ghost overlay, if any. */
  private ghostSource: HTMLImageElement | HTMLVideoElement | null = null;

  /** Pending requestAnimationFrame handle for the ghost staleness re-check loop. */
  private ghostRetryHandle: number | null = null;

  private ghostRetryAttempts = 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textFeature: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quadFeature: any;

  /** Marker currently being drag-refined, or null. */
  private dragTarget: { correspondenceId?: number; pending: boolean } | null = null;

  private mapNode: HTMLElement | null = null;

  private boundDragMove = (evt: MouseEvent) => this.handleDragMove(evt);

  private boundDragEnd = () => this.handleDragEnd();

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
    this.annotator.geoViewerRef.value.geoOn(
      geo.event.mousemove,
      (e: GeoEvent) => this.handleMouseMove(e),
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

    // Drag-to-refine: a capture-phase mousedown on the map node runs before
    // geojs' own interactor sees the event, so grabbing a marker can suppress
    // the pan gesture (and the click that would otherwise place a new point).
    [this.mapNode] = geoViewer.node();
    if (this.mapNode) {
      this.mapNode.addEventListener('mousedown', (evt: MouseEvent) => this.handleDragStart(evt), true);
    }

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

  /**
   * Map-level click handler: left click records a point when picking is
   * active for this camera; right click requests a recenter of both cameras
   * in the active pair on the clicked location (see
   * {@link CameraCalibrationStore.requestRecenter}) instead of picking.
   */
  handleClick(e: GeoEvent) {
    if (!this.calibration || !this.calibration.pickingEnabled.value) {
      return;
    }
    // Map-level mouseclick exposes buttonsDown at the top level; feature-level
    // events nest it under `mouse`.
    const buttonsDown = e.buttonsDown || (e.mouse && e.mouse.buttonsDown);
    const pair = this.calibration.activePair.value;
    const cam = this.annotator.cameraName.value;
    if (!pair || (cam !== pair.camA && cam !== pair.camB)) {
      return;
    }
    if (!e.geo) {
      return;
    }
    // e.geo is already in image (gcs) coordinates.
    if (buttonsDown && buttonsDown.right) {
      this.calibration.requestRecenter(cam, [e.geo.x, e.geo.y]);
      return;
    }
    if (buttonsDown && !buttonsDown.left) {
      return;
    }
    this.calibration.pickPoint(cam, [e.geo.x, e.geo.y]);
  }

  /**
   * Map-level mousemove handler: updates the live coordinate readout while
   * picking is active, and shows a grab cursor over draggable markers.
   */
  handleMouseMove(e: GeoEvent) {
    if (!this.calibration || !this.calibration.pickingEnabled.value || !e.geo) {
      return;
    }
    const pair = this.calibration.activePair.value;
    const cam = this.annotator.cameraName.value;
    if (!pair || (cam !== pair.camA && cam !== pair.camB)) {
      return;
    }
    this.calibration.setCursorCoord(cam, [e.geo.x, e.geo.y]);
    if (this.mapNode && !this.dragTarget && e.map) {
      const hit = this.findMarkerAtDisplay(e.map);
      this.mapNode.style.cursor = hit ? 'grab' : '';
    }
  }

  /** Nearest rendered marker within DRAG_HIT_RADIUS_PX of a display-space point, or null. */
  private findMarkerAtDisplay(display: { x: number; y: number }): CalibrationPointData | null {
    const map = this.annotator.geoViewerRef.value;
    if (!map) {
      return null;
    }
    let best: CalibrationPointData | null = null;
    let bestDist = DRAG_HIT_RADIUS_PX;
    this.formattedData.forEach((d) => {
      const disp = map.gcsToDisplay({ x: d.x, y: d.y });
      const dist = Math.hypot(disp.x - display.x, disp.y - display.y);
      if (dist <= bestDist) {
        best = d;
        bestDist = dist;
      }
    });
    return best;
  }

  /** Display-space coordinates of a DOM mouse event relative to the map node. */
  private eventDisplayCoords(evt: MouseEvent): { x: number; y: number } | null {
    if (!this.mapNode) {
      return null;
    }
    const rect = this.mapNode.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  /**
   * Capture-phase mousedown: when picking is active and the press lands on an
   * existing marker, start dragging it instead of letting geojs pan the map
   * (or synthesize the click that would place a new point on top of it).
   */
  private handleDragStart(evt: MouseEvent) {
    if (evt.button !== 0 || !this.calibration || !this.calibration.pickingEnabled.value) {
      return;
    }
    const pair = this.calibration.activePair.value;
    const cam = this.annotator.cameraName.value;
    if (!pair || (cam !== pair.camA && cam !== pair.camB)) {
      return;
    }
    const display = this.eventDisplayCoords(evt);
    if (!display) {
      return;
    }
    const hit = this.findMarkerAtDisplay(display);
    if (!hit) {
      return;
    }
    evt.preventDefault();
    evt.stopImmediatePropagation();
    this.dragTarget = { correspondenceId: hit.correspondenceId, pending: hit.pending };
    if (this.mapNode) {
      this.mapNode.style.cursor = 'grabbing';
    }
    window.addEventListener('mousemove', this.boundDragMove);
    window.addEventListener('mouseup', this.boundDragEnd);
  }

  private handleDragMove(evt: MouseEvent) {
    if (!this.dragTarget || !this.calibration) {
      return;
    }
    const map = this.annotator.geoViewerRef.value;
    const display = this.eventDisplayCoords(evt);
    if (!map || !display) {
      return;
    }
    const gcs = map.displayToGcs(display);
    const cam = this.annotator.cameraName.value;
    if (this.dragTarget.pending) {
      this.calibration.movePendingPoint(cam, [gcs.x, gcs.y]);
    } else if (this.dragTarget.correspondenceId !== undefined) {
      this.calibration.updateCorrespondencePoint(this.dragTarget.correspondenceId, cam, [gcs.x, gcs.y]);
    }
  }

  private handleDragEnd() {
    this.dragTarget = null;
    if (this.mapNode) {
      this.mapNode.style.cursor = '';
    }
    window.removeEventListener('mousemove', this.boundDragMove);
    window.removeEventListener('mouseup', this.boundDragEnd);
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
        x: coord[0], y: coord[1], label: `${i + 1}`, pending: false, correspondenceId: c.id,
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
   * Render (or clear) the aligned ghost overlay. The ghost is drawn in the
   * destination camera's pane: the source camera's image is warped through the
   * fitted `homog[mode]` matrix -- the same matrix that
   * {@link CameraCalibrationStore.pickPoint} inverts to attribute a ghost-pane
   * click back to the source camera, so rendering and click attribution use the
   * same exact projective mapping. Because geojs' canvas quad renderer is
   * affine-only (a single quad is drawn as a parallelogram from three of its
   * corners), a transform with non-negligible perspective terms is rendered as
   * an n x n grid of sub-quads whose corners are each mapped through the exact
   * homography (see {@link subdivideWarpQuads}); each sub-quad is approximately
   * affine, so the rendered warp matches the projective mapping to sub-pixel
   * accuracy and ghost-targeted picks land where the user visually aligned.
   */
  updateGhost() {
    if (!this.quadFeature) {
      return;
    }
    const clear = () => {
      this.ghostSource = null;
      this.cancelGhostRefresh();
      this.quadFeature.data([]).draw();
    };
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
      // The source pane's frame may simply not have finished loading yet;
      // keep re-checking briefly (see scheduleGhostRefresh).
      this.scheduleGhostRefresh(srcCam);
      return;
    }
    const h = homog[mode];
    const { width: w, height: hgt } = src;
    const grid = warpGridSize(h, w, hgt);
    const quads = subdivideWarpQuads(h, w, hgt, grid).map((q) => ({
      ul: { x: q.ul[0], y: q.ul[1] },
      ur: { x: q.ur[0], y: q.ur[1] },
      lr: { x: q.lr[0], y: q.lr[1] },
      ll: { x: q.ll[0], y: q.ll[1] },
      // geojs crop: left/top/right/bottom select the source-pixel region;
      // x/y (the "size after crop") are set to the full source size so that
      // region stretches across the whole sub-quad.
      crop: {
        ...q.crop, x: w, y: hgt,
      },
      [src.kind]: src.source,
    }));
    this.ghostSource = src.source;
    this.quadFeature
      .data(quads)
      .style('opacity', alignment.opacity)
      .draw();
    if (src.kind === 'image') {
      // Image sequences swap the source pane's <img> asynchronously after the
      // frame finishes loading, with no event reaching this layer; poll
      // briefly so the ghost catches up (video elements update in place).
      this.scheduleGhostRefresh(srcCam);
    } else {
      this.cancelGhostRefresh();
    }
  }

  /** Cancel any pending ghost staleness re-check. */
  private cancelGhostRefresh() {
    if (this.ghostRetryHandle !== null) {
      cancelAnimationFrame(this.ghostRetryHandle);
      this.ghostRetryHandle = null;
    }
  }

  /**
   * Bounded requestAnimationFrame loop that re-checks whether `srcCam`'s
   * displayed image element differs from the one the ghost was rendered from,
   * and re-renders the ghost when it does. This covers the gap between a frame
   * change (which triggers {@link update} immediately) and the moment
   * ImageAnnotator actually swaps the loaded <img> into its quad datum.
   */
  private scheduleGhostRefresh(srcCam: string) {
    this.cancelGhostRefresh();
    this.ghostRetryAttempts = 0;
    if (typeof requestAnimationFrame !== 'function') {
      return;
    }
    const tick = () => {
      this.ghostRetryHandle = null;
      const src = this.getCameraImage ? this.getCameraImage(srcCam) : null;
      if (src && src.source && src.width && src.height && src.source !== this.ghostSource) {
        // Re-render with the new element; updateGhost restarts this loop.
        this.updateGhost();
        return;
      }
      this.ghostRetryAttempts += 1;
      if (this.ghostRetryAttempts < GHOST_REFRESH_MAX_ATTEMPTS) {
        this.ghostRetryHandle = requestAnimationFrame(tick);
      }
    };
    this.ghostRetryHandle = requestAnimationFrame(tick);
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
    this.ghostSource = null;
    this.cancelGhostRefresh();
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
