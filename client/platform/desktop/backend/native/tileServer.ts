/**
 * Tile server module for serving GeoTIFF/tiled TIFF images as map tiles.
 * Uses geotiff.js for reading and sharp for PNG encoding.
 */
import * as GeoTIFF from 'geotiff';
import sharp from 'sharp';

interface TileMetadata {
  sizeX: number;
  sizeY: number;
  tileWidth: number;
  tileHeight: number;
  levels: number;
  geospatial: boolean;
  bounds?: { xmin: number; xmax: number; ymin: number; ymax: number };
  sourceSizeX: number;
  sourceSizeY: number;
}

interface CachedTiff {
  tiff: GeoTIFF.GeoTIFF;
  metadata: TileMetadata;
  lastAccess: number;
}

const MAX_CACHE_SIZE = 10;
const tiffCache = new Map<string, CachedTiff>();

function evictOldest() {
  if (tiffCache.size < MAX_CACHE_SIZE) return;
  let oldestKey = '';
  let oldestTime = Infinity;
  tiffCache.forEach((entry, key) => {
    if (entry.lastAccess < oldestTime) {
      oldestTime = entry.lastAccess;
      oldestKey = key;
    }
  });
  if (oldestKey) {
    const entry = tiffCache.get(oldestKey);
    if (entry) {
      entry.tiff.close();
    }
    tiffCache.delete(oldestKey);
  }
}

async function openTiff(filePath: string): Promise<CachedTiff> {
  const existing = tiffCache.get(filePath);
  if (existing) {
    existing.lastAccess = Date.now();
    return existing;
  }

  evictOldest();

  const tiff = await GeoTIFF.fromFile(filePath);
  const image = await tiff.getImage(0);
  const sizeX = image.getWidth();
  const sizeY = image.getHeight();
  const tileWidth = image.getTileWidth() || 256;
  const tileHeight = image.getTileHeight() || 256;
  const imageCount = await tiff.getImageCount();

  // Count overview levels: pyramidal TIFFs have multiple IFDs (full-res + overviews)
  // If only 1 IFD, compute virtual levels
  let levels: number;
  if (imageCount > 1) {
    levels = imageCount;
  } else {
    levels = Math.max(1, Math.ceil(Math.log2(Math.max(sizeX, sizeY) / tileWidth)) + 1);
  }

  // Check geospatial info
  let geospatial = false;
  let bounds: TileMetadata['bounds'];
  try {
    const geoKeys = image.getGeoKeys();
    if (geoKeys && Object.keys(geoKeys).length > 0) {
      geospatial = true;
    }
  } catch {
    // No geo keys
  }
  try {
    const bbox = image.getBoundingBox();
    if (bbox && bbox.length === 4) {
      bounds = {
        xmin: bbox[0], ymin: bbox[1], xmax: bbox[2], ymax: bbox[3],
      };
    }
  } catch {
    // No bounding box
  }

  const metadata: TileMetadata = {
    sizeX,
    sizeY,
    tileWidth,
    tileHeight,
    levels,
    geospatial,
    bounds,
    sourceSizeX: sizeX,
    sourceSizeY: sizeY,
  };

  const entry: CachedTiff = {
    tiff,
    metadata,
    lastAccess: Date.now(),
  };
  tiffCache.set(filePath, entry);
  return entry;
}

async function getMetadata(filePath: string): Promise<TileMetadata> {
  const entry = await openTiff(filePath);
  return entry.metadata;
}

