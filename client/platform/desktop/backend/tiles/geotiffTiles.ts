/**
 * Serve large image (GeoTIFF) tiles using geotiff.js.
 * Compatible with LargeImageAnnotator's getTiles/getTileURL expectations.
 *
 * Inspired by https://github.com/rowanwins/geotiff-server:
 * - Uses image-space (pixel) window for readRasters, not bbox.
 * - Normalizes 16-bit/float data to 0-255 for display (min-max or percentile-style).
 * - Handles single-band (grayscale) by replicating to R=G=B.
 *
 * Geospatial metadata in the file is not used for tiling.
 */

import fs from 'fs-extra';
import { fromArrayBuffer } from 'geotiff';
import { PNG } from 'pngjs';
import type { Settings } from 'platform/desktop/constants';
import { getLargeImagePath } from '../native/common';

const TILE_SIZE = 256;

export interface TileRange {
  level: number;
  maxX: number;
  maxY: number;
}

export interface TilesMetadata {
  sizeX: number;
  sizeY: number;
  tileWidth: number;
  tileHeight: number;
  levels: number;
  /** Valid tile indices per level: for each level, x in [0, maxX], y in [0, maxY]. */
  tileRanges: TileRange[];
  /** List of valid { z, x, y } tile coordinates (capped by default limit). */
  validTileList: { z: number; x: number; y: number }[];
}

/**
 * Compute valid tile index ranges from image dimensions and level count.
 * Uses geoJS convention: level 0 = overview (scale 2^maxLevel), level maxLevel = full res (scale 1).
 * At geoJS level L, scale = 2^(maxLevel - L); valid x in [0, maxX], y in [0, maxY].
 */
export function getValidTileRanges(
  sizeX: number,
  sizeY: number,
  levels: number,
): TileRange[] {
  const ranges: TileRange[] = [];
  const maxLevel = Math.ceil(Math.log2(Math.max(sizeX / TILE_SIZE, sizeY / TILE_SIZE)));
  for (let level = 0; level <= maxLevel; level += 1) {
    const scale = 2 ** (maxLevel - level);
    const maxX = Math.max(0, Math.ceil(sizeX / (TILE_SIZE * scale)) - 1);
    const maxY = Math.max(0, Math.ceil(sizeY / (TILE_SIZE * scale)) - 1);
    ranges.push({ level, maxX, maxY });
  }
  return ranges;
}

/**
 * Build a list of valid { z, x, y } tile coordinates, optionally capped.
 * @param limit max number of tiles to return (default 10000); omit for no cap
 */
export function getValidTileList(
  sizeX: number,
  sizeY: number,
  levels: number,
  limit = 10000,
): { z: number; x: number; y: number }[] {
  const ranges = getValidTileRanges(sizeX, sizeY, levels);
  const tiles: { z: number; x: number; y: number }[] = [];
  for (const { level, maxX, maxY } of ranges) {
    for (let x = 0; x <= maxX && tiles.length < limit; x += 1) {
      for (let y = 0; y <= maxY && tiles.length < limit; y += 1) {
        tiles.push({ z: level, x, y });
      }
    }
  }
  return tiles;
}

const LOG_PREFIX = '[tiles]';

/** If set (e.g. DEBUG_TILE_PATH=/path/to/lake.tiff), use this path for all tile requests (for debugging). */
function getEffectiveTiffPath(
  settings: Settings,
  datasetId: string,
): Promise<string | null> {
  const debugPath = process.env.DEBUG_TILE_PATH?.trim();
  if (debugPath) {
    return fs.pathExists(debugPath).then((exists) => {
      if (exists) {
        console.log(`${LOG_PREFIX} using DEBUG_TILE_PATH: ${debugPath} (datasetId=${datasetId})`);
        return debugPath;
      }
      console.warn(`${LOG_PREFIX} DEBUG_TILE_PATH set but file does not exist: ${debugPath}`);
      return null;
    });
  }
  return getLargeImagePath(settings, datasetId);
}

/**
 * Get tile metadata for a large-image dataset (compatible with Girder large_image response).
 * Returns null if the file is missing or invalid (e.g. LZW decode issues).
 */
