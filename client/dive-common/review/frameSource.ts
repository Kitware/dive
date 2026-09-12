/**
 * Per-dataset access to decoded frames for chip cropping. Image sequences
 * load their frame images directly; videos are decoded by a hidden
 * HTMLVideoElement seeking to each requested frame.
 */
import type { DatasetConfig } from 'dive-common/apispec';
import { frameToVideoTime } from 'vue-media-annotator/components/annotators/videoSeek';

/** Anything drawImage accepts, with its pixel size. */
export interface DecodedFrame {
  source: CanvasImageSource;
  width: number;
  height: number;
}

export interface FrameSource {
  /** Frames the dataset has; null when unknown (video before metadata loads). */
  frameCount: number | null;
  getFrame(frame: number): Promise<DecodedFrame>;
  dispose(): void;
}

export interface FrameSourceOptions {
  /** Decoded frames kept per dataset. */
  cacheSize?: number;
  /**
   * Frame image URL for a natively played video (no media URL, only a path
   * the platform extracts frames from on demand).
   */
  nativeFrameUrl?: (videoPath: string, frame: number, fps: number) => Promise<string>;
  /** Upper bound on decoded pixel storage per source (RGBA bytes). */
  cacheBytes?: number;
}

const DefaultCacheSize = 24;

class FrameCache {
  private entries = new Map<number, DecodedFrame>();

  private readonly limit: number;

  private bytes = 0;

  private disposed = false;

  private readonly byteLimit: number;

  constructor(limit: number, byteLimit: number) {
    this.limit = limit;
    this.byteLimit = byteLimit;
  }

  get(frame: number): DecodedFrame | undefined {
    const hit = this.entries.get(frame);
    if (hit) {
      // Re-insert so the map keeps least-recently-used order.
      this.entries.delete(frame);
      this.entries.set(frame, hit);
    }
    return hit;
  }

  set(frame: number, decoded: DecodedFrame) {
    if (this.disposed) return;
    const previous = this.entries.get(frame);
    if (previous) this.bytes -= previous.width * previous.height * 4;
    this.entries.delete(frame);
    this.entries.set(frame, decoded);
    this.bytes += decoded.width * decoded.height * 4;
    while (this.entries.size > this.limit || this.bytes > this.byteLimit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const entry = this.entries.get(oldest)!;
      this.bytes -= entry.width * entry.height * 4;
      this.entries.delete(oldest);
    }
  }

  clear() {
    this.disposed = true;
    this.entries.clear();
    this.bytes = 0;
  }
}

export function loadImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      signal?.removeEventListener('abort', fail);
    };
    const fail = () => {
      cleanup();
      image.removeAttribute('src');
      reject(new Error('Could not load review frame'));
    };
    const timer = setTimeout(fail, SeekTimeoutMs);
    // Needed so the crop canvas is not tainted; platforms serve media with CORS headers.
    image.crossOrigin = 'anonymous';
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = fail;
    signal?.addEventListener('abort', fail, { once: true });
    if (signal?.aborted) fail();
    else image.src = url;
  });
}

/** Dedupes concurrent requests for the same frame in front of a loader. */
function withCache(
  cache: FrameCache,
  load: (frame: number) => Promise<DecodedFrame>,
): (frame: number) => Promise<DecodedFrame> {
  const inflight = new Map<number, Promise<DecodedFrame>>();
  return (frame: number) => {
    const cached = cache.get(frame);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(frame);
    if (pending) return pending;
    const promise = load(frame).then((decoded) => {
      cache.set(frame, decoded);
      return decoded;
    }).finally(() => inflight.delete(frame));
    inflight.set(frame, promise);
    return promise;
  };
}

function imageFrameSource(urlFor: (frame: number) => Promise<string>, frameCount: number | null, cacheSize: number, cacheBytes: number): FrameSource {
  const cache = new FrameCache(cacheSize, cacheBytes);
  let disposed = false;
  const controller = new AbortController();
  const getFrame = withCache(cache, async (frame) => {
    if (disposed) throw new Error('Frame source disposed');
    const image = await loadImage(await urlFor(frame), controller.signal);
    if (disposed) throw new Error('Frame source disposed');
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  });
  return {
    frameCount,
    getFrame,
    dispose: () => {
      disposed = true;
      controller.abort();
      cache.clear();
    },
  };
}

const SeekTimeoutMs = 15000;

/**
 * One hidden video element per dataset; seeks are serialized because an
 * element can only sit on one frame at a time. Each decoded frame is copied
 * to its own canvas so the cache survives the next seek.
 */
