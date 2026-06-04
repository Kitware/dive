import fs from 'fs-extra';
import { fromArrayBuffer } from 'geotiff';
import PNG from 'pngjs';

type RasterArray = Uint8Array | Uint16Array | Float32Array | Float64Array;

interface TiffImage {
  getWidth(): number;
  getHeight(): number;
  readRasters(opts: Record<string, unknown>): Promise<unknown>;
}
interface TiffFile {
  getImage(index?: number): Promise<TiffImage>;
}

const MAX_DISPLAY_CACHE_ENTRIES = 64;

const displayPngCache = new Map<string, Buffer>();

function touchDisplayCacheEntry(key: string, value: Buffer): void {
  displayPngCache.delete(key);
  displayPngCache.set(key, value);
  if (displayPngCache.size > MAX_DISPLAY_CACHE_ENTRIES) {
    const oldest = displayPngCache.keys().next().value as string | undefined;
    if (oldest) displayPngCache.delete(oldest);
  }
}

/** Map raster samples to display bytes by clamping to [0, 255] (no dynamic range stretch). */
export function normalizeToU8(
  raw: RasterArray,
  out: Uint8Array,
  offset = 0,
  stride = 1,
): void {
  const n = Math.min(raw.length, Math.floor((out.length - offset) / stride));
  if (n === 0) return;
  const outView = out;
  for (let i = 0; i < n; i += 1) {
    outView[offset + i * stride] = Math.max(0, Math.min(255, Math.round(Number(raw[i]))));
  }
}

/** Linearly stretch raster values from [min, max] to [0, 255]. */
export function linearStretchToU8(
  raw: RasterArray,
  min: number,
  max: number,
): Uint8Array {
  const out = new Uint8Array(raw.length);
  const range = max - min;
  if (range <= 0) {
    out.fill(128); // flat field — no contrast, display as mid-gray
    return out;
  }
  for (let i = 0; i < raw.length; i += 1) {
    const v = (Number(raw[i]) - min) / range;
    out[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Buffer {
  type PngInstance = { data: Uint8Array };
  type PngConstructor = {
    new(opts: { width: number; height: number }): PngInstance;
    sync: { write(png: PngInstance): Buffer };
  };
  const pngModule = PNG as unknown as { PNG?: PngConstructor };
  const PngCtor = pngModule.PNG ?? (PNG as unknown as PngConstructor);
  const png = new PngCtor({ width, height });
  png.data.set(rgba);
  return PngCtor.sync.write(png);
}

function encodeGrayscalePng(pixels: Uint8Array, width: number, height: number): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 1) {
    const v = pixels[i];
    const dst = i * 4;
    rgba[dst] = v;
    rgba[dst + 1] = v;
    rgba[dst + 2] = v;
    rgba[dst + 3] = 255;
  }
  return encodePngRgba(width, height, rgba);
}

async function openTiff(tiffPath: string): Promise<TiffFile> {
  const buf = await fs.readFile(tiffPath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return fromArrayBuffer(ab) as unknown as TiffFile;
}

/** Find the pixel values at lowPercentile and highPercentile within a single band. */
function computeFrameBounds(
  band: RasterArray,
  lowPercentile: number,
  highPercentile: number,
): { min: number; max: number } {
  if (band.length === 0) return { min: 0, max: 65535 };

  // Float rasters can have arbitrary value ranges; integer histogram binning loses
  // precision and collapses sub-integer values (e.g. radiance 0.003–0.012) to a
  // single bin. Use a sort-based percentile on a typed-array copy instead.
  if (band instanceof Float32Array || band instanceof Float64Array) {
    const sorted = band.slice().sort() as Float32Array | Float64Array;
    const n = sorted.length;
    const lowIdx = Math.min(n - 1, Math.floor(n * (lowPercentile / 100)));
    const highIdx = Math.min(n - 1, Math.floor(n * (highPercentile / 100)));
    return { min: sorted[lowIdx], max: sorted[highIdx] };
  }

  // Integer path: Uint8 → 256 bins, Uint16 → 65536 bins, indexed directly by value.
  const binCount = band instanceof Uint8Array ? 256 : 65536;
  const histogram = new Uint32Array(binCount);
  for (let i = 0; i < band.length; i += 1) {
    histogram[band[i]] += 1;
  }

  const lowTarget = Math.floor(band.length * (lowPercentile / 100));
  const highTarget = Math.floor(band.length * (highPercentile / 100));

  let min = 0;
  let max = binCount - 1;
  let cumulative = 0;
  let foundMin = false;

  for (let v = 0; v < binCount; v += 1) {
    cumulative += histogram[v];
    if (!foundMin && cumulative >= lowTarget) {
      min = v;
      foundMin = true;
    }
    if (cumulative >= highTarget) {
      max = v;
      break;
    }
  }

  return { min, max };
}

/**
 * Decode a TIFF file, compute per-frame percentile bounds, apply a linear stretch,
 * and return a grayscale PNG buffer. Cached by (path, lowPercentile, highPercentile, mtimeMs);
 * the mtime component ensures stale entries are evicted when a file is replaced on disk.
 */
export async function getDisplayPng(
  tiffPath: string,
  lowPercentile: number,
  highPercentile: number,
  mtimeMs: number,
): Promise<Buffer> {
  const key = `${tiffPath}::${lowPercentile}::${highPercentile}::${mtimeMs}`;
  const cached = displayPngCache.get(key);
  if (cached) {
    touchDisplayCacheEntry(key, cached);
    return cached;
  }

  const tiff = await openTiff(tiffPath);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();

  const rasters = await image.readRasters({
    samples: [0],
    interleave: false,
  }) as RasterArray[];
  const band = (rasters[0] ?? new Uint8Array(0)) as RasterArray;

  const { min, max } = computeFrameBounds(band, lowPercentile, highPercentile);
  const stretched = linearStretchToU8(band, min, max);
  const pngBuf = encodeGrayscalePng(stretched, width, height);
  touchDisplayCacheEntry(key, pngBuf);
  return pngBuf;
}
