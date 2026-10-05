/**
 * Stitched stereo media is imported in place: both cameras point at the same
 * side-by-side frames. VIAME cuts out a camera's half as it reads, through
 * the crop options of its image-list reader, so jobs are handed the stitched
 * images themselves plus these reader settings. The same pipelines therefore
 * run on stitched and separate-camera data.
 */
import type { StitchedSide } from 'vue-media-annotator/stitchedStereo';

/**
 * KWIVER settings that make the pipeline input process `input` read one half
 * of the stitched images in its list. Empty when the media is not stitched.
 */
export function stitchedReaderSettings(
  input: string,
  side: StitchedSide | null | undefined,
): Record<string, string> {
  return side ? { [`${input}:video_reader:image_list:crop_${side}`]: 'true' } : {};
}

/** VIAME's video reader has no crop option; stitched video cannot feed a job directly. */
export function assertNotStitchedVideo(side: StitchedSide | null | undefined, what: string) {
  if (side) {
    throw new Error(
      `${what} is not supported on stitched stereo video yet. `
      + 'Stitched image sequences are supported.',
    );
  }
}
