/**
 * Texture source for Align View warps and registration ghost overlays.
 */
export interface CameraImage {
  /**
   * The texture source for the geojs quad feature: an `<img>` for image
   * sequences, a `<video>` for video, or a composited `<canvas>` overview for
   * tiled large-image datasets.
   */
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
  /** Which quad-feature data key `source` must be assigned to (geojs' canvas renderer branches on this). */
  kind: 'image' | 'video';
  /**
   * Native image width/height used for warp-grid math (registration /
   * Align View). May exceed the texture's pixel size when the source is a
   * downsampled large-image overview canvas -- geoJS stretches the texture
   * across the quads.
   */
  width: number;
  height: number;
}
