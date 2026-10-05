/**
 * Stitched stereo media is imported in place: both cameras point at the same
 * side-by-side frames. VIAME cuts out a camera's half as it reads, through
 * its `stitched_side` video reader, so jobs are handed the stitched media
 * itself plus these reader settings.
 */
import type { StitchedSide } from 'vue-media-annotator/stitchedStereo';
import type { JsonConfig } from 'platform/desktop/constants';

export function hasStitchedMedia(meta: JsonConfig): boolean {
  return !!meta.stitchedSide
    || Object.values(meta.multiCam?.cameras ?? {}).some((camera) => camera.stitchedSide);
}

/**
 * KWIVER settings that make the pipeline input process `input` read one half
 * of stitched frames. The reader picks the underlying video or image-list
 * reader from the file it is given. Empty when the media is not stitched.
 */
export function stitchedReaderSettings(
  input: string,
  side: StitchedSide | null | undefined,
): Record<string, string> {
  if (!side) {
    return {};
  }
  return {
    [`${input}:video_reader:type`]: 'stitched_side',
    [`${input}:video_reader:stitched_side:side`]: side,
  };
}
