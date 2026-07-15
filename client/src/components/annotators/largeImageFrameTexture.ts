import type { CameraImage } from '../../layers/cameraImage';

/** Long-edge cap for warp/ghost textures (keeps memory bounded for multi-GB TIFFs). */
export const MAX_FRAME_TEXTURE_EDGE = 2048;

export interface LargeImageTextureMeta {
  sizeX: number;
  sizeY: number;
  tileWidth: number;
  tileHeight: number;
  /**
   * Girder / desktop `levels` count (maxLevel + 1). GeoJS uses level 0 as the
   * coarsest overview and maxLevel as full resolution.
   */
  levels: number;
}

export interface ComposeLargeImageFrameTextureOptions {
  meta: LargeImageTextureMeta;
  /** Build a tile URL for geoJS (z, x, y) = (level, x, y). */
  getTileURL: (x: number, y: number, level: number) => string;
  maxEdge?: number;
  signal?: AbortSignal;
  /**
   * Optional tile loader (defaults to credentialed fetch + createImageBitmap).
   * Injected in tests.
   */
  loadTile?: (url: string, signal?: AbortSignal) => Promise<CanvasImageSource>;
}

export interface OverviewLevel {
  level: number;
  scale: number;
  outWidth: number;
  outHeight: number;
  tilesX: number;
  tilesY: number;
}

/**
 * Choose the finest overview whose rendered long edge is <= maxEdge.
 * Warp quads still use native sizeX/sizeY; the canvas is stretched to fill them.
 */
export function pickOverviewLevel(
  meta: LargeImageTextureMeta,
  maxEdge = MAX_FRAME_TEXTURE_EDGE,
): OverviewLevel {
  const maxLevel = Math.max(0, meta.levels - 1);
  const {
    sizeX, sizeY, tileWidth, tileHeight,
  } = meta;
  const makeLevel = (level: number): OverviewLevel => {
    const scale = 2 ** (maxLevel - level);
    return {
      level,
      scale,
      outWidth: Math.max(1, Math.ceil(sizeX / scale)),
      outHeight: Math.max(1, Math.ceil(sizeY / scale)),
      tilesX: Math.max(1, Math.ceil(sizeX / (tileWidth * scale))),
      tilesY: Math.max(1, Math.ceil(sizeY / (tileHeight * scale))),
    };
  };
  // Prefer the finest overview that still fits under the long-edge cap.
  for (let level = maxLevel; level >= 0; level -= 1) {
    const candidate = makeLevel(level);
    if (Math.max(candidate.outWidth, candidate.outHeight) <= maxEdge) {
      return candidate;
    }
  }
  return makeLevel(0);
}

async function defaultLoadTile(url: string, signal?: AbortSignal): Promise<CanvasImageSource> {
  const resp = await fetch(url, { credentials: 'include', signal });
  if (!resp.ok) {
    throw new Error(`Failed to load large-image tile (${resp.status}): ${url}`);
  }
  const blob = await resp.blob();
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to decode large-image tile: ${url}`));
    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Composite an overview of the current large-image frame into a canvas usable as
 * a geoJS quad texture (Align View warp / registration ghost).
 *
 * Returned width/height are the **native** image dimensions so warp math stays
 * in the same space as registration points; the canvas itself may be smaller.
 */
export async function composeLargeImageFrameTexture(
  options: ComposeLargeImageFrameTextureOptions,
): Promise<CameraImage> {
  const {
    meta,
    getTileURL,
    maxEdge = MAX_FRAME_TEXTURE_EDGE,
    signal,
    loadTile = defaultLoadTile,
  } = options;
  const overview = pickOverviewLevel(meta, maxEdge);
  const canvas = document.createElement('canvas');
  canvas.width = overview.outWidth;
  canvas.height = overview.outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create 2d canvas context for large-image frame texture');
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const { tileWidth, tileHeight } = meta;
  const loads: Promise<void>[] = [];
  for (let ty = 0; ty < overview.tilesY; ty += 1) {
    for (let tx = 0; tx < overview.tilesX; tx += 1) {
      const url = getTileURL(tx, ty, overview.level);
      loads.push(
        loadTile(url, signal).then((tile) => {
          if (signal?.aborted) {
            return;
          }
          ctx.drawImage(tile, tx * tileWidth, ty * tileHeight);
        }),
      );
    }
  }
  await Promise.all(loads);
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  return {
    source: canvas,
    kind: 'image',
    width: meta.sizeX,
    height: meta.sizeY,
  };
}
