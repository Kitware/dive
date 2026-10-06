/**
 * Stitched stereo media is imported in place: both cameras point at the same
 * side-by-side frames. VIAME cuts out a camera's half as it reads, through
 * the crop options of its image-list and video readers, so jobs are handed
 * the stitched media itself plus these reader settings. The same pipelines
 * therefore run on stitched and separate-camera data.
 */
import type { StitchedSide } from 'vue-media-annotator/stitchedStereo';

/**
 * KWIVER settings that make the pipeline input process `input` read one half
 * of stitched frames. Both readers are set because the pipe or the job picks
 * between them; the one not in use ignores its setting. Empty when the media
 * is not stitched.
 */
// eslint-disable-next-line import/prefer-default-export
export function stitchedReaderSettings(
  input: string,
  side: StitchedSide | null | undefined,
): Record<string, string> {
  if (!side) {
    return {};
  }
  return {
    [`${input}:video_reader:image_list:crop_${side}`]: 'true',
    [`${input}:video_reader:vidl_ffmpeg:crop_${side}`]: 'true',
  };
}
