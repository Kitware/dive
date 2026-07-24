import {
  extractCounter,
  normalizeAlignmentKey,
  resolveTableToFrames,
} from './join';
import type {
  FrameAlignmentIndex,
  JoinBlockedReason,
  ResolvedCameraFrameMetadata,
} from './join';
import { parseFrameMetadataTable } from './parser';

/**
 * A camera's media defines its own frame bound: the ordered media list for an image sequence,
 * the declared frame count for a video.
 */
export type FrameMetadataFrameContext =
  | {
      mediaType: 'image-sequence';
      mediaNames: string[];
    }
  | {
      mediaType: 'video';
      frameCount: number;
    };

type CameraAttachmentResolution =
  | { status: 'resolved'; metadata: ResolvedCameraFrameMetadata }
  | { status: 'invalid' }
  | { status: 'unmatched'; reason?: JoinBlockedReason };

// The read path must tolerate duplicate basenames because rejecting here would hide all metadata
// for the camera. Later media entries win for consistency with the ordered media list.
//
// Alongside the filename index, derive a frame-number-valued counter index. Repeated media counters
// are excluded because a trailing digit run is weaker evidence than a complete basename.
export function buildFrameAlignmentIndex(context: FrameMetadataFrameContext): FrameAlignmentIndex {
  if (context.mediaType === 'video') {
    return {
      frameCount: context.frameCount,
      frameByAlignmentKey: new Map(),
    };
  }
  const { mediaNames } = context;
  const alignmentKeys = mediaNames.map(normalizeAlignmentKey);
  const framesByCounter = new Map<number, number[]>();
  alignmentKeys.forEach((key, frame) => {
    const counter = extractCounter(key);
    if (counter !== undefined) {
      framesByCounter.set(counter, [...(framesByCounter.get(counter) ?? []), frame]);
    }
  });
  const frameByCounter = new Map<number, number>();
  framesByCounter.forEach((frames, counter) => {
    if (frames.length === 1) {
      frameByCounter.set(counter, frames[0]);
    }
  });
  return {
    frameCount: mediaNames.length,
    frameByAlignmentKey: new Map(alignmentKeys.map((key, frame) => [key, frame])),
    frameByCounter,
  };
}

export function resolveCameraAttachment(
  text: string,
  index: FrameAlignmentIndex,
  sourceName?: string,
): CameraAttachmentResolution {
  const table = parseFrameMetadataTable(text);
  if (table === null) {
    return { status: 'invalid' };
  }
  const result = resolveTableToFrames(table, index, sourceName);
  if (result.status === 'matched') {
    return { status: 'resolved', metadata: result.parsed };
  }
  return result.status === 'blocked'
    ? { status: 'unmatched', reason: result.reason }
    : { status: 'unmatched' };
}

// Re-exported so a consumer of `resolveCameraAttachment` names the payload type from the same
// module it calls, rather than reaching past this one into `./join`. `dive-common/use/
// useFrameMetadata` accumulates these per-camera results itself, keyed by camera: one camera at a
// time is the whole contract, because a shared multicamera source binds to each camera's own
// media independently.
export type { ResolvedCameraFrameMetadata };
