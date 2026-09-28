/**
 * Crops one box out of a decoded frame into a chip image. The crop is a
 * square centred on the box so the object stays centred as a track cycles
 * through frames of different sizes; area past the frame edge is left dark
 * rather than shifting the object off centre.
 */
import type { RectBounds } from 'vue-media-annotator/utils';
import type { DecodedFrame } from './frameSource';

export interface ChipRenderOptions {
  /** Context around the box as a fraction of its longer side. */
  padding: number;
  /** Longer output edge in pixels. */
  size: number;
  /** Output width / height; the crop region widens or heightens to match. */
  aspect?: number;
  /** Box outline colour; omit to draw no outline. */
  outline?: string;
  /** JPEG quality. */
  quality?: number;
}

export interface ChipRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a rendered chip maps to the frame: chip px = (image px - region.x) * scale. */
export interface ChipTransform {
  region: ChipRegion;
  scale: number;
  /** Chip image size in pixels. */
  width: number;
  height: number;
}

export interface RenderedChip {
  dataUrl: string;
  transform: ChipTransform;
}

/** Chip pixel coordinates of an image point. */
export function toChipPoint(transform: ChipTransform, x: number, y: number): [number, number] {
  return [(x - transform.region.x) * transform.scale, (y - transform.region.y) * transform.scale];
}

/** Image coordinates of a chip pixel. */
export function toImagePoint(transform: ChipTransform, x: number, y: number): [number, number] {
  return [transform.region.x + x / transform.scale, transform.region.y + y / transform.scale];
}

/**
 * Crop region (may extend past the image) for a box with padding: the
 * padded square around the box, widened or heightened to the requested
 * aspect ratio so the object stays centred whatever the cell's shape.
 */
export function chipRegion(bounds: RectBounds, padding: number, aspect = 1): ChipRegion {
  const [x1, y1, x2, y2] = bounds;
  const w = Math.max(1, Math.abs(x2 - x1));
  const h = Math.max(1, Math.abs(y2 - y1));
  const side = Math.max(w, h) * (1 + 2 * Math.max(0, padding));
  const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const width = ratio >= 1 ? side * ratio : side;
  const height = ratio >= 1 ? side : side / ratio;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return {
    x: cx - width / 2, y: cy - height / 2, width, height,
  };
}

/** Pixel sizes chips are rendered at; cells pick the smallest that covers them. */
export const CHIP_SIZE_BUCKETS = [128, 192, 256, 384, 512, 768];

export function chipSizeFor(cellPixels: number): number {
  const wanted = Math.ceil(cellPixels);
  return CHIP_SIZE_BUCKETS.find((size) => size >= wanted) ?? CHIP_SIZE_BUCKETS[CHIP_SIZE_BUCKETS.length - 1];
}

/** Crop region covering a whole frame at the requested aspect ratio, centred. */
export function frameRegion(width: number, height: number, aspect = 1): ChipRegion {
  const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const regionWidth = w / h >= ratio ? w : h * ratio;
  const regionHeight = w / h >= ratio ? w / ratio : h;
  return {
    x: (w - regionWidth) / 2, y: (h - regionHeight) / 2, width: regionWidth, height: regionHeight,
  };
}

/**
 * Scale from frame pixels to chip pixels: the crop's longer side fills the
 * requested size. Small crops are upscaled so the chip is rendered once at
 * the cell's resolution with high-quality resampling, instead of the browser
 * stretching a tiny image (and its compression artifacts) on every paint.
 */
export function chipScale(region: ChipRegion, size: number): number {
  const longest = Math.max(1, Math.max(region.width, region.height));
  return Math.max(16, size) / longest;
}

/** Render a box crop, or the whole frame when no box is given. */
export function renderChip(
  frame: DecodedFrame,
  bounds: RectBounds | null,
  options: ChipRenderOptions,
): RenderedChip {
  const region = bounds
    ? chipRegion(bounds, options.padding, options.aspect)
    : frameRegion(frame.width, frame.height, options.aspect);
  const scale = chipScale(region, options.size);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Source rectangle clipped to the frame; the destination shifts by the same amount.
  const sx = Math.max(0, region.x);
  const sy = Math.max(0, region.y);
  const ex = Math.min(frame.width, region.x + region.width);
  const ey = Math.min(frame.height, region.y + region.height);
  if (ex > sx && ey > sy) {
    const sw = ex - sx;
    const sh = ey - sy;
    ctx.drawImage(
      frame.source,
      sx,
      sy,
      sw,
      sh,
      (sx - region.x) * scale,
      (sy - region.y) * scale,
      sw * scale,
      sh * scale,
    );
  }
  if (options.outline && bounds) {
    const [x1, y1, x2, y2] = bounds;
    ctx.strokeStyle = options.outline;
    ctx.lineWidth = Math.max(1, Math.round(Math.max(canvas.width, canvas.height) / 160));
    ctx.strokeRect(
      (Math.min(x1, x2) - region.x) * scale,
      (Math.min(y1, y2) - region.y) * scale,
      Math.abs(x2 - x1) * scale,
      Math.abs(y2 - y1) * scale,
    );
  }
  const transform: ChipTransform = {
    region, scale, width: canvas.width, height: canvas.height,
  };
  // Upscaled crops hold few source pixels; keep them lossless so the little
  // detail there is does not pick up compression noise.
  const dataUrl = scale > 1
    ? canvas.toDataURL('image/png')
    : canvas.toDataURL('image/jpeg', options.quality ?? 0.92);
  return { dataUrl, transform };
}
