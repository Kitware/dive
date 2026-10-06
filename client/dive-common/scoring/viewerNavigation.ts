import type { ScoringSource } from './types';

/** Route payload for opening a scored annotation source in the viewer. */
export interface ScoringViewerLocation {
  name: string;
  params: Record<string, string>;
  query?: Record<string, string>;
}

export const ANNOTATION_SOURCE_QUERY = 'annotationSource';

/** True when the viewer should load something other than the dataset's current annotations. */
export function scoringSourceUsesPreview(source: ScoringSource): boolean {
  return source.revision !== undefined
    || (source.set !== undefined && source.set !== 'default')
    || !!source.file;
}

function withSourceLabel(
  location: ScoringViewerLocation,
  source: ScoringSource,
  sourceLabel?: string,
): ScoringViewerLocation {
  if (!scoringSourceUsesPreview(source) || !sourceLabel) return location;
  return {
    ...location,
    query: { ...location.query, [ANNOTATION_SOURCE_QUERY]: sourceLabel },
  };
}

/**
 * Girder web viewer route for a scoring source: revision, annotation set, or
 * the dataset's current annotations when neither is set.
 */
export function webViewerLocation(source: ScoringSource, sourceLabel?: string): ScoringViewerLocation {
  const { datasetId, revision, set } = source;
  if (set && set !== 'default' && revision !== undefined) {
    return withSourceLabel({
      name: 'revision set viewer',
      params: { id: datasetId, set, revision: String(revision) },
    }, source, sourceLabel);
  }
  if (revision !== undefined) {
    return withSourceLabel({
      name: 'revision viewer',
      params: { id: datasetId, revision: String(revision) },
    }, source, sourceLabel);
  }
  if (set && set !== 'default') {
    return withSourceLabel({
      name: 'set viewer',
      params: { id: datasetId, set },
    }, source, sourceLabel);
  }
  return {
    name: 'viewer',
    params: { id: datasetId },
  };
}

/**
 * Desktop viewer route. Revision and set are web-only; an auxiliary annotation
 * file is passed as a query parameter for optional preview loading.
 */
export function desktopViewerLocation(source: ScoringSource, sourceLabel?: string): ScoringViewerLocation {
  const location: ScoringViewerLocation = {
    name: 'viewer',
    params: { id: source.datasetId },
  };
  if (source.file) {
    location.query = { scoringFile: source.file };
  }
  return withSourceLabel(location, source, sourceLabel);
}
