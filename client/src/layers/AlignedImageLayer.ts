import geo from 'geojs';
import type { MediaController } from '../components/annotators/mediaControllerType';
import { Matrix3, subdivideWarpQuads, warpGridSize } from '../homography';

export interface CameraImage {
  /** The texture source for the geojs quad feature: an `<img>` for image sequences, a `<video>` for video datasets. */
  source: HTMLImageElement | HTMLVideoElement;
  /** Which quad-feature data key `source` must be assigned to (geojs' canvas renderer branches on this). */
  kind: 'image' | 'video';
  width: number;
  height: number;
}

/**
 * How many animation frames to keep re-checking whether this camera's
 * displayed image element has changed after an update trigger (image
 * sequences swap their quad datum asynchronously once the new frame loads;
 * see CalibrationKeypointLayer.scheduleGhostRefresh for the same pattern).
 */
const REFRESH_MAX_ATTEMPTS = 60;

interface AlignedImageLayerParams {
  annotator: MediaController;
  /** Resolve this camera's currently displayed frame image element. */
  getImage: () => CameraImage | null;
  /** Current native->reference display transform, or null when unwarped. */
  getTransform: () => Matrix3 | null;
  /**
   * Whether the right-click recenter is currently allowed. Right-click
   * recenters in EVERY view mode (aligned or not, multicam or single); the
   * caller disables it while annotation geometry is being created/edited,
   * where right-click already means "remove last point".
   */
  getRecenterEnabled: () => boolean;
}

/**
 * Renders this camera's own frame warped into the reference camera's space
 * while the multicam aligned view is on (SEAL-TK feature 2, decision D1: the
 * proven quad-corner warp). The warp is drawn as an n x n grid of geojs
 * canvas quads whose corners are mapped through the exact projective
 * transform ({@link subdivideWarpQuads}), and the annotator's own native
 * image quad layer is hidden while the warp is shown -- so annotation layers
 * (whose vertices are mapped through the same matrix at draw time) land
 * exactly on the warped imagery. When no transform applies, everything is
 * restored and the pane renders byte-identically to today.
 *
 * Construct BEFORE the annotation layers in LayerManager so this geojs layer
 * z-orders below boxes/polygons/text (geojs stacks by creation order).
 */
export default class AlignedImageLayer {
  private annotator: MediaController;

  private getImage: () => CameraImage | null;

  private getTransform: () => Matrix3 | null;

  private getRecenterEnabled: () => boolean;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private quadLayer: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private quadFeature: any;

  /** The source element currently rendered as the warp, if any. */
  private renderedSource: HTMLImageElement | HTMLVideoElement | null = null;

  /** Whether we hid the annotator's native image quad layer. */
  private nativeHidden = false;

  /** Pending requestAnimationFrame handle for the staleness re-check loop. */
  private retryHandle: number | null = null;

  private retryAttempts = 0;

