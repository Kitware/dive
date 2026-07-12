import geo from 'geojs';
import type { MediaController } from '../components/annotators/mediaControllerType';
import { Matrix3, geojsWarpQuads } from '../alignedView/homography';
import { findQuadMediaLayer } from '../components/layerManager/quadMediaSource';

export interface CameraImage {
  /** The texture source for the geojs quad feature: an `<img>` for image sequences, a `<video>` for video datasets. */
  source: HTMLImageElement | HTMLVideoElement;
  /** Which quad-feature data key `source` must be assigned to (geojs' canvas renderer branches on this). */
  kind: 'image' | 'video';
  width: number;
  height: number;
}

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
 * transform ({@link geojsWarpQuads}), and the annotator's own native
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

  /** Whether we hid the annotator's native image quad layer. */
  private nativeHidden = false;

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
    // during registration picking, RegistrationKeypointLayer additionally maps
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
    return findQuadMediaLayer(this.annotator.geoViewerRef.value, this.quadLayer);
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
      // The frame may simply not have finished loading yet (the annotator
      // bumps imageRevision when it lands, which re-runs update()), or this
      // annotator type exposes no image element (e.g. large-image tiles), in
      // which case the native display simply stays.
      this.clear();
      return;
    }
    const { width: w, height: h } = src;
    // 2px cell overlap hides the canvas antialiasing seams between abutting
    // sub-quads (dark grid lines); safe here because quads draw opaque.
    const quads = geojsWarpQuads(transform, w, h, 2)
      .map((q) => ({ ...q, [src.kind]: src.source }));
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
  }
}
