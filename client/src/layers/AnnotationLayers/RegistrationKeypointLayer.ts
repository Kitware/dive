import geo, { GeoEvent } from 'geojs';
import BaseLayer, { BaseLayerParams, LayerStyle } from '../BaseLayer';
import { FrameDataTrack } from '../LayerTypes';
import CameraRegistrationStore from '../../alignedView/CameraRegistrationStore';
import { geojsWarpQuads } from '../../alignedView/homography';
import type { CameraImage } from '../AlignedImageLayer';

export interface RegistrationPointData {
  x: number;
  y: number;
  label: string;
  pending: boolean;
  /** Marker belongs to the selected correspondence (highlighted in both panes). */
  selected: boolean;
  /** Owning correspondence id; undefined for the pending (in-progress) point. */
  correspondenceId?: number;
}

export type { CameraImage };

interface RegistrationLayerParams {
  registration: CameraRegistrationStore;
  /** Resolve another camera's currently displayed frame image (for the overlay). */
  getCameraImage?: (camera: string) => CameraImage | null;
}

/** Display-pixel radius within which a mousedown grabs an existing marker to drag-refine it. */
const DRAG_HIT_RADIUS_PX = 10;

/**
 * Renders this camera's picked registration points (numbered markers, the pending
 * "blue" point highlighted) and, when alignment mode is active, a ghost overlay
 * of the other camera's frame warped through the fitted homography (geojs
 * quadFeature). One instance is created per camera in LayerManager.
 */
export default class RegistrationKeypointLayer extends BaseLayer<RegistrationPointData> {
  registration: CameraRegistrationStore;

  getCameraImage?: (camera: string) => CameraImage | null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  textFeature: any;

  /** Small bright dot drawn at each marker's exact pixel (inside the ring). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  centerFeature: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quadFeature: any;

  /** The ghost quads' own feature layer: opacity is applied here (layer-level)
   * so the seam-hiding cell overlap doesn't double-blend (see updateGhost). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quadLayer: any;

  /**
   * Marker currently being drag-refined, or null/undefined. NOTE: these two
   * fields deliberately have no initializers -- BaseLayer's constructor calls
   * initialize() (which assigns mapNode) before subclass field initializers
   * would run, so an `= null` here would wipe the assignment afterward (same
   * reason textFeature/quadFeature above are declared bare).
   */
  private dragTarget?: { correspondenceId?: number; pending: boolean } | null;

  private mapNode?: HTMLElement;

  private boundDragMove = (evt: MouseEvent) => this.handleDragMove(evt);

  private boundDragEnd = () => this.handleDragEnd();

  constructor(params: BaseLayerParams & RegistrationLayerParams) {
    super(params);
    this.registration = params.registration;
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
    this.quadLayer = quadLayer;
    this.quadFeature = quadLayer.createFeature('quad');

    const pointLayer = geoViewer.createLayer('feature', { features: ['point'] });
    this.featureLayer = pointLayer.createFeature('point');
    // A second point feature on the same layer, created after the ring so it
    // renders on top: a small bright dot marking each marker's exact pixel.
    // Unlocked points (the pending point being placed, or a selected one) are
    // yellow; locked (committed) points are blue.
    this.centerFeature = pointLayer.createFeature('point').style({
      fill: true,
      fillColor: (data: RegistrationPointData) => (
        (data.selected || data.pending) ? 'yellow' : 'cyan'),
      fillOpacity: 1,
      radius: (data: RegistrationPointData) => (data.selected ? 3.5 : 2.5),
      strokeColor: (data: RegistrationPointData) => (
        (data.selected || data.pending) ? 'orange' : 'blue'),
      strokeWidth: 1,
    });

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
      .text((data: RegistrationPointData) => data.label)
      .position((data: RegistrationPointData) => ({ x: data.x, y: data.y }))
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
   * {@link CameraRegistrationStore.requestRecenter}) instead of picking.
   */
  handleClick(e: GeoEvent) {
    if (!this.registration || !this.registration.pickingEnabled.value) {
      return;
    }
    // Map-level mouseclick exposes buttonsDown at the top level; feature-level
    // events nest it under `mouse`.
    const buttonsDown = e.buttonsDown || (e.mouse && e.mouse.buttonsDown);
    const pair = this.registration.activePair.value;
    const cam = this.annotator.cameraName.value;
    if (!pair || (cam !== pair.camA && cam !== pair.camB)) {
      return;
    }
    if (!e.geo) {
      return;
    }
    // e.geo is already in image (gcs) coordinates.
    if (buttonsDown && buttonsDown.right) {
      this.registration.requestRecenter(cam, [e.geo.x, e.geo.y]);
      return;
    }
    if (buttonsDown && !buttonsDown.left) {
      return;
    }
    // Clicking empty space places a new point; it also clears any marker
    // selection (a press ON a marker never reaches here -- handleDragStart
    // captures it).
    this.registration.selectCorrespondence(null);
    this.registration.pickPoint(cam, [e.geo.x, e.geo.y]);
  }

