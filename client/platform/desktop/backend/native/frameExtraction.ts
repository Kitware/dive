/**
 * Frame extraction service for native video playback.
 * Extracts frames on-demand using FFmpeg without requiring
 * full video transcoding.
 */
import { spawn } from 'child_process';
import { getBinaryPath, spawnResult } from './utils';

const ffmpegPath = getBinaryPath('ffmpeg-ffprobe-static/ffmpeg');
const ffprobePath = getBinaryPath('ffmpeg-ffprobe-static/ffprobe');

// LRU cache for extracted frames
interface CachedFrame {
  data: Buffer;
  timestamp: number;
}

interface FrameCache {
  frames: Map<number, CachedFrame>;
  maxSize: number;
}

const frameCaches: Map<string, FrameCache> = new Map();
const MAX_CACHE_SIZE = 100; // Max frames per video
const CACHE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

interface VideoInfo {
  fps: number;
  duration: number;
  width: number;
  height: number;
  frameCount: number;
}

/**
 * Get video information using ffprobe
 */
async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  const args = [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    videoPath,
  ];

  const result = await spawnResult(ffprobePath, args);
  if (result.error || result.output === null) {
    throw new Error(`Failed to probe video: ${result.error || 'Unknown error'}`);
  }

  const info = JSON.parse(result.output);
  const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');

  if (!videoStream) {
    throw new Error('No video stream found');
  }

  // Parse frame rate (e.g., "30000/1001" or "30/1")
  const fpsStr = videoStream.avg_frame_rate || videoStream.r_frame_rate || '30/1';
  const [num, den] = fpsStr.split('/').map(Number);
  const fps = den ? num / den : num;

  const duration = parseFloat(info.format?.duration || videoStream.duration || '0');
  const frameCount = Math.floor(duration * fps);

  return {
    fps,
    duration,
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    frameCount,
  };
}

/**
 * Get or create a frame cache for a video
 */
function getFrameCache(videoPath: string): FrameCache {
  let cache = frameCaches.get(videoPath);
  if (!cache) {
    cache = {
      frames: new Map(),
      maxSize: MAX_CACHE_SIZE,
    };
    frameCaches.set(videoPath, cache);
  }
  return cache;
}

/**
 * Evict old entries from the cache
 */
function evictOldEntries(cache: FrameCache) {
  const now = Date.now();
  const entries = Array.from(cache.frames.entries());

  // Remove expired entries
  entries.forEach(([frame, cached]) => {
    if (now - cached.timestamp > CACHE_EXPIRY_MS) {
      cache.frames.delete(frame);
    }
  });

  // If still over capacity, remove oldest entries
  if (cache.frames.size > cache.maxSize) {
    const sortedEntries = entries
      .filter(([frame]) => cache.frames.has(frame))
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    const toRemove = sortedEntries.slice(0, cache.frames.size - cache.maxSize);
    toRemove.forEach(([frame]) => cache.frames.delete(frame));
  }
}

/**
 * Extract a single frame from a video at the specified frame number
 * Returns the frame as a JPEG buffer
 */
async function extractFrame(
  videoPath: string,
  frameNumber: number,
  fps: number,
): Promise<Buffer> {
  const cache = getFrameCache(videoPath);

  // Check cache first
  const cached = cache.frames.get(frameNumber);
  if (cached) {
    cached.timestamp = Date.now(); // Update access time
    return cached.data;
  }

  // Calculate timestamp from frame number
  const timestamp = frameNumber / fps;

  // Extract frame using ffmpeg
  // Use -ss before -i for fast seeking to nearest keyframe
  // Then use accurate seeking with filter
  const args = [
    '-ss', timestamp.toFixed(6),
    '-i', videoPath,
    '-vframes', '1',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '2', // High quality JPEG
    '-',
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegPath, args);
    const chunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on('data', () => {
      // Ignore stderr output (progress info)
    });

    ffmpeg.on('close', (code) => {
      if (code === 0 && chunks.length > 0) {
        const frameData = Buffer.concat(chunks);

        // Cache the frame
        cache.frames.set(frameNumber, {
          data: frameData,
          timestamp: Date.now(),
        });
        evictOldEntries(cache);

        resolve(frameData);
      } else {
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Process frames in batches with limited concurrency
 */
async function processBatches(
  batches: number[][],
  videoPath: string,
  fps: number,
): Promise<void> {
  if (batches.length === 0) return;
  const [batch, ...remaining] = batches;
  await Promise.all(batch.map((frame) => extractFrame(videoPath, frame, fps).catch(() => null)));
  await processBatches(remaining, videoPath, fps);
}

/**
 * Pre-extract multiple frames around a given frame (for smoother playback)
 */
async function prefetchFrames(
  videoPath: string,
  centerFrame: number,
  fps: number,
  range: number = 5,
): Promise<void> {
  const cache = getFrameCache(videoPath);
  const framesToFetch: number[] = [];

  // Determine which frames to prefetch (not already cached)
  for (let i = -range; i <= range; i += 1) {
    const frame = centerFrame + i;
    if (frame >= 0 && !cache.frames.has(frame)) {
      framesToFetch.push(frame);
    }
  }

  // Fetch in parallel (limited concurrency)
  const concurrency = 3;
  const batches: number[][] = [];
  for (let i = 0; i < framesToFetch.length; i += concurrency) {
    batches.push(framesToFetch.slice(i, i + concurrency));
  }
  await processBatches(batches, videoPath, fps);
}

/**
 * Clear the frame cache for a specific video
 */
function clearCache(videoPath?: string) {
  if (videoPath) {
    frameCaches.delete(videoPath);
  } else {
    frameCaches.clear();
  }
}

/**
 * Get cache statistics
 */
function getCacheStats(videoPath: string): { cachedFrames: number; maxSize: number } {
  const cache = frameCaches.get(videoPath);
  return {
    cachedFrames: cache?.frames.size || 0,
    maxSize: MAX_CACHE_SIZE,
  };
}

export {
  extractFrame,
  prefetchFrames,
  getVideoInfo,
  clearCache,
  getCacheStats,
  VideoInfo,
};
