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
import { fromArrayBuffer, fromFile } from 'geotiff';
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
  sourceSizeX?: number;
  sourceSizeY?: number;
  tileWidth: number;
  tileHeight: number;
  levels: number;
  sourceLevels?: number;
  preconversionRequired?: boolean;
  error?: string;
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
  const maxLevel = Math.max(0, levels);
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
  for (let i = 0; i < ranges.length; i += 1) {
    const { level, maxX, maxY } = ranges[i];
    for (let x = 0; x <= maxX && tiles.length < limit; x += 1) {
      for (let y = 0; y <= maxY && tiles.length < limit; y += 1) {
        tiles.push({ z: level, x, y });
      }
    }
  }
  return tiles;
}

const LOG_PREFIX = '[tiles]';
const MAX_TILE_CACHE_ENTRIES = 256;
const TIFF_STAT_REFRESH_MS = 1000;
const DEFAULT_MAX_IN_MEMORY_TIFF_MB = 5120;
const PATH_CACHE_TTL_MS = 5000;
type RasterArray = Uint8Array | Uint16Array | Float32Array | Float64Array;

interface GeoTiffReadableImage {
  getWidth(): number;
  getHeight(): number;
  getSamplesPerPixel(): number;
  readRasters(options: Record<string, unknown>): Promise<unknown>;
  readRGB(options: Record<string, unknown>): Promise<unknown>;
}

interface GeoTiffReadable {
  getImage(index: number): Promise<GeoTiffReadableImage>;
  getImageCount?: () => Promise<number> | number;
}

interface TiffImageSource {
  index: number;
  image: GeoTiffReadableImage;
  width: number;
  height: number;
  overviewLevel: number;
  scaleX: number;
  scaleY: number;
  scale: number;
}

interface RawTiffImageEntry {
  index: number;
  image: GeoTiffReadableImage;
  width: number;
  height: number;
}

interface TiffContext {
  path: string;
  size: number;
  mtimeMs: number;
  inMemory: boolean;
  tiff: unknown;
  image: GeoTiffReadableImage;
  imageSources: TiffImageSource[];
  width: number;
  height: number;
  sourceMaxLevel: number;
  maxLevel: number;
  preconversionRequired: boolean;
  preconversionError: string | null;
}

let tiffContext: TiffContext | null = null;
let tiffContextPromise: Promise<TiffContext> | null = null;
let tiffContextStatCheckedAtMs = 0;
const datasetPathCache = new Map<string, { path: string | null; expiresAtMs: number }>();
const datasetPathPromiseCache = new Map<string, Promise<string | null>>();

const tilePngCache = new Map<string, Buffer>();

function touchTileCacheEntry(key: string, value: Buffer): void {
  if (tilePngCache.has(key)) {
    tilePngCache.delete(key);
  }
  tilePngCache.set(key, value);
  if (tilePngCache.size > MAX_TILE_CACHE_ENTRIES) {
    const oldestKey = tilePngCache.keys().next().value as string | undefined;
    if (oldestKey) {
      tilePngCache.delete(oldestKey);
    }
  }
}

function getTileCacheKey(path: string, level: number, x: number, y: number): string {
  return `${path}::${level}/${x}/${y}`;
}

function resetTileCacheForPath(path: string): void {
  const prefix = `${path}::`;
  const keys = Array.from(tilePngCache.keys());
  keys.forEach((key) => {
    if (key.startsWith(prefix)) {
      tilePngCache.delete(key);
    }
  });
}

function getCachedDatasetPath(datasetId: string): string | null | undefined {
  const now = Date.now();
  const hit = datasetPathCache.get(datasetId);
  if (!hit) return undefined;
  if (hit.expiresAtMs <= now) {
    datasetPathCache.delete(datasetId);
    return undefined;
  }
  return hit.path;
}

function setCachedDatasetPath(datasetId: string, path: string | null): void {
  datasetPathCache.set(datasetId, {
    path,
    expiresAtMs: Date.now() + PATH_CACHE_TTL_MS,
  });
}

