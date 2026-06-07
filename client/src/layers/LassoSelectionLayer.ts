import EventBus, { createEventBus } from 'dive-common/utils/eventBus';

import { MediaController } from '../components/annotators/mediaControllerType';
import type { AnnotationId } from '../BaseAnnotation';

const MIN_POINT_DISTANCE = 2;

interface GeoPosition {
  x: number;
  y: number;
}

interface SearchableFeature {
  polygonSearch(
    poly: GeoPosition[],
    opts?: { partial?: boolean },
  ): { found: { trackId: AnnotationId }[] };
}

/**
 * Freehand lasso selection using GeoJS polygonSearch on annotation features.
 * Alt + left-drag on the viewer; Ctrl+Alt adds to the current multi-selection.
 *
 * Implemented with a capture-phase DOM mousedown handler on the GeoJS map
 * node (and document-level mousemove/mouseup) rather than a custom interactor
 * action, since DIVE only configures interactorOpts for core map navigation.
 */
export default class LassoSelectionLayer {
  private annotator: MediaController;

  public bus: EventBus;

  private enabled = true;

  private drawing = false;

  private points: GeoPosition[] = [];

  private ctrlHeld = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private lassoLayer: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private lassoLine: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private lassoFill: any;

  private searchFeatures: () => SearchableFeature[];

  private isBlocked: () => boolean;

  private onDrawingChange?: (drawing: boolean) => void;

  private boundMouseDown: (evt: MouseEvent) => void;

  private boundDocumentMove: (evt: MouseEvent) => void;

  private boundDocumentUp: (evt: MouseEvent) => void;

  constructor(
    annotator: MediaController,
    searchFeatures: () => SearchableFeature[],
    isBlocked: () => boolean,
    onDrawingChange?: (drawing: boolean) => void,
  ) {
    this.annotator = annotator;
    this.searchFeatures = searchFeatures;
    this.isBlocked = isBlocked;
    this.onDrawingChange = onDrawingChange;
    this.bus = createEventBus();
    this.boundMouseDown = (evt) => this.onMouseDown(evt);
    this.boundDocumentMove = (evt) => this.onDocumentMouseMove(evt);
    this.boundDocumentUp = (evt) => this.onDocumentMouseUp(evt);
    this.initialize();
  }

  setEnabled(val: boolean) {
    this.enabled = val;
    if (!val) {
      this.cancelLasso();
    }
  }

  initialize() {
    const map = this.annotator.geoViewerRef.value;
    this.lassoLayer = map.createLayer('feature', {
      features: ['line', 'polygon'],
    });
    this.lassoLine = this.lassoLayer.createFeature('line');
    this.lassoFill = this.lassoLayer.createFeature('polygon');
    this.lassoLine.style({
      stroke: true,
      strokeColor: { r: 0.2, g: 0.6, b: 1 },
      strokeWidth: 2,
      strokeOpacity: 1,
    });
    this.lassoFill.style({
      fill: true,
      fillColor: { r: 0.2, g: 0.6, b: 1 },
      fillOpacity: 0.15,
      stroke: true,
      strokeColor: { r: 0.2, g: 0.6, b: 1 },
      strokeWidth: 2,
      strokeOpacity: 0.8,
    });

    const node = this.getMapNode();
    if (node) {
      node.addEventListener('mousedown', this.boundMouseDown, true);
    }
  }

  private getMapNode(): HTMLElement | undefined {
    const map = this.annotator.geoViewerRef.value;
    const raw = map?.node?.();
    if (!raw) return undefined;
    return (raw[0] ?? raw) as HTMLElement;
  }

  private shouldStartLasso(evt: MouseEvent): boolean {
    return evt.button === 0
      && evt.altKey
      && !evt.shiftKey
      && this.enabled
      && !this.isBlocked();
  }

  private mouseEventToGeo(evt: MouseEvent): GeoPosition | null {
    const map = this.annotator.geoViewerRef.value;
    const node = this.getMapNode();
    if (!node || !map) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    const gcs = map.displayToGcs({
      x: evt.clientX - rect.left,
      y: evt.clientY - rect.top,
    });
    return { x: gcs.x, y: gcs.y };
  }