function videoFrameSource(config: DatasetConfig, cacheSize: number, cacheBytes: number): FrameSource {
  const cache = new FrameCache(cacheSize, cacheBytes);
  let video: HTMLVideoElement | null = null;
  let metadata: Promise<HTMLVideoElement> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  let disposed = false;
  let cancelPending: (() => void) | null = null;

  function element(): Promise<HTMLVideoElement> {
    if (metadata) return metadata;
    metadata = new Promise((resolve, reject) => {
      const el = document.createElement('video');
      el.crossOrigin = 'anonymous';
      el.muted = true;
      el.preload = 'metadata';
      el.playsInline = true;
      const cleanup = () => {
        window.clearTimeout(timer);
        el.onloadedmetadata = null;
        el.onerror = null;
        cancelPending = null;
      };
      const fail = () => {
        cleanup();
        reject(new Error(`Could not open video for ${config.name}`));
      };
      const timer = window.setTimeout(fail, SeekTimeoutMs);
      cancelPending = fail;
      el.onloadedmetadata = () => { cleanup(); resolve(el); };
      el.onerror = fail;
      el.src = config.videoUrl || '';
      video = el;
    });
    return metadata;
  }

  function seekTo(el: HTMLVideoElement, time: number): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Timed out seeking the video'));
      }, SeekTimeoutMs);
      function cleanup() {
        el.removeEventListener('seeked', onSeeked);
        el.removeEventListener('error', onError);
        window.clearTimeout(timer);
        cancelPending = null;
      }
      function onSeeked() {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      }
      function onError() {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('The video failed while seeking'));
      }
      cancelPending = onError;
      el.addEventListener('seeked', onSeeked);
      el.addEventListener('error', onError);
      // Seeking to the time the element already sits at fires no event.
      if (Math.abs(el.currentTime - time) < 1e-6 && el.readyState >= 2) {
        onSeeked();
        return;
      }
      // eslint-disable-next-line no-param-reassign
      el.currentTime = time;
    });
  }

  const getFrame = withCache(cache, (frame) => {
    const run = queue.then(async () => {
      if (disposed) throw new Error('Frame source disposed');
      const el = await element();
      if (disposed) throw new Error('Frame source disposed');
      await seekTo(el, frameToVideoTime(frame, config.fps, config.originalFps ?? null));
      if (disposed) throw new Error('Frame source disposed');
      const canvas = document.createElement('canvas');
      canvas.width = el.videoWidth;
      canvas.height = el.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas unavailable');
      ctx.drawImage(el, 0, 0);
      return { source: canvas, width: canvas.width, height: canvas.height } as DecodedFrame;
    });
    // Failures must not wedge the queue for later frames.
    queue = run.catch(() => undefined);
    return run;
  });

  return {
    frameCount: null,
    getFrame,
    dispose: () => {
      disposed = true;
      cancelPending?.();
      cache.clear();
      if (video) {
        video.removeAttribute('src');
        video.load();
        video = null;
      }
      metadata = null;
    },
  };
}

/**
 * Pick the loader for a dataset, or throw for media the review grid cannot
 * crop (tiled large images, multicamera parents).
 */
export function createFrameSource(config: DatasetConfig, options: FrameSourceOptions = {}): FrameSource {
  const cacheSize = options.cacheSize ?? DefaultCacheSize;
  const cacheBytes = options.cacheBytes ?? 32 * 1024 * 1024;
  if (config.type === 'large-image') {
    throw new Error('Tiled large-image datasets cannot be reviewed as chips yet');
  }
  if (config.type === 'multi') {
    throw new Error('Review the cameras of a multicamera dataset individually');
  }
  if (config.type === 'video') {
    if (config.videoUrl) {
      return videoFrameSource(config, cacheSize, cacheBytes);
    }
    const nativePath = (config as { nativeVideoPath?: string }).nativeVideoPath;
    if (nativePath && options.nativeFrameUrl) {
      // Frames are numbered at the rate the video plays natively, as the
      // annotator requests them.
      const fps = config.originalFps || config.fps;
      const { nativeFrameUrl } = options;
      return imageFrameSource((frame) => nativeFrameUrl(nativePath, frame, fps), null, cacheSize, cacheBytes);
    }
    if (nativePath) {
      throw new Error('This platform cannot extract frames from an untranscoded video');
    }
    throw new Error('This video has no playable media');
  }
  const { imageData } = config;
  return imageFrameSource(async (frame) => {
    const entry = imageData[frame];
    if (!entry) throw new Error(`No image for frame ${frame}`);
    return entry.url;
  }, imageData.length, cacheSize, cacheBytes);
}

/**
 * Lazily creates one frame source per dataset from its config, for chip
 * stores whose items can name any dataset (e.g. cross-dataset search
 * results). A dataset whose config cannot be loaded or whose media cannot
 * be cropped resolves to null.
 */
export function createFrameSourceRegistry(
  loadConfig: (datasetId: string) => Promise<DatasetConfig>,
  options: FrameSourceOptions = {},
) {
  const sources = new Map<string, Promise<FrameSource | null>>();

  function frameSourceFor(datasetId: string): Promise<FrameSource | null> {
    if (!datasetId) return Promise.resolve(null);
    let pending = sources.get(datasetId);
    if (!pending) {
      pending = loadConfig(datasetId)
        .then((config) => {
          try {
            return createFrameSource(config, options);
          } catch {
            return null;
          }
        })
        .catch(() => null);
      sources.set(datasetId, pending);
    }
    return pending;
  }

  function dispose() {
    sources.forEach((pending) => {
      pending.then((source) => source?.dispose()).catch(() => undefined);
    });
    sources.clear();
  }

  return { frameSourceFor, dispose };
}

export type FrameSourceRegistry = ReturnType<typeof createFrameSourceRegistry>;