function getMaxInMemoryTiffBytes(): number {
  const raw = process.env.MAX_IN_MEMORY_TIFF_MB;
  if (!raw || raw.trim() === '') {
    return DEFAULT_MAX_IN_MEMORY_TIFF_MB * 1024 * 1024;
  }
  const mb = Number(raw);
  if (!Number.isFinite(mb) || mb <= 0) {
    return 0;
  }
  return Math.floor(mb * 1024 * 1024);
}

function shouldLoadTiffInMemory(sizeBytes: number): boolean {
  if (process.env.TILES_FORCE_FILE_BACKED?.trim() === '1') {
    return false;
  }
  if (process.env.TILES_FORCE_IN_MEMORY?.trim() === '1') {
    return true;
  }
  return sizeBytes <= getMaxInMemoryTiffBytes();
}

async function loadTiffContext(path: string): Promise<TiffContext> {
  const stat = await fs.stat(path);
  const inMemory = shouldLoadTiffInMemory(stat.size);
  const tiff = inMemory
    ? await fs.readFile(path).then((buffer) => {
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
      return fromArrayBuffer(arrayBuffer);
    })
    // File-backed mode fetches bytes lazily and keeps process memory lower.
    : await fromFile(path);
  const tiffReadable = tiff as GeoTiffReadable;
  const imageCountRaw = tiffReadable.getImageCount ? await tiffReadable.getImageCount() : 1;
  const imageCount = Number.isFinite(imageCountRaw) ? Math.max(1, Math.floor(Number(imageCountRaw))) : 1;
  const rawImages: RawTiffImageEntry[] = [];
  for (let i = 0; i < imageCount; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const image = await tiffReadable.getImage(i);
    rawImages.push({
      index: i,
      image,
      width: image.getWidth(),
      height: image.getHeight(),
    });
  }
  // Use the largest IFD as full resolution; overviews are typically smaller.
  let fullRes = rawImages[0];
  for (let i = 1; i < rawImages.length; i += 1) {
    const candidate = rawImages[i];
    if ((candidate.width * candidate.height) > (fullRes.width * fullRes.height)) {
      fullRes = candidate;
    }
  }
  const { width, height } = fullRes;
  const theoreticalMaxLevel = Math.max(0, Math.ceil(Math.log2(Math.max(width / TILE_SIZE, height / TILE_SIZE))));
  const imageSources = buildAlignedImageSources(rawImages, fullRes);
  const maxAvailableScale = imageSources.length > 0
    ? imageSources[imageSources.length - 1].scale
    : 1;
  const availableMaxLevel = Math.max(0, Math.floor(Math.log2(Math.max(1, maxAvailableScale))));
  const maxLevel = Math.min(theoreticalMaxLevel, availableMaxLevel);
  const preconversionRequired = theoreticalMaxLevel > 0 && availableMaxLevel === 0;
  const preconversionError = preconversionRequired
    ? 'This large image is missing internal overview levels and must be pre-converted before viewing tiles. Please convert with GDAL (for example to a tiled pyramidal COG) and re-import.'
    : null;
  return {
    path,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    inMemory,
    tiff,
    image: fullRes.image,
    imageSources,
    width,
    height,
    sourceMaxLevel: theoreticalMaxLevel,
    maxLevel,
    preconversionRequired,
    preconversionError,
  };
}

