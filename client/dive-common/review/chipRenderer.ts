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

export function renderChip(
  frame: DecodedFrame,
  bounds: RectBounds | null,
  options: ChipRenderOptions,
): string {
  const region = bounds
    ? chipRegion(bounds, options.padding, options.aspect)
    : frameRegion(frame.width, frame.height, options.aspect);
  const longest = Math.max(region.width, region.height);
  // Never upscale source pixels beyond 1:1 more than the bucket asks for.
  const scale = Math.max(16, Math.min(options.size, Math.max(longest, 16))) / longest;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(region.width * scale));
  canvas.height = Math.max(1, Math.round(region.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
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
  return canvas.toDataURL('image/jpeg', options.quality ?? 0.85);
}
