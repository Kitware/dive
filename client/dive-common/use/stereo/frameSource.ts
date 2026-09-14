/**
 * Helpers to obtain full-resolution RGBA pixels for a camera's current frame,
 * for {@link StereoOnnxMatcher}. The matcher needs the original image pixels
 * (not the zoomed/panned GeoJS render), so we read the source image element.
 *
 * `imageElementToRgba` is the simple, correct path when you already hold the
 * frame's HTMLImageElement. `geoViewerToImageElement` is a best-effort scan of a
 * GeoJS viewer's quad/image features to find that element; GeoJS internals vary,
 * so it may need adjustment for a given annotator setup.
 */

import { RgbaImage } from './image';

/** Draw an image element to an offscreen canvas and read back RGBA pixels. */
export function imageElementToRgba(
  img: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): RgbaImage {
  const width = (img as HTMLImageElement).naturalWidth
    || (img as HTMLCanvasElement).width
    || (img as ImageBitmap).width;
  const height = (img as HTMLImageElement).naturalHeight
    || (img as HTMLCanvasElement).height
    || (img as ImageBitmap).height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2d canvas context');
  ctx.drawImage(img as CanvasImageSource, 0, 0, width, height);
  return { ...ctx.getImageData(0, 0, width, height), width, height };
}

/**
 * Best-effort: find the source image element backing a GeoJS viewer's image
 * quad. Returns null if none is found (the caller should then fall back to
 * another source, e.g. fetching the frame image URL directly).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function geoViewerToImageElement(geoViewer: any): HTMLImageElement | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layers: any[] = geoViewer?.layers?.() ?? [];
    // GeoJS quadFeature stores its quads (each with an `.image`) in data().
    const quads = layers
      .flatMap((layer) => (layer.features?.() ?? []))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .flatMap((feature: any) => (feature.data?.() ?? []));
    const quad = quads.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (d: any) => d?.image instanceof HTMLImageElement && d.image.naturalWidth,
    );
    return quad ? (quad.image as HTMLImageElement) : null;
  } catch {
    return null;
  }
}