export async function getTilesMetadata(
  settings: Settings,
  datasetId: string,
): Promise<TilesMetadata | null> {
  console.log(`${LOG_PREFIX} getTilesMetadata: datasetId="${datasetId}"`);
  const tiffPath = await getEffectiveTiffPath(settings, datasetId);
  if (!tiffPath) {
    console.warn(`${LOG_PREFIX} getTilesMetadata: no large-image path for dataset "${datasetId}" (not large-image or missing originalLargeImageFile in meta)`);
    return null;
  }
  if (!(await fs.pathExists(tiffPath))) {
    console.warn(`${LOG_PREFIX} getTilesMetadata: file does not exist for dataset "${datasetId}": ${tiffPath}`);
    return null;
  }
  try {
    console.log(`${LOG_PREFIX} getTilesMetadata: reading file (${tiffPath.length} chars path)`);
    const buffer = await fs.readFile(tiffPath);
    console.log(`${LOG_PREFIX} getTilesMetadata: file size ${buffer.length} bytes`);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage(0);
    const width = image.getWidth();
    const height = image.getHeight();
    // geoJS pixelCoordinateParams uses maxLevel = ceil(log2(max(w/256, h/256))); level 0 = overview, maxLevel = full res.
    const maxLevel = Math.max(0, Math.ceil(Math.log2(Math.max(width / TILE_SIZE, height / TILE_SIZE))));
    const tileRanges = getValidTileRanges(width, height, maxLevel);
    const validTileList = getValidTileList(width, height, maxLevel, 10000);
    console.log(`${LOG_PREFIX} getTilesMetadata: success width=${width} height=${height} maxLevel=${maxLevel} validTileList.length=${validTileList.length}`);
    return {
      sizeX: width,
      sizeY: height,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      levels: maxLevel,
      tileRanges,
      validTileList,
    };
  } catch (err) {
    console.error(`${LOG_PREFIX} getTilesMetadata: failed to read/parse GeoTIFF for dataset "${datasetId}" (${tiffPath}):`, err);
    return null;
  }
}

/**
 * Get a single tile as PNG buffer for level, x, y.
 * Returns null on decode errors (e.g. LZW "ran off the end of the buffer" in
 * geotiff.js for truncated or malformed GeoTIFF strips).
 */