  /**
   * Map-level mousemove handler: updates the live coordinate readout while
   * picking is active, and shows a grab cursor over draggable markers.
   */
  handleMouseMove(e: GeoEvent) {
    if (!this.registration || !this.registration.pickingEnabled.value || !e.geo) {
      return;
    }
    const pair = this.registration.activePair.value;
    const cam = this.annotator.cameraName.value;
    if (!pair || (cam !== pair.camA && cam !== pair.camB)) {
      return;
    }
    this.registration.setCursorCoord(cam, [e.geo.x, e.geo.y]);
    if (this.mapNode && !this.dragTarget && e.map) {
      const hit = this.findMarkerAtDisplay(e.map);
      this.mapNode.style.cursor = hit ? 'grab' : '';
    }
  }

  /** Nearest rendered marker within DRAG_HIT_RADIUS_PX of a display-space point, or null. */
  private findMarkerAtDisplay(display: { x: number; y: number }): RegistrationPointData | null {
    const map = this.annotator.geoViewerRef.value;
    if (!map) {
      return null;
    }
    let best: RegistrationPointData | null = null;
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
    if (evt.button !== 0 || !this.registration || !this.registration.pickingEnabled.value) {
      return;
    }
    const pair = this.registration.activePair.value;
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
    // Grabbing a marker selects its correspondence (highlighted in both
    // panes, deletable via the panel or the Delete key); grabbing the
    // pending point clears the selection.
    this.registration.selectCorrespondence(hit.correspondenceId ?? null);
    this.dragTarget = { correspondenceId: hit.correspondenceId, pending: hit.pending };
    if (this.mapNode) {
      this.mapNode.style.cursor = 'grabbing';
    }
    window.addEventListener('mousemove', this.boundDragMove);
    window.addEventListener('mouseup', this.boundDragEnd);
  }

