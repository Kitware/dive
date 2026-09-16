/**
 * Probe a video file on disk for the frame rate and size the Query page
 * needs when extracting an arbitrary frame as a search exemplar.
 */
import { getBinaryPath, spawnResult } from './utils';

const ffprobePath = getBinaryPath('ffmpeg-ffprobe-static/ffprobe');

export interface VideoInfo {
  fps: number;
  duration: number;
  width: number;
  height: number;
  frameCount: number;
}

/** Frame rate, size and length of a video file, via ffprobe. */
export async function getVideoInfo(videoPath: string): Promise<VideoInfo> {
  const result = await spawnResult(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    videoPath,
  ]);
  if (result.error || result.output === null) {
    throw new Error(`Failed to probe video: ${result.error || 'Unknown error'}`);
  }

  const info = JSON.parse(result.output);
  const videoStream = info.streams?.find((s: { codec_type: string }) => s.codec_type === 'video');
  if (!videoStream) {
    throw new Error('No video stream found');
  }

  const fpsStr = videoStream.avg_frame_rate || videoStream.r_frame_rate || '30/1';
  const [num, den] = fpsStr.split('/').map(Number);
  const fps = den ? num / den : num;
  const duration = parseFloat(info.format?.duration || videoStream.duration || '0');

  return {
    fps,
    duration,
    width: videoStream.width || 0,
    height: videoStream.height || 0,
    frameCount: Math.floor(duration * fps),
  };
}
