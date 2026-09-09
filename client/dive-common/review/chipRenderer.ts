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
  /** Output edge length in pixels. */
  size: number;
  /** Box outline colour; omit to draw no outline. */
  outline?: string;
  /** JPEG quality. */
  quality?: number;
}

/** Square crop region (may extend past the image) for a box with padding. */
export function chipRegion(bounds: RectBounds, padding: number): { x: number; y: number; side: number } {
  const [x1, y1, x2, y2] = bounds;
  const w = Math.max(1, Math.abs(x2 - x1));
  const h = Math.max(1, Math.abs(y2 - y1));
  const side = Math.max(w, h) * (1 + 2 * Math.max(0, padding));
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  return { x: cx - side / 2, y: cy - side / 2, side };
}

/** Pixel sizes chips are rendered at; cells pick the smallest that covers them. */
export const CHIP_SIZE_BUCKETS = [128, 192, 256, 384, 512, 768];

export function chipSizeFor(cellPixels: number): number {
  const wanted = Math.ceil(cellPixels);
  return CHIP_SIZE_BUCKETS.find((size) => size >= wanted) ?? CHIP_SIZE_BUCKETS[CHIP_SIZE_BUCKETS.length - 1];
}

export function renderChip(frame: DecodedFrame, bounds: RectBounds, options: ChipRenderOptions): string {
  const region = chipRegion(bounds, options.padding);
  // Never upscale source pixels beyond 1:1 more than the bucket asks for.
  const size = Math.max(16, Math.round(Math.min(options.size, Math.max(region.side, 16))));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#101010';
  ctx.fillRect(0, 0, size, size);
  const scale = size / region.side;
  // Source rectangle clipped to the frame; the destination shifts by the same amount.
  const sx = Math.max(0, region.x);
  const sy = Math.max(0, region.y);
  const ex = Math.min(frame.width, region.x + region.side);
  const ey = Math.min(frame.height, region.y + region.side);
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
  if (options.outline) {
    const [x1, y1, x2, y2] = bounds;
    ctx.strokeStyle = options.outline;
    ctx.lineWidth = Math.max(1, Math.round(size / 160));
    ctx.strokeRect(
      (Math.min(x1, x2) - region.x) * scale,
      (Math.min(y1, y2) - region.y) * scale,
      Math.abs(x2 - x1) * scale,
      Math.abs(y2 - y1) * scale,
    );
  }
  return canvas.toDataURL('image/jpeg', options.quality ?? 0.85);
}
