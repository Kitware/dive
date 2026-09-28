/**
 * Frame number to video time mapping shared by the video annotator and any
 * other code that has to land an HTMLVideoElement on a DIVE frame (e.g. the
 * review grid cropping detections out of a video).
 */

/**
 * For MPEG codecs, the PTS (Presentation Timestamp)
 * should be forced ahead 1 tick. currentTime has a finite
 * resolution of 90MHZ
 *
 * Chrome has a PTS precision bug:
 * https://bugs.chromium.org/p/chromium/issues/detail?id=555376
 * "currentTime must be in the range [PTS, PTS + duration)",
 * but Chrome behaves as if currentTime in = [PTS, PTS + duration]
 *
 * Firefox behaves correctly, so it's harmless to advance a single
 * tick into the already correct PTS.
 *
 * Other browsers can be wrong by more than an entire frame and are
 * futile to attempt to correct.
 *
 * TODO: VideoAnnotator _should_not_ report this PTS force hack
 * when reporting currentTime, as it would be inaccurate re: the
 * MPEG specification.
 */
export const OnePTSTick = 1 / (90 * 1000);

/**
 * The Kwiver seek function performs seek based on
 * downsampled frame number such that the converse of the
 * function (maping timestamp to downsampled frame)
 * is consistent with the implementation in kwiver:
 *
 * https://github.com/Kitware/kwiver/blob/1c97ad72c8b6237cb4b9618665d042be16825005/sprokit/processes/core/downsample_process.cxx#L267
 */
export function kwiverSeek(frame: number, frameRate: number, originalFps: number) {
  /**
   * If the downsample rate is truly lower than the original,
   * ceiling to find the sample boundary, else floor
   */
  const roundOrFloor = frameRate < originalFps ? Math.ceil : Math.floor;
  /**
   * requestedTimeInSeconds is the position, in seconds, that was
   * requested for seek
   */
  const requestedTimeInSeconds = frame / frameRate;
  /**
   * RequestedTrueVideoFrame is the floating point frame number
   * expected to be found at requested time
   */
  const requestedTrueVideoFrame = requestedTimeInSeconds * originalFps;
  /**
   * nextTrueFrameBoundary is the time, in seconds, of the
   * next frame transition boundary ASSUMING even frame spacing.
   *
   * For videos with b frames or inconsistent frame widths, this
   * will only be an aggregate approximation
   */
  const nextTrueFrameBoundary = roundOrFloor(requestedTrueVideoFrame) / originalFps;
  /**
   * Return one tick over the appropriate boundary
   */
  return nextTrueFrameBoundary + OnePTSTick;
}

/**
 * The video currentTime that shows DIVE frame `frame`: the kwiver-consistent
 * boundary when the true video rate is known, else a plain division.
 */
export function frameToVideoTime(
  frame: number,
  frameRate: number,
  originalFps?: number | null,
): number {
  if (originalFps) {
    return kwiverSeek(frame, frameRate, originalFps);
  }
  return frame / frameRate + OnePTSTick;
}
