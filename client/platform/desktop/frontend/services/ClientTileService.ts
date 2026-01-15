/**
 * ClientTileService - Coordinates client-side tile generation for large images
 *
 * This service manages WebWorkers that generate tile pyramids on-the-fly from
 * large images, avoiding the need to write tiles to disk.
 */

import {
  DEFAULT_TILE_SIZE,
  TILE_CACHE_SIZE_MB,
  LARGE_IMAGE_THRESHOLD,
  TileMetadata,
} from 'platform/desktop/constants';

interface TileCacheEntry {
  blobUrl: string;
  size: number;
  lastAccess: number;
}

interface PendingTileRequest {
  resolve: (url: string) => void;
  reject: (error: Error) => void;
}

interface WorkerMessage {
  type: 'init' | 'tile' | 'ready' | 'error';
  imageId: string;
  level?: number;
  x?: number;
  y?: number;
  tile?: ImageBitmap;
  metadata?: TileMetadata;
  error?: string;
}

export class ClientTileService {
  private worker: Worker | null = null;
  private imageCache: Map<string, {
    bitmap: ImageBitmap;
    metadata: TileMetadata;
  }> = new Map();

  private tileCache: Map<string, TileCacheEntry> = new Map();
  private tileCacheSize = 0;
  private maxCacheSize = TILE_CACHE_SIZE_MB * 1024 * 1024;

  private pendingRequests: Map<string, PendingTileRequest> = new Map();
  private initPromises: Map<string, Promise<TileMetadata>> = new Map();

  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /**
   * Initialize the service with an image
   */
  async initImage(imageId: string, imagePath: string): Promise<TileMetadata> {
    // Check if already initializing
    const existingPromise = this.initPromises.get(imageId);
    if (existingPromise) {
      return existingPromise;
    }

    // Check if already initialized
    const cached = this.imageCache.get(imageId);
    if (cached) {
      return cached.metadata;
    }

    const initPromise = this._initImageInternal(imageId, imagePath);
    this.initPromises.set(imageId, initPromise);

    try {
      const result = await initPromise;
      return result;
    } finally {
      this.initPromises.delete(imageId);
    }
  }

  private async _initImageInternal(imageId: string, imagePath: string): Promise<TileMetadata> {
    // Fetch the image as a blob
    const imageUrl = `${this.baseUrl}/api/media?path=${encodeURIComponent(imagePath)}`;
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    // Calculate tile metadata
    const tileWidth = DEFAULT_TILE_SIZE;
    const tileHeight = DEFAULT_TILE_SIZE;
    const levels = Math.ceil(Math.log2(Math.max(bitmap.width, bitmap.height) / DEFAULT_TILE_SIZE));

    const metadata: TileMetadata = {
      sizeX: bitmap.width,
      sizeY: bitmap.height,
      tileWidth,
      tileHeight,
      levels,
      isLargeImage: bitmap.width > LARGE_IMAGE_THRESHOLD || bitmap.height > LARGE_IMAGE_THRESHOLD,
    };

    this.imageCache.set(imageId, { bitmap, metadata });
    return metadata;
  }

  /**
   * Get tile metadata (compatible with GeoJS getTiles interface)
   */
  async getTiles(imageId: string, imagePath: string): Promise<TileMetadata> {
    return this.initImage(imageId, imagePath);
  }

  /**
   * Generate a tile at the specified level and coordinates
   */
  async getTile(
    imageId: string,
    level: number,
    x: number,
    y: number,
  ): Promise<string> {
    const cacheKey = `${imageId}-${level}-${x}-${y}`;

    // Check tile cache
    const cached = this.tileCache.get(cacheKey);
    if (cached) {
      cached.lastAccess = Date.now();
      return cached.blobUrl;
    }

    // Generate tile
    const imageData = this.imageCache.get(imageId);
    if (!imageData) {
      throw new Error(`Image ${imageId} not initialized`);
    }

    const { bitmap, metadata } = imageData;
    const scale = Math.pow(2, metadata.levels - level);
    const tileSize = DEFAULT_TILE_SIZE;

    // Calculate source region
    const srcX = x * tileSize * scale;
    const srcY = y * tileSize * scale;
    const srcWidth = Math.min(tileSize * scale, bitmap.width - srcX);
    const srcHeight = Math.min(tileSize * scale, bitmap.height - srcY);

    if (srcWidth <= 0 || srcHeight <= 0) {
      // Return transparent tile for out-of-bounds
      return this.createEmptyTile(cacheKey, tileSize);
    }

    // Create tile using OffscreenCanvas
    const canvas = new OffscreenCanvas(tileSize, tileSize);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2d context');
    }