  constructor(params: AlignedImageLayerParams) {
    this.annotator = params.annotator;
    this.getImage = params.getImage;
    this.getTransform = params.getTransform;
    this.getRecenterEnabled = params.getRecenterEnabled;
    this.quadLayer = this.annotator.geoViewerRef.value.createLayer('feature', {
      features: ['quad'],
      autoshareRenderer: false,
      renderer: 'canvas',
    });
    this.quadFeature = this.quadLayer.createFeature('quad');
    // Right-click recenter: center this pane on the clicked location, in any
    // view mode. While the aligned view is active, the aligned pan/zoom link
    // then recenters every other pane on the same reference-space point;
    // during calibration picking, CalibrationKeypointLayer additionally maps
    // the recenter across the active pair.
    this.annotator.geoViewerRef.value.geoOn(
      geo.event.mouseclick,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e: any) => this.handleClick(e),
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleClick(e: any) {
    if (!this.getRecenterEnabled() || !e.geo) {
      return;
    }
    const buttonsDown = e.buttonsDown || (e.mouse && e.mouse.buttonsDown);
    if (!buttonsDown || !buttonsDown.right) {
      return;
    }
    this.annotator.geoViewerRef.value.center({ x: e.geo.x, y: e.geo.y });
  }

  /**
   * Find the annotator's own image/video quad layer (the one Image/Video
   * Annotator draws each frame into). It is created before any LayerManager
   * layer, so it is the first layer -- other than ours -- containing a quad
   * datum with an `image`/`video` texture source. Returns null for
   * annotators without one (e.g. tiled large-image datasets).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private findNativeQuadLayer(): any | null {
    const viewer = this.annotator.geoViewerRef.value;
    if (!viewer || typeof viewer.layers !== 'function') {
      return null;
    }
    const layerList = viewer.layers();
    for (let i = 0; i < layerList.length; i += 1) {
      const layer = layerList[i];
      if (layer !== this.quadLayer && typeof layer.features === 'function') {
        const features = layer.features();
        for (let j = 0; j < features.length; j += 1) {
          const data = typeof features[j].data === 'function' ? features[j].data() : undefined;
          const datum = Array.isArray(data) ? data[0] : undefined;
          if (datum && (datum.image || datum.video)) {
            return layer;
          }
        }
      }
    }
    return null;
  }

  private setNativeVisible(visible: boolean) {
    if (visible === !this.nativeHidden) {
      return;
    }
    const nativeLayer = this.findNativeQuadLayer();
    if (nativeLayer) {
      nativeLayer.visible(visible);
      if (visible) {
        nativeLayer.draw();
      }
      this.nativeHidden = !visible;
    } else if (visible) {
      this.nativeHidden = false;
    }
  }

  /** Clear the warp and restore the native image display. */
  clear() {
    this.cancelRefresh();
    this.renderedSource = null;
    this.quadFeature.data([]).draw();
    this.setNativeVisible(true);
  }

  /** Recompute the warp from the current transform and frame image. */
  update() {
    const transform = this.getTransform();
    if (!transform) {
      this.clear();
      return;
    }
    const src = this.getImage();
    if (!src || !src.width || !src.height) {
      // The frame may simply not have finished loading yet (or this
      // annotator type exposes no image element, e.g. large-image tiles, in
      // which case polling harmlessly expires and the native display stays).
      this.cancelRefresh();
      this.renderedSource = null;
      this.quadFeature.data([]).draw();
      this.setNativeVisible(true);
      this.scheduleRefresh();
      return;
    }
    const { width: w, height: h } = src;
    const grid = warpGridSize(transform, w, h);
    // 2px cell overlap hides the canvas antialiasing seams between abutting
    // sub-quads (dark grid lines); safe here because quads draw opaque.
    const quads = subdivideWarpQuads(transform, w, h, grid, 2).map((q) => ({
      ul: { x: q.ul[0], y: q.ul[1] },
      ur: { x: q.ur[0], y: q.ur[1] },
      lr: { x: q.lr[0], y: q.lr[1] },
      ll: { x: q.ll[0], y: q.ll[1] },
      // geojs crop: left/top/right/bottom select the source-pixel region;
      // x/y (the "size after crop") are set to the full source size so that
      // region stretches across the whole sub-quad.
      crop: {
        ...q.crop, x: w, y: h,
      },
      [src.kind]: src.source,
    }));
    this.renderedSource = src.source;
    // Mirror the native layer's CSS filter (image enhancements) so toggling
    // the warp doesn't change brightness/contrast rendering.
    const nativeLayer = this.findNativeQuadLayer();
    if (nativeLayer) {
      this.quadLayer.node().css('filter', nativeLayer.node().css('filter'));
    }
    this.quadFeature
      .data(quads)
      .style('opacity', 1)
      .draw();
    this.setNativeVisible(false);
    if (src.kind === 'image') {
      // Image sequences swap the <img> element asynchronously after the
      // frame finishes loading, with no event reaching this layer; poll
      // briefly so the warp catches up (video elements update in place).
      this.scheduleRefresh();
    } else {
      this.cancelRefresh();
    }
  }

  private cancelRefresh() {
    if (this.retryHandle !== null) {
      cancelAnimationFrame(this.retryHandle);
      this.retryHandle = null;
    }
  }

  /**
   * Bounded requestAnimationFrame loop re-checking whether the displayed
   * image element differs from the one the warp was rendered from, and
   * re-rendering when it does (same pattern as the calibration ghost).
   */
  private scheduleRefresh() {
    this.cancelRefresh();
    this.retryAttempts = 0;
    if (typeof requestAnimationFrame !== 'function') {
      return;
    }
    const tick = () => {
      this.retryHandle = null;
      if (!this.getTransform()) {
        return;
      }
      const src = this.getImage();
      if (src && src.source && src.width && src.height && src.source !== this.renderedSource) {
        // Re-render with the new element; update() restarts this loop.
        this.update();
        return;
      }
      this.retryAttempts += 1;
      if (this.retryAttempts < REFRESH_MAX_ATTEMPTS) {
        this.retryHandle = requestAnimationFrame(tick);
      }
    };
    this.retryHandle = requestAnimationFrame(tick);
  }
}
