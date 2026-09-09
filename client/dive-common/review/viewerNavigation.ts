/**
 * Deep links from the review grid into the annotation viewer: the viewer
 * route plus query parameters naming the frame to seek to and the track to
 * select once media is ready.
 */
export const VIEWER_FRAME_QUERY = 'frame';
export const VIEWER_TRACK_QUERY = 'track';

export interface ViewerFocus {
  frame?: number;
  trackId?: number;
}

export interface ReviewViewerLocation {
  name: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

/** Both platforms name their single-dataset viewer route `viewer` with an `id` param. */
export function reviewViewerLocation(
  datasetId: string,
  focus: ViewerFocus,
): ReviewViewerLocation {
  const query: Record<string, string> = {};
  if (focus.frame !== undefined) query[VIEWER_FRAME_QUERY] = String(focus.frame);
  if (focus.trackId !== undefined) query[VIEWER_TRACK_QUERY] = String(focus.trackId);
  return { name: 'viewer', params: { id: datasetId }, query };
}

function integerParam(value: unknown): number | undefined {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || !/^-?\d+$/.test(text)) return undefined;
  return Number(text);
}

/** Read the focus back out of a route query (unknown values are ignored). */
export function parseViewerFocus(query: Record<string, unknown>): ViewerFocus {
  const frame = integerParam(query[VIEWER_FRAME_QUERY]);
  const trackId = integerParam(query[VIEWER_TRACK_QUERY]);
  const focus: ViewerFocus = {};
  if (frame !== undefined && frame >= 0) focus.frame = frame;
  if (trackId !== undefined) focus.trackId = trackId;
  return focus;
}