  private handleDragMove(evt: MouseEvent) {
    if (!this.dragTarget || !this.registration) {
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
      this.registration.movePendingPoint(cam, [gcs.x, gcs.y]);
    } else if (this.dragTarget.correspondenceId !== undefined) {
      this.registration.updateCorrespondencePoint(this.dragTarget.correspondenceId, cam, [gcs.x, gcs.y]);
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
  formatData(_frameData: FrameDataTrack[]): RegistrationPointData[] {
    const result: RegistrationPointData[] = [];
    if (!this.registration) {
      return result;
    }
    // Point markers are authoring UI: they show only while picking is on
    // (the correspondences themselves stay in the store either way).
    if (!this.registration.pickingEnabled.value) {
      return result;
    }
    const pair = this.registration.activePair.value;
    const cam = this.annotator.cameraName.value;
    if (!pair || (cam !== pair.camA && cam !== pair.camB)) {
      return result;
    }
    const key = this.registration.pairKey(pair.camA, pair.camB);
    const list = this.registration.correspondences.value[key] || [];
    const selectedId = this.registration.selectedCorrespondenceId.value;
    list.forEach((c, i) => {
      const coord = cam === pair.camA ? c.a : c.b;
      result.push({
        x: coord[0],
        y: coord[1],
        label: `${i + 1}`,
        pending: false,
        selected: c.id === selectedId,
        correspondenceId: c.id,
      });
    });
    const pending = this.registration.pendingPoint.value;
    if (pending && pending.camera === cam) {
      result.push({
        x: pending.coord[0],
        y: pending.coord[1],
        label: `${list.length + 1}`,
        pending: true,
        selected: false,
      });
    }
    return result;
  }

  /**
   * Render (or clear) the aligned ghost overlay. The ghost is drawn in the
   * destination camera's pane: the source camera's image is warped through the
   * fitted `homog[mode]` matrix -- the same matrix that
   * {@link CameraRegistrationStore.pickPoint} inverts to attribute a ghost-pane
   * click back to the source camera, so rendering and click attribution use the
   * same exact projective mapping. Because geojs' canvas quad renderer is
   * affine-only (a single quad is drawn as a parallelogram from three of its
   * corners), a transform with non-negligible perspective terms is rendered as
   * an n x n grid of sub-quads whose corners are each mapped through the exact
   * homography (see {@link geojsWarpQuads}); each sub-quad is approximately
   * affine, so the rendered warp matches the projective mapping to sub-pixel
   * accuracy and ghost-targeted picks land where the user visually aligned.
   */
  updateGhost() {
    if (!this.quadFeature) {
      return;
    }
    const clear = () => {
      this.quadFeature.data([]).draw();
    };
    const alignment = this.registration?.alignment.value;
    const pair = this.registration?.activePair.value;
    if (!alignment || alignment.mode === 'original' || !pair || !this.getCameraImage) {
      clear();
      return;
    }
    const key = this.registration.pairKey(pair.camA, pair.camB);
    const homog = this.registration.homographies.value[key];
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
      // The source pane's frame may simply not have finished loading yet;
      // its annotator bumps imageRevision when it lands, and LayerManager's
      // ghost-source watch re-runs updateGhost.
      clear();
      return;
    }
    const h = homog[mode];
    const { width: w, height: hgt } = src;
    // 2px cell overlap hides the canvas antialiasing seams between abutting
    // sub-quads (dark grid lines). Overlapped quads must draw opaque -- the
    // ghost's transparency is applied once at the layer level below, so the
    // overlap doesn't double-blend into brighter seams.
    const quads = geojsWarpQuads(h, w, hgt, 2)
      .map((q) => ({ ...q, [src.kind]: src.source }));
    this.quadLayer.opacity(alignment.opacity);
    this.quadFeature
      .data(quads)
      .style('opacity', 1)
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
    this.centerFeature.data(this.formattedData).draw();
    this.textFeature.data(this.formattedData).draw();
    return null;
  }

  disable() {
    this.featureLayer.data([]).draw();
    this.centerFeature.data([]).draw();
    this.textFeature.data([]).draw();
    if (this.quadFeature) {
      this.quadFeature.data([]).draw();
    }
  }

  // eslint-disable-next-line class-methods-use-this
  createStyle(): LayerStyle<RegistrationPointData> {
    return {
      ...super.createStyle(),
      // Hollow ring: leave the center transparent so the exact pixel being
      // picked stays visible through the marker (a solid disc hides the very
      // target it marks). A bright center dot (see centerFeature) marks the
      // exact pixel; the dark ring + bright dot stay legible on both light and
      // dark imagery. Unlocked points (pending or selected) are yellow; locked
      // (committed) points are blue. The selected point gets a larger ring.
      fill: false,
      fillOpacity: 0,
      radius: (data: RegistrationPointData) => (data.selected ? 9 : 7),
      strokeColor: (data: RegistrationPointData) => (
        (data.selected || data.pending) ? 'orange' : 'blue'),
      strokeWidth: (data: RegistrationPointData) => (data.selected ? 3 : 2),
    };
  }
}
