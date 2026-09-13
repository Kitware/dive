/**
 * Video search results as review grid items, so ranked similarity results
 * can be adjudicated in the same chip grid that reviews annotations.
 */
import type { VideoSearchResult, VideoSearchTrackState } from 'dive-common/apispec';
import type { Feature, TrackData } from 'vue-media-annotator/track';
import type { ReviewFrameRef, ReviewItem } from './types';

export function searchResultFrame(result: VideoSearchResult): number | null {
  return result.tracks[0]?.states[0]?.frame ?? result.start_frame ?? null;
}

function stateRef(state: VideoSearchTrackState): ReviewFrameRef {
  return { frame: state.frame, bounds: state.bbox ?? null };
}

/** Up to `max` states evenly sampled along the result's first track. */
export function sampleSearchStates(result: VideoSearchResult, max: number): ReviewFrameRef[] {
  const states = result.tracks[0]?.states ?? [];
  if (states.length === 0) return [];
  const count = Math.max(1, Math.min(max, states.length));
  const chosen: ReviewFrameRef[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const index = count === 1 ? 0 : Math.round((i * (states.length - 1)) / (count - 1));
    const state = states[index];
    if (!seen.has(state.frame)) {
      seen.add(state.frame);
      chosen.push(stateRef(state));
    }
  }
  return chosen;
}

/**
 * A grid item for one result; null when the result names no frame at all.
 * `datasetId` is the dataset the result's stream maps to ('' when unknown,
 * which renders as an un-croppable chip rather than dropping the result).
 */
export function searchResultItem(
  result: VideoSearchResult,
  datasetId: string,
  maxSequenceFrames: number,
): ReviewItem | null {
  const frames = sampleSearchStates(result, maxSequenceFrames);
  const frame = searchResultFrame(result);
  if (frames.length === 0) {
    if (frame === null) return null;
    frames.push({ frame, bounds: null });
  }
  return {
    key: result.ref,
    datasetId,
    trackId: result.tracks[0]?.id ?? result.instance_id,
    primary: frames[0],
    frames,
    keyframeCount: result.tracks[0]?.states.length ?? 1,
    type: '',
    confidence: result.relevancy_score,
  };
}

/**
 * A new annotation track for a result, one keyframe per boxed state, so
 * the result can join its dataset's annotations with the given type. Null
 * when the result carries no box at all.
 */
export function searchResultTrack(result: VideoSearchResult, type: string): Omit<TrackData, 'id'> | null {
  const byFrame = new Map<number, Feature>();
  (result.tracks[0]?.states ?? []).forEach((state) => {
    if (!state.bbox || byFrame.has(state.frame)) return;
    const [x1, y1, x2, y2] = state.bbox;
    byFrame.set(state.frame, {
      frame: state.frame,
      keyframe: true,
      interpolate: false,
      bounds: [
        Math.round(Math.min(x1, x2)), Math.round(Math.min(y1, y2)),
        Math.round(Math.max(x1, x2)), Math.round(Math.max(y1, y2)),
      ],
    });
  });
  const features = Array.from(byFrame.values()).sort((a, b) => a.frame - b.frame);
  if (features.length === 0) return null;
  return {
    begin: features[0].frame,
    end: features[features.length - 1].frame,
    confidencePairs: [[type, 1]],
    attributes: {},
    features,
  };
}