function buildAlignedImageSources(rawImages: RawTiffImageEntry[], fullRes: RawTiffImageEntry): TiffImageSource[] {
  const fullResSamples = fullRes.image.getSamplesPerPixel();
  const aligned = rawImages.filter((entry) => {
    if (entry.width <= 0 || entry.height <= 0) return false;
    if (entry.width > fullRes.width || entry.height > fullRes.height) return false;
    if (entry.image.getSamplesPerPixel() !== fullResSamples) return false;
    const scaleX = fullRes.width / entry.width;
    const scaleY = fullRes.height / entry.height;
    const aspectDelta = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY, 1);
    return aspectDelta <= 0.03;
  });
  // Always include full-res source as a safe fallback.
  const withFallback = aligned.some((entry) => entry.index === fullRes.index)
    ? aligned
    : [...aligned, fullRes];
  const byOverviewLevel = new Map<number, TiffImageSource>();
  withFallback.forEach((entry) => {
    const rawScaleX = Math.max(1, fullRes.width / Math.max(1, entry.width));
    const rawScaleY = Math.max(1, fullRes.height / Math.max(1, entry.height));
    const rawScale = Math.max(rawScaleX, rawScaleY);
    const overviewLevel = Math.max(0, Math.round(Math.log2(rawScale)));
    const expectedScale = 2 ** overviewLevel;
    const scaleError = Math.max(
      Math.abs(rawScaleX - expectedScale) / expectedScale,
      Math.abs(rawScaleY - expectedScale) / expectedScale,
    );
    // Keep only pyramid-like levels; odd non-pyramid IFDs can cause visible tile seams.
    if (entry.index !== fullRes.index && scaleError > 0.12) {
      return;
    }
    const candidate: TiffImageSource = {
      index: entry.index,
      image: entry.image,
      width: entry.width,
      height: entry.height,
      overviewLevel,
      scaleX: rawScaleX,
      scaleY: rawScaleY,
      scale: expectedScale,
    };
    const existing = byOverviewLevel.get(overviewLevel);
    if (!existing) {
      byOverviewLevel.set(overviewLevel, candidate);
      return;
    }
    const existingError = Math.max(
      Math.abs(existing.scaleX - expectedScale) / expectedScale,
      Math.abs(existing.scaleY - expectedScale) / expectedScale,
    );
    // Prefer the source whose dimensions are closer to the expected pyramid level.
    if (scaleError < existingError) {
      byOverviewLevel.set(overviewLevel, candidate);
    }
  });
  if (!byOverviewLevel.has(0)) {
    byOverviewLevel.set(0, {
      index: fullRes.index,
      image: fullRes.image,
      width: fullRes.width,
      height: fullRes.height,
      overviewLevel: 0,
      scaleX: 1,
      scaleY: 1,
      scale: 1,
    });
  }
  return Array.from(byOverviewLevel.values()).sort((a, b) => a.overviewLevel - b.overviewLevel);
}

function pickImageSourceForScale(imageSources: TiffImageSource[], requestedScale: number): TiffImageSource {
  if (process.env.TILES_DISABLE_OVERVIEW_SELECTION?.trim() === '1') {
    return imageSources[0];
  }
  const target = Math.max(1, requestedScale);
  const targetOverviewLevel = Math.max(0, Math.round(Math.log2(target)));
  const exact = imageSources.find((source) => source.overviewLevel === targetOverviewLevel);
  if (exact) {
    return exact;
  }
  // Prefer finer-than-requested sources (avoid upscaling when no exact level exists).
  let best = imageSources[0];
  let bestLevel = -1;
  for (let i = 0; i < imageSources.length; i += 1) {
    const source = imageSources[i];
    if (source.overviewLevel <= targetOverviewLevel && source.overviewLevel > bestLevel) {
      best = source;
      bestLevel = source.overviewLevel;
    }
  }
  if (bestLevel >= 0) {
    return best;
  }
  // Fallback: no finer level exists, use the nearest coarser one.
  for (let i = 0; i < imageSources.length; i += 1) {
    const source = imageSources[i];
    if (source.overviewLevel > targetOverviewLevel) {
      return source;
    }
  }
  return imageSources[imageSources.length - 1];
}

