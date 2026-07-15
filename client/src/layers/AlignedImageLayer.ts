import geo from 'geojs';
import type { MediaController } from '../components/annotators/mediaControllerType';
import { Matrix3, geojsWarpQuadsForImage } from '../alignedView/homography';
import { findQuadMediaLayer } from '../components/layerManager/quadMediaSource';
import type { CameraImage } from './cameraImage';

export type { CameraImage };

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
   * Find the annotator's own media layer(s): the image/video quad layer for
   * Image/Video annotators, or OSM tile layers for LargeImageAnnotator. Both
   * are created before LayerManager layers. Returns an empty list when none
   * are found.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private findNativeMediaLayers(): any[] {
    const viewer = this.annotator.geoViewerRef.value;
    if (!viewer || typeof viewer.layers !== 'function') {
      return [];
    }
    const nativeQuad = findQuadMediaLayer(viewer, this.quadLayer);
    if (nativeQuad) {
      return [nativeQuad];
    }
    // Tiled large-image: hide every OSM layer that isn't ours.
    return viewer.layers().filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (layer: any) => layer !== this.quadLayer
        && typeof layer?.url === 'function'
        && typeof layer?.features !== 'function',
    );
  }

  private setNativeVisible(visible: boolean) {
    if (visible === !this.nativeHidden) {
      return;
    }
    const nativeLayers = this.findNativeMediaLayers();
    if (nativeLayers.length) {
      nativeLayers.forEach((nativeLayer) => {
        if (typeof nativeLayer.visible === 'function') {
          nativeLayer.visible(visible);
        } else if (typeof nativeLayer.opacity === 'function') {
          nativeLayer.opacity(visible ? 1 : 0);
        } else if (typeof nativeLayer.node === 'function') {
          nativeLayer.node().css('visibility', visible ? '' : 'hidden');
        }
        if (visible && typeof nativeLayer.draw === 'function') {
          nativeLayer.draw();
        }
      });
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
      // bumps imageRevision when it lands, which re-runs update()). Large-image
      // panes expose a composited frameTexture once ready; until then the
      // native tile display stays.
      this.clear();
      return;
    }
    // 2px cell overlap hides the canvas antialiasing seams between abutting
    // sub-quads (dark grid lines); safe here because quads draw opaque.
    // geojsWarpQuadsForImage keeps corner math in native space while remapping
    // crop rectangles into the (possibly downsampled) texture's pixels.
    const quads = geojsWarpQuadsForImage(transform, src, 2);
    // Mirror the native layer's CSS filter (image enhancements) so toggling
    // the warp doesn't change brightness/contrast rendering.
    const [nativeLayer] = this.findNativeMediaLayers();
    if (nativeLayer && typeof nativeLayer.node === 'function') {
      this.quadLayer.node().css('filter', nativeLayer.node().css('filter'));
    }
    this.quadFeature
      .data(quads)
      .style('opacity', 1)
      .draw();
    this.setNativeVisible(false);
  }
}