export async function getTilePng(
  settings: Settings,
  datasetId: string,
  level: number,
  x: number,
  y: number,
): Promise<Buffer | null> {
  const tiffPath = await getEffectiveTiffPath(settings, datasetId);
  if (!tiffPath) {
    console.warn(`${LOG_PREFIX} getTilePng: no large-image path for dataset "${datasetId}" (level=${level}, x=${x}, y=${y})`);
    return null;
  }
  if (!(await fs.pathExists(tiffPath))) {
    console.warn(`${LOG_PREFIX} getTilePng: file does not exist for dataset "${datasetId}" (level=${level}, x=${x}, y=${y}): ${tiffPath}`);
    return null;
  }
  try {
    const buffer = await fs.readFile(tiffPath);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );
    const tiff = await fromArrayBuffer(arrayBuffer);
    const image = await tiff.getImage(0);
    const width = image.getWidth();
    const height = image.getHeight();
    // geoJS uses level 0 = overview (fewest tiles), maxLevel = full res (most tiles).
    // tilesAtZoom(level): scale = 2^(maxLevel - level). Match that here.
    const maxLevel = Math.ceil(Math.log2(Math.max(width / TILE_SIZE, height / TILE_SIZE)));
    const levelClamped = Math.max(0, Math.min(level, maxLevel));
    const scale = 2 ** (maxLevel - levelClamped);
    const left = Math.min(x * TILE_SIZE * scale, width);
    const top = Math.min(y * TILE_SIZE * scale, height);
    const right = Math.min((x + 1) * TILE_SIZE * scale, width);
    const bottom = Math.min((y + 1) * TILE_SIZE * scale, height);
    if (left >= right || top >= bottom) {
      console.warn(`${LOG_PREFIX} getTilePng: tile window out of bounds for dataset "${datasetId}" level=${level} x=${x} y=${y} (image ${width}x${height}, window [${left},${top},${right},${bottom}])`);
      return null;
    }
    // Image-space pixel window [left, top, right, bottom]; not bbox (geospatial).
    const window = [left, top, right, bottom] as [number, number, number, number];
    if (process.env.DEBUG_TILE_PATH) {
      console.log(`${LOG_PREFIX} getTilePng: level=${level} maxLevel=${maxLevel} scale=${scale} x=${x} y=${y} window=[${left},${top},${right},${bottom}] image=${width}x${height}`);
    }
    const opts = {
      window,
      width: TILE_SIZE,
      height: TILE_SIZE,
      resampleMethod: 'bilinear' as const,
    };
    const expectedPixels = TILE_SIZE * TILE_SIZE;
    const expected = expectedPixels * 3;
    const data = new Uint8Array(expected);

    const sampleCount = image.getSamplesPerPixel();
    type RasterArray = Uint8Array | Uint16Array | Float32Array | Float64Array;
    try {
      if (sampleCount >= 3) {
        const rasters = await image.readRasters({
          ...opts,
          samples: [0, 1, 2],
          interleave: false,
        }) as RasterArray[];
        const r = (rasters[0] ?? new Uint8Array(0)) as RasterArray;
        const g = (rasters[1] ?? r) as RasterArray;
        const b = (rasters[2] ?? r) as RasterArray;
        const r8 = new Uint8Array(expectedPixels);
        const g8 = new Uint8Array(expectedPixels);
        const b8 = new Uint8Array(expectedPixels);
        normalizeToU8(r, r8);
        normalizeToU8(g, g8);
        normalizeToU8(b, b8);
        for (let i = 0; i < expectedPixels; i += 1) {
          data[i * 3] = r8[i];
          data[i * 3 + 1] = g8[i];
          data[i * 3 + 2] = b8[i];
        }
      } else {
        const rasters = await image.readRasters({
          ...opts,
          samples: [0],
          interleave: false,
        }) as RasterArray[];
        const gray = (rasters[0] ?? new Uint8Array(0)) as RasterArray;
        const g8 = new Uint8Array(expectedPixels);
        normalizeToU8(gray, g8);
        for (let i = 0; i < expectedPixels; i += 1) {
          const v = g8[i];
          data[i * 3] = v;
          data[i * 3 + 1] = v;
          data[i * 3 + 2] = v;
        }
      }
      if (process.env.DEBUG_TILE_PATH) {
        console.log(`${LOG_PREFIX} getTilePng: readRasters samples=${sampleCount} data length=${data.length}`);
      }
    } catch (readErr) {
      if (process.env.DEBUG_TILE_PATH) {
        console.warn(`${LOG_PREFIX} getTilePng: readRasters failed, trying readRGB:`, readErr);
      }
      try {
        const rgb = await image.readRGB(opts);
        const rgbBands = rgb as unknown as { [0]: RasterArray; [1]: RasterArray; [2]: RasterArray };
        if (rgb && rgbBands[0] !== undefined && rgbBands[1] !== undefined && rgbBands[2] !== undefined) {
          const r8 = new Uint8Array(expectedPixels);
          const g8 = new Uint8Array(expectedPixels);
          const b8 = new Uint8Array(expectedPixels);
          normalizeToU8(rgbBands[0], r8);
          normalizeToU8(rgbBands[1], g8);
          normalizeToU8(rgbBands[2], b8);
          for (let i = 0; i < expectedPixels; i += 1) {
            data[i * 3] = r8[i];
            data[i * 3 + 1] = g8[i];
            data[i * 3 + 2] = b8[i];
          }
        } else {
          const raw = (rgb as unknown as Uint8Array);
          if (raw && raw.length >= expected) {
            data.set(raw.subarray(0, expected));
          } else if (raw && raw.length > 0) {
            const g8 = new Uint8Array(expectedPixels);
            normalizeToU8(raw as RasterArray, g8);
            for (let i = 0; i < expectedPixels; i += 1) {
              const v = g8[i];
              data[i * 3] = v;
              data[i * 3 + 1] = v;
              data[i * 3 + 2] = v;
            }
          }
        }
      } catch {
        throw readErr;
      }
    }
    const pngBuffer = encodePng(TILE_SIZE, TILE_SIZE, data);
    if (process.env.DEBUG_TILE_PATH) {
      console.log(`${LOG_PREFIX} getTilePng: encodePng done, buffer length=${pngBuffer.length}`);
    }
    return pngBuffer;
  } catch (err) {
    // LZW/geotiff decode errors (e.g. "ran off the end of the buffer before
    // finding EOI_CODE") or other tile read failures: treat as missing tile.
    console.error(`${LOG_PREFIX} getTilePng: failed to read tile for dataset "${datasetId}" level=${level} x=${x} y=${y} (${tiffPath}):`, err);
    return null;
  }
}

/**
 * Normalize raw raster values to 0-255 for display.
 * Handles 16-bit, float, or narrow 8-bit range (like geotiff-server pMin/pMax).
 */
function normalizeToU8(
  raw: Uint8Array | Uint16Array | Float32Array | Float64Array,
  out: Uint8Array,
  offset = 0,
  stride = 1,
): void {
  const n = Math.min(raw.length, Math.floor((out.length - offset) / stride));
  if (n === 0) return;
  let min = raw[0];
  let max = raw[0];
  for (let i = 1; i < n; i += 1) {
    const v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  for (let i = 0; i < n; i += 1) {
    const v = (Number(raw[i]) - min) / range;
    out[offset + i * stride] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
}

function interleaveRgb(r: Uint8Array, g: Uint8Array, b: Uint8Array): Uint8Array {
  const n = r.length;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    out[i * 3] = r[i];
    out[i * 3 + 1] = g[i];
    out[i * 3 + 2] = b[i];
  }
  return out;
}

function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = rgb[i * 3];
    png.data[i * 4 + 1] = rgb[i * 3 + 1];
    png.data[i * 4 + 2] = rgb[i * 3 + 2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}