async function getCachedTiffContext(path: string): Promise<TiffContext> {
  const now = Date.now();
  if (
    tiffContext
    && tiffContext.path === path
    && now - tiffContextStatCheckedAtMs < TIFF_STAT_REFRESH_MS
  ) {
    return tiffContext;
  }
  const stat = await fs.stat(path);
  tiffContextStatCheckedAtMs = now;
  const cacheValid = tiffContext
    && tiffContext.path === path
    && tiffContext.size === stat.size
    && tiffContext.mtimeMs === stat.mtimeMs;

  if (cacheValid && tiffContext) {
    return tiffContext;
  }

  if (!tiffContextPromise) {
    tiffContextPromise = loadTiffContext(path).then((ctx) => {
      const pathChanged = tiffContext && tiffContext.path !== ctx.path;
      const fileChanged = tiffContext
        && tiffContext.path === ctx.path
        && (tiffContext.size !== ctx.size || tiffContext.mtimeMs !== ctx.mtimeMs);
      if (pathChanged || fileChanged) {
        resetTileCacheForPath(ctx.path);
      }
      tiffContext = ctx;
      return ctx;
    }).finally(() => {
      tiffContextPromise = null;
    });
  }

  return tiffContextPromise;
}

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
  const cachedPath = getCachedDatasetPath(datasetId);
  if (cachedPath !== undefined) {
    return Promise.resolve(cachedPath);
  }
  const inFlight = datasetPathPromiseCache.get(datasetId);
  if (inFlight) {
    return inFlight;
  }
  const lookupPromise = getLargeImagePath(settings, datasetId)
    .then((path) => {
      setCachedDatasetPath(datasetId, path);
      return path;
    })
    .finally(() => {
      datasetPathPromiseCache.delete(datasetId);
    });
  datasetPathPromiseCache.set(datasetId, lookupPromise);
  return lookupPromise;
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
  try {
    const ctx = await getCachedTiffContext(tiffPath);
    const {
      width,
      height,
      maxLevel,
      sourceMaxLevel,
      preconversionRequired,
      preconversionError,
    } = ctx;
    const levelCount = maxLevel + 1;
    const sourceLevelCount = sourceMaxLevel + 1;
    // geoJS pixelCoordinateParams uses maxLevel = ceil(log2(max(w/256, h/256))); level 0 = overview, maxLevel = full res.
    const tileRanges = getValidTileRanges(width, height, maxLevel);
    const validTileList = getValidTileList(width, height, maxLevel, 10000);
    console.log(`${LOG_PREFIX} getTilesMetadata: success width=${width} height=${height} maxLevel=${maxLevel} sourceMaxLevel=${sourceMaxLevel} preconversionRequired=${preconversionRequired} validTileList.length=${validTileList.length}`);
    return {
      sizeX: width,
      sizeY: height,
      sourceSizeX: width,
      sourceSizeY: height,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      levels: levelCount,
      sourceLevels: sourceLevelCount,
      preconversionRequired,
      error: preconversionError ?? undefined,
      tileRanges,
      validTileList,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      console.warn(`${LOG_PREFIX} getTilesMetadata: file does not exist for dataset "${datasetId}": ${tiffPath}`);
      return null;
    }
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
  try {
    const ctx = await getCachedTiffContext(tiffPath);
    const {
      width,
      height,
      maxLevel,
      imageSources,
    } = ctx;
    const tileCacheKey = getTileCacheKey(tiffPath, level, x, y);
    const cached = tilePngCache.get(tileCacheKey);
    if (cached) {
      touchTileCacheEntry(tileCacheKey, cached);
      return cached;
    }
    // geoJS uses level 0 = overview (fewest tiles), maxLevel = full res (most tiles).
    // tilesAtZoom(level): scale = 2^(maxLevel - level). Match that here.
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
    const source = pickImageSourceForScale(imageSources, scale);
    const sourceLeft = Math.min(source.width, Math.max(0, Math.floor(left / source.scaleX)));
    const sourceTop = Math.min(source.height, Math.max(0, Math.floor(top / source.scaleY)));
    const sourceRight = Math.min(source.width, Math.max(sourceLeft + 1, Math.ceil(right / source.scaleX)));
    const sourceBottom = Math.min(source.height, Math.max(sourceTop + 1, Math.ceil(bottom / source.scaleY)));
    const sourceWindow = [sourceLeft, sourceTop, sourceRight, sourceBottom] as [number, number, number, number];
    const sourceImage = source.image;
    if (process.env.DEBUG_TILE_PATH) {
      console.log(`${LOG_PREFIX} getTilePng: level=${level} maxLevel=${maxLevel} scale=${scale} x=${x} y=${y} window=[${left},${top},${right},${bottom}] sourceIFD=${source.index} sourceScale=${source.scale.toFixed(2)} sourceWindow=[${sourceLeft},${sourceTop},${sourceRight},${sourceBottom}] image=${width}x${height}`);
    }
    const opts = {
      window: sourceWindow,
      width: TILE_SIZE,
      height: TILE_SIZE,
      resampleMethod: 'bilinear' as const,
    };
    const expectedPixels = TILE_SIZE * TILE_SIZE;
    const rgba = new Uint8Array(expectedPixels * 4);
    for (let i = 3; i < rgba.length; i += 4) {
      rgba[i] = 255;
    }

    const sampleCount = sourceImage.getSamplesPerPixel();
    try {
      if (sampleCount >= 3) {
        const rgbInterleaved = await sourceImage.readRasters({
          ...opts,
          samples: [0, 1, 2],
          interleave: true,
        } as Record<string, unknown>) as RasterArray;
        normalizeInterleavedRgbToRgba(rgbInterleaved, rgba, expectedPixels);
      } else {
        const rasters = await sourceImage.readRasters({
          ...opts,
          samples: [0],
          interleave: false,
        } as Record<string, unknown>) as RasterArray[];
        const gray = (rasters[0] ?? new Uint8Array(0)) as RasterArray;
        normalizeGrayToRgba(gray, rgba, expectedPixels);
      }
      if (process.env.DEBUG_TILE_PATH) {
        console.log(`${LOG_PREFIX} getTilePng: readRasters samples=${sampleCount} rgba length=${rgba.length}`);
      }
    } catch (readErr) {
      if (process.env.DEBUG_TILE_PATH) {
        console.warn(`${LOG_PREFIX} getTilePng: readRasters failed, trying readRGB:`, readErr);
      }
      try {
        const rgb = await sourceImage.readRGB(opts as Record<string, unknown>);
        fillRgbaFromReadRgbResult(rgb, rgba, expectedPixels);
      } catch {
        throw readErr;
      }
    }
    const pngBuffer = encodePngRgba(TILE_SIZE, TILE_SIZE, rgba);
    if (process.env.DEBUG_TILE_PATH) {
      console.log(`${LOG_PREFIX} getTilePng: encodePng done, buffer length=${pngBuffer.length}`);
    }
    touchTileCacheEntry(tileCacheKey, pngBuffer);
    return pngBuffer;
  } catch (err) {
    // LZW/geotiff decode errors (e.g. "ran off the end of the buffer before
    // finding EOI_CODE") or other tile read failures: treat as missing tile.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      console.warn(`${LOG_PREFIX} getTilePng: file does not exist for dataset "${datasetId}" (level=${level}, x=${x}, y=${y}): ${tiffPath}`);
      return null;
    }
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
  const outView = out;
  if (raw instanceof Uint8Array && offset === 0 && stride === 1 && n === out.length) {
    outView.set(raw.subarray(0, n));
    return;
  }
  let min = raw[0];
  let max = raw[0];
  for (let i = 1; i < n; i += 1) {
    const v = raw[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  if (range <= 0 || !Number.isFinite(range)) {
    for (let i = 0; i < n; i += 1) {
      outView[offset + i * stride] = 0;
    }
    return;
  }
  const scale = 255 / range;
  for (let i = 0; i < n; i += 1) {
    outView[offset + i * stride] = Math.round((Number(raw[i]) - min) * scale);
  }
}

function normalizeInterleavedRgbToRgba(
  raw: Uint8Array | Uint16Array | Float32Array | Float64Array,
  outRgba: Uint8Array,
  pixelCount: number,
): void {
  if (pixelCount <= 0 || raw.length < 3) return;
  const out = outRgba;
  const n = Math.min(pixelCount, Math.floor(raw.length / 3));
  if (raw instanceof Uint8Array) {
    for (let i = 0; i < n; i += 1) {
      const src = i * 3;
      const dst = i * 4;
      out[dst] = raw[src];
      out[dst + 1] = raw[src + 1] ?? raw[src];
      out[dst + 2] = raw[src + 2] ?? raw[src];
    }
    return;
  }
  let rMin = Number(raw[0]);
  let rMax = rMin;
  let gMin = Number(raw[1] ?? raw[0]);
  let gMax = gMin;
  let bMin = Number(raw[2] ?? raw[0]);
  let bMax = bMin;
  for (let i = 0; i < n; i += 1) {
    const base = i * 3;
    const r = Number(raw[base]);
    const g = Number(raw[base + 1] ?? r);
    const b = Number(raw[base + 2] ?? r);
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  const rScale = rMax > rMin ? 255 / (rMax - rMin) : 0;
  const gScale = gMax > gMin ? 255 / (gMax - gMin) : 0;
  const bScale = bMax > bMin ? 255 / (bMax - bMin) : 0;
  for (let i = 0; i < n; i += 1) {
    const src = i * 3;
    const dst = i * 4;
    out[dst] = rScale ? Math.round((Number(raw[src]) - rMin) * rScale) : 0;
    out[dst + 1] = gScale ? Math.round((Number(raw[src + 1] ?? raw[src]) - gMin) * gScale) : 0;
    out[dst + 2] = bScale ? Math.round((Number(raw[src + 2] ?? raw[src]) - bMin) * bScale) : 0;
  }
}

function normalizeGrayToRgba(
  raw: Uint8Array | Uint16Array | Float32Array | Float64Array,
  outRgba: Uint8Array,
  pixelCount: number,
): void {
  if (pixelCount <= 0 || raw.length === 0) return;
  const out = outRgba;
  const n = Math.min(pixelCount, raw.length);
  if (raw instanceof Uint8Array) {
    for (let i = 0; i < n; i += 1) {
      const dst = i * 4;
      const v = raw[i];
      out[dst] = v;
      out[dst + 1] = v;
      out[dst + 2] = v;
    }
    return;
  }
  normalizeToU8(raw, outRgba, 0, 4);
  for (let i = 0; i < pixelCount; i += 1) {
    const dst = i * 4;
    const v = out[dst];
    out[dst + 1] = v;
    out[dst + 2] = v;
  }
}

function fillRgbaFromReadRgbResult(
  rgb: unknown,
  outRgba: Uint8Array,
  pixelCount: number,
): void {
  const rgbBands = rgb as { [0]?: RasterArray; [1]?: RasterArray; [2]?: RasterArray };
  if (rgb && rgbBands[0] !== undefined && rgbBands[1] !== undefined && rgbBands[2] !== undefined) {
    normalizeToU8(rgbBands[0], outRgba, 0, 4);
    normalizeToU8(rgbBands[1], outRgba, 1, 4);
    normalizeToU8(rgbBands[2], outRgba, 2, 4);
    return;
  }
  const raw = rgb as RasterArray | undefined;
  if (!raw || raw.length === 0) return;
  if (raw.length >= pixelCount * 3) {
    normalizeInterleavedRgbToRgba(raw, outRgba, pixelCount);
  } else {
    normalizeGrayToRgba(raw, outRgba, pixelCount);
  }
}

function encodePngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  const png = new PNG({ width, height });
  png.data.set(rgba);
  return PNG.sync.write(png);
}