    // Calculate destination size
    const dstWidth = Math.ceil(srcWidth / scale);
    const dstHeight = Math.ceil(srcHeight / scale);

    // Draw scaled portion of image
    ctx.drawImage(
      bitmap,
      srcX, srcY, srcWidth, srcHeight,
      0, 0, dstWidth, dstHeight,
    );

    // Convert to blob URL
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const blobUrl = URL.createObjectURL(blob);

    // Cache the tile
    this.addToCache(cacheKey, blobUrl, blob.size);

    return blobUrl;
  }

  /**
   * Get tile URL function compatible with GeoJS
   * Returns a function that GeoJS will call to get tile URLs
   */
  getTileUrlFunction(imageId: string): (level: number, x: number, y: number) => Promise<string> {
    return async (level: number, x: number, y: number) => this.getTile(imageId, level, x, y);
  }

  /**
   * Create URL function for GeoJS OSM layer
   * This creates a synchronous URL generator that returns placeholder URLs
   * and updates them asynchronously
   */
  createTileUrlGenerator(imageId: string): {
    url: (level: number, x: number, y: number) => string;
    prefetch: (level: number, x: number, y: number) => Promise<void>;
  } {
    const tilePromises: Map<string, Promise<string>> = new Map();

    return {
      url: (level: number, x: number, y: number) => {
        const cacheKey = `${imageId}-${level}-${x}-${y}`;
        const cached = this.tileCache.get(cacheKey);
        if (cached) {
          cached.lastAccess = Date.now();
          return cached.blobUrl;
        }

        // Start async tile generation if not already started
        if (!tilePromises.has(cacheKey)) {
          tilePromises.set(cacheKey, this.getTile(imageId, level, x, y));
        }

        // Return empty/placeholder - tile will be loaded async
        return '';
      },
      prefetch: async (level: number, x: number, y: number) => {
        await this.getTile(imageId, level, x, y);
      },
    };
  }

  private createEmptyTile(cacheKey: string, tileSize: number): string {
    const canvas = new OffscreenCanvas(tileSize, tileSize);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.fillRect(0, 0, tileSize, tileSize);
    }

    // For empty tiles, we create a data URL instead of blob URL
    // since they're always the same and don't need caching
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  }

  private addToCache(key: string, blobUrl: string, size: number): void {
    // Evict tiles if cache is too large
    while (this.tileCacheSize + size > this.maxCacheSize && this.tileCache.size > 0) {
      this.evictOldestTile();
    }

    this.tileCache.set(key, {
      blobUrl,
      size,
      lastAccess: Date.now(),
    });
    this.tileCacheSize += size;
  }

  private evictOldestTile(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.tileCache.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.tileCache.get(oldestKey);
      if (entry) {
        URL.revokeObjectURL(entry.blobUrl);
        this.tileCacheSize -= entry.size;
        this.tileCache.delete(oldestKey);
      }
    }
  }

  /**
   * Clear cache for a specific image
   */
  clearImageCache(imageId: string): void {
    // Clear tile cache for this image
    for (const [key, entry] of this.tileCache.entries()) {
      if (key.startsWith(`${imageId}-`)) {
        URL.revokeObjectURL(entry.blobUrl);
        this.tileCacheSize -= entry.size;
        this.tileCache.delete(key);
      }
    }

    // Clear image bitmap
    const imageData = this.imageCache.get(imageId);
    if (imageData) {
      imageData.bitmap.close();
      this.imageCache.delete(imageId);
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    // Revoke all blob URLs
    for (const entry of this.tileCache.values()) {
      URL.revokeObjectURL(entry.blobUrl);
    }
    this.tileCache.clear();
    this.tileCacheSize = 0;

    // Close all bitmaps
    for (const imageData of this.imageCache.values()) {
      imageData.bitmap.close();
    }
    this.imageCache.clear();
  }

  /**
   * Dispose of the service
   */
  dispose(): void {
    this.clearAll();
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

// Singleton instance
let serviceInstance: ClientTileService | null = null;

export function getClientTileService(baseUrl: string): ClientTileService {
  if (!serviceInstance) {
    serviceInstance = new ClientTileService(baseUrl);
  }
  return serviceInstance;
}

export function disposeClientTileService(): void {
  if (serviceInstance) {
    serviceInstance.dispose();
    serviceInstance = null;
  }
}
