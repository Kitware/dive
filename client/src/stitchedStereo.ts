/**
 * Stitched stereo: one frame holds both cameras side by side, the left
 * camera in the left half and the right camera in the right half. Each camera
 * of such a dataset reads the shared media and keeps only its own half.
 */
export type StitchedSide = 'left' | 'right';

/** Source rectangle in media pixels, in the shape geojs quads take as `crop`. */
export interface SourceCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Media a consumer draws from, with the sub-rectangle that is the frame. */
export interface CroppedSource {
  width: number;
  height: number;
  crop?: SourceCrop;
}

/**
 * Both halves share one width so the two cameras always agree on frame size;
 * an odd-width frame drops its middle column.
 */
export function stitchedHalfWidth(fullWidth: number): number {
  return Math.floor(fullWidth / 2);
}

export function stitchedSourceCrop(
  side: StitchedSide,
  fullWidth: number,
  fullHeight: number,
): SourceCrop {
  const half = stitchedHalfWidth(fullWidth);
  const left = side === 'left' ? 0 : fullWidth - half;
  return {
    left, top: 0, right: left + half, bottom: fullHeight,
  };
}

/** Frame size and source rectangle for media that may be one stitched half. */
export function stitchedFrame(
  side: StitchedSide | null | undefined,
  fullWidth: number,
  fullHeight: number,
): CroppedSource {
  if (!side) {
    return { width: fullWidth, height: fullHeight };
  }
  const crop = stitchedSourceCrop(side, fullWidth, fullHeight);
  return { width: crop.right - crop.left, height: fullHeight, crop };
}

/**
 * Draw a frame (or its stitched half) at its native size into a 2D context.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  frame: CroppedSource,
) {
  const { crop, width, height } = frame;
  if (crop) {
    ctx.drawImage(source, crop.left, crop.top, width, height, 0, 0, width, height);
  } else {
    ctx.drawImage(source, 0, 0, width, height);
  }
}

/** ffmpeg video filter cropping a stitched frame to one half. */
export function stitchedCropFilter(side: StitchedSide): string {
  return side === 'left'
    ? 'crop=trunc(iw/2):ih:0:0'
    : 'crop=trunc(iw/2):ih:iw-trunc(iw/2):0';
}

const PathTag = '#stitched=';

/**
 * Media paths handed to the desktop interactive service name a whole stitched
 * frame; the tag tells the backend which half to cut out before the service
 * reads it.
 */
export function tagStitchedPath(path: string, side: StitchedSide | null | undefined): string {
  return side && path ? `${path}${PathTag}${side}` : path;
}

export function parseStitchedPath(tagged: string): { path: string; side: StitchedSide | null } {
  const index = tagged.lastIndexOf(PathTag);
  const side = index === -1 ? '' : tagged.slice(index + PathTag.length);
  if (side === 'left' || side === 'right') {
    return { path: tagged.slice(0, index), side };
  }
  return { path: tagged, side: null };
}