function bandDataToRGBA(
  rasters: GeoTIFF.ReadRasterResult,
  width: number,
  height: number,
): Buffer {
  const pixelCount = width * height;
  const rgba = Buffer.alloc(pixelCount * 4);
  const numBands = rasters.length;

  if (numBands >= 4) {
    // RGBA
    const r = rasters[0] as GeoTIFF.TypedArray;
    const g = rasters[1] as GeoTIFF.TypedArray;
    const b = rasters[2] as GeoTIFF.TypedArray;
    const a = rasters[3] as GeoTIFF.TypedArray;
    for (let i = 0; i < pixelCount; i += 1) {
      rgba[i * 4] = r[i];
      rgba[i * 4 + 1] = g[i];
      rgba[i * 4 + 2] = b[i];
      rgba[i * 4 + 3] = a[i];
    }
  } else if (numBands === 3) {
    // RGB
    const r = rasters[0] as GeoTIFF.TypedArray;
    const g = rasters[1] as GeoTIFF.TypedArray;
    const b = rasters[2] as GeoTIFF.TypedArray;
    for (let i = 0; i < pixelCount; i += 1) {
      rgba[i * 4] = r[i];
      rgba[i * 4 + 1] = g[i];
      rgba[i * 4 + 2] = b[i];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    // Grayscale (1 band)
    const band = rasters[0] as GeoTIFF.TypedArray;
    // Determine scale factor for non-8-bit data
    let maxVal = 255;
    const bitsPerSample = (rasters as unknown as { _meta?: { bitsPerSample?: number[] } })
      ?._meta?.bitsPerSample;
    if (bitsPerSample && bitsPerSample[0] > 8) {
      maxVal = (1 << bitsPerSample[0]) - 1;
    } else {
      // Check actual data range for non-8-bit typed arrays
      if (band instanceof Uint16Array || band instanceof Int16Array
          || band instanceof Uint32Array || band instanceof Int32Array
          || band instanceof Float32Array || band instanceof Float64Array) {
        let dataMax = 0;
        for (let i = 0; i < pixelCount; i += 1) {
          if (band[i] > dataMax) dataMax = band[i];
        }
        if (dataMax > 255) {
          maxVal = dataMax;
        }
      }
    }
    const scale = 255 / maxVal;
    for (let i = 0; i < pixelCount; i += 1) {
      const val = Math.min(255, Math.round(band[i] * scale));
      rgba[i * 4] = val;
      rgba[i * 4 + 1] = val;
      rgba[i * 4 + 2] = val;
      rgba[i * 4 + 3] = 255;
    }
  }

  return rgba;
}

async function getTile(
  filePath: string, level: number, x: number, y: number,
): Promise<Buffer> {
  const entry = await openTiff(filePath);
  const { metadata, tiff } = entry;
  const { tileWidth: tw, tileHeight: th } = metadata;
  const imageCount = await tiff.getImageCount();

  let image: GeoTIFF.GeoTIFFImage;
  let imgW: number;
  let imgH: number;

  if (imageCount > 1) {
    // Pyramidal TIFF: level 0 = most zoomed out (smallest overview)
    // IFD 0 = full-res, IFD 1..N = progressively smaller overviews
    // Map: level 0 -> last IFD (smallest), level N-1 -> IFD 0 (full-res)
    const ifdIndex = Math.max(0, Math.min(imageCount - 1, imageCount - 1 - level));
    image = await tiff.getImage(ifdIndex);
    imgW = image.getWidth();
    imgH = image.getHeight();
  } else {
    // Single image (no overviews): use the full-res image for all levels
    image = await tiff.getImage(0);
    imgW = image.getWidth();
    imgH = image.getHeight();

    // For non-pyramidal, compute downscale factor based on level
    // level 0 = most zoomed out, levels-1 = full-res
    const totalLevels = metadata.levels;
    const scalePower = totalLevels - 1 - level;

    if (scalePower > 0) {
      // Need to read a larger region and downscale
      const scale = 1 << scalePower;
      const srcX = x * tw * scale;
      const srcY = y * th * scale;
      const srcW = Math.min(tw * scale, imgW - srcX);
      const srcH = Math.min(th * scale, imgH - srcY);

      if (srcX >= imgW || srcY >= imgH || srcW <= 0 || srcH <= 0) {
        // Out of bounds: return transparent tile
        return sharp(Buffer.alloc(tw * th * 4), {
          raw: { width: tw, height: th, channels: 4 },
        }).png().toBuffer();
      }

      const window = [srcX, srcY, srcX + srcW, srcY + srcH];
      const rasters = await image.readRasters({ window });
      const readW = srcW;
      const readH = srcH;
      const rgba = bandDataToRGBA(rasters, readW, readH);

      // Downscale to tile size
      const outW = Math.min(tw, Math.ceil(srcW / scale));
      const outH = Math.min(th, Math.ceil(srcH / scale));
      return sharp(rgba, {
        raw: { width: readW, height: readH, channels: 4 },
      }).resize(outW, outH, { fit: 'fill' }).png().toBuffer();
    }
  }

  // Full-res tile extraction (or pyramidal level tile extraction)
  const pixelX = x * tw;
  const pixelY = y * th;
  const readW = Math.min(tw, imgW - pixelX);
  const readH = Math.min(th, imgH - pixelY);

  if (pixelX >= imgW || pixelY >= imgH || readW <= 0 || readH <= 0) {
    // Out of bounds: return transparent tile
    return sharp(Buffer.alloc(tw * th * 4), {
      raw: { width: tw, height: th, channels: 4 },
    }).png().toBuffer();
  }

  const window = [pixelX, pixelY, pixelX + readW, pixelY + readH];
  const rasters = await image.readRasters({ window });
  const rgba = bandDataToRGBA(rasters, readW, readH);

  return sharp(rgba, {
    raw: { width: readW, height: readH, channels: 4 },
  }).png().toBuffer();
}

function closeTiff(filePath: string) {
  const entry = tiffCache.get(filePath);
  if (entry) {
    entry.tiff.close();
    tiffCache.delete(filePath);
  }
}

export {
  TileMetadata,
  getMetadata,
  getTile,
  closeTiff,
};