  private setDrawing(drawing: boolean) {
    if (this.drawing === drawing) {
      return;
    }
    this.drawing = drawing;
    this.onDrawingChange?.(drawing);
  }

  private onMouseDown(evt: MouseEvent) {
    if (!this.shouldStartLasso(evt)) {
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    const map = this.annotator.geoViewerRef.value;
    map.interactor().cancel();

    const geoPos = this.mouseEventToGeo(evt);
    if (!geoPos) {
      return;
    }
    this.ctrlHeld = evt.ctrlKey;
    this.points = [geoPos];
    this.setDrawing(true);
    this.redrawLasso();
    document.addEventListener('mousemove', this.boundDocumentMove);
    document.addEventListener('mouseup', this.boundDocumentUp);
  }

  private onDocumentMouseMove(evt: MouseEvent) {
    if (!this.drawing) {
      return;
    }
    evt.preventDefault();
    const geoPos = this.mouseEventToGeo(evt);
    if (!geoPos) {
      return;
    }
    const last = this.points[this.points.length - 1];
    const dx = geoPos.x - last.x;
    const dy = geoPos.y - last.y;
    if (Math.hypot(dx, dy) >= MIN_POINT_DISTANCE) {
      this.points.push(geoPos);
      this.redrawLasso();
    }
  }

  private onDocumentMouseUp(evt: MouseEvent) {
    if (!this.drawing) {
      return;
    }
    document.removeEventListener('mousemove', this.boundDocumentMove);
    document.removeEventListener('mouseup', this.boundDocumentUp);

    const geoPos = this.mouseEventToGeo(evt);
    if (geoPos) {
      const last = this.points[this.points.length - 1];
      if (!last || last.x !== geoPos.x || last.y !== geoPos.y) {
        this.points.push(geoPos);
      }
    }
    this.setDrawing(false);
    this.clearLassoDisplay();
    if (this.points.length >= 3) {
      const trackIds = this.findTracksInLasso(this.points);
      this.bus.$emit('lasso-selection', trackIds, { ctrl: this.ctrlHeld });
    }
    this.points = [];
    this.ctrlHeld = false;
  }

  private cancelLasso() {
    if (this.drawing) {
      document.removeEventListener('mousemove', this.boundDocumentMove);
      document.removeEventListener('mouseup', this.boundDocumentUp);
    }
    this.setDrawing(false);
    this.points = [];
    this.ctrlHeld = false;
    this.clearLassoDisplay();
  }

  private clearLassoDisplay() {
    this.lassoLine.data([]).draw();
    this.lassoFill.data([]).draw();
  }

  private redrawLasso() {
    if (this.points.length < 2) {
      return;
    }
    const lineCoords = this.points.map((p) => [p.x, p.y]);
    const closedRing = [...lineCoords, lineCoords[0]];
    this.lassoLine
      .data([{ line: lineCoords }])
      .line((d: { line: number[][] }) => d.line)
      .draw();
    if (this.points.length >= 3) {
      this.lassoFill
        .data([{ polygon: closedRing }])
        .polygon((d: { polygon: number[][] }) => d.polygon)
        .draw();
    }
  }

  private findTracksInLasso(ring: GeoPosition[]): AnnotationId[] {
    const trackIds = new Set<AnnotationId>();
    this.searchFeatures().forEach((feature) => {
      const result = feature.polygonSearch(ring, { partial: true });
      result.found.forEach((data) => {
        trackIds.add(data.trackId);
      });
    });
    return Array.from(trackIds);
  }

  destroy() {
    const node = this.getMapNode();
    if (node) {
      node.removeEventListener('mousedown', this.boundMouseDown, true);
    }
    this.cancelLasso();
    const map = this.annotator.geoViewerRef.value;
    if (map && this.lassoLayer) {
      map.deleteLayer(this.lassoLayer);
    }
  }
}
