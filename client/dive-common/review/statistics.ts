import type { DatasetConfig } from 'dive-common/apispec';
import { parseFrameTimestamp } from 'dive-common/frameTimestamp';
import { resolveConfidenceThreshold } from 'dive-common/typeHierarchy';
import { DefaultConfidence } from 'vue-media-annotator/BaseFilterControls';
import type { TrackData } from 'vue-media-annotator/track';

export interface StatisticsDataset {
  config: DatasetConfig;
  tracks: Iterable<TrackData>;
}
export interface CountRow {
  key: string;
  name: string;
  value: string;
  scope: string;
  count: number;
}
export interface TimelineRow {
  id: string;
  name: string;
  timestamp?: number;
  fps: number;
  frameCount: number;
  annotatedExtent: boolean;
  count: number;
  bins: number[];
}
export interface ReviewStatistics {
  categories: CountRow[];
  attributes: CountRow[];
  timelines: TimelineRow[];
  trackCount: number;
}

/** Fixed-size timelines avoid rendering one SVG element per annotation. */
export const TIMELINE_BINS = 200;

export function buildReviewStatistics(datasets: Iterable<StatisticsDataset>): ReviewStatistics {
  const categories = new Map<string, CountRow>();
  const attributes = new Map<string, CountRow>();
  const timelines: TimelineRow[] = [];
  let trackCount = 0;
  function increment(map: Map<string, CountRow>, name: string, value = '', scope = '') {
    const key = JSON.stringify([name, value, scope]);
    const row = map.get(key) ?? {
      key, name, value, scope, count: 0,
    };
    row.count += 1;
    map.set(key, row);
  }
  function countAttributes(values: Record<string, unknown> | undefined, scope: string) {
    Object.entries(values ?? {}).forEach(([name, value]) => {
      // userAttributes contains schema metadata, not annotation values.
      if (name !== 'userAttributes' && value !== null && value !== undefined) {
        increment(attributes, name, typeof value === 'object' ? JSON.stringify(value) : String(value), scope);
      }
    });
  }
  Array.from(datasets).forEach(({ config, tracks }) => {
    const filters = config.confidenceFilters ?? { default: DefaultConfidence };
    const intervals: [number, number][] = [];
    let lastFrame = Math.max(0, config.imageData.length - 1);
    let count = 0;
    Array.from(tracks).forEach((track) => {
      const begin = Math.max(0, Number.isFinite(track.begin) ? track.begin : 0);
      const end = Math.max(begin, Number.isFinite(track.end) ? track.end : begin);
      lastFrame = Math.max(lastFrame, end);
      const types = new Set(track.confidencePairs
        .filter(([name, confidence]) => Number.isFinite(confidence)
          && confidence >= resolveConfidenceThreshold(filters, name))
        .map(([name]) => name));
      if (!types.size && track.confidencePairs.length) return;
      types.forEach((name) => increment(categories, name));
      if (!types.size) increment(categories, '(unclassified)');
      countAttributes(track.attributes, 'Track');
      track.features.forEach((feature) => countAttributes(feature.attributes, 'Detection'));
      intervals.push([begin, end]);
      count += 1;
    });
    const frameCount = lastFrame + 1;
    const delta = new Array<number>(TIMELINE_BINS + 1).fill(0);
    intervals.forEach(([begin, end]) => {
      const first = Math.min(TIMELINE_BINS - 1, Math.floor((begin / frameCount) * TIMELINE_BINS));
      const last = Math.min(TIMELINE_BINS - 1, Math.floor((end / frameCount) * TIMELINE_BINS));
      delta[first] += 1;
      delta[last + 1] -= 1;
    });
    let active = 0;
    const bins = delta.slice(0, TIMELINE_BINS).map((change) => { active += change; return active; });
    let timestamp: number | undefined;
    config.imageData.forEach((image) => {
      const time = image.timestamp ?? parseFrameTimestamp(image.filename);
      if (time !== undefined && Number.isFinite(time)) timestamp = Math.min(timestamp ?? time, time);
    });
    timestamp ??= parseFrameTimestamp(config.name);
    timelines.push({
      id: config.id,
      name: config.name,
      timestamp,
      fps: config.fps,
      frameCount,
      annotatedExtent: !config.imageData.length,
      count,
      bins,
    });
    trackCount += count;
  });
  const sorted = (rows: Map<string, CountRow>) => [...rows.values()]
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  timelines.sort((a, b) => {
    if (a.timestamp !== undefined && b.timestamp !== undefined) {
      return b.timestamp - a.timestamp || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    }
    if (a.timestamp !== undefined) return -1;
    if (b.timestamp !== undefined) return 1;
    return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  });
  return {
    categories: sorted(categories), attributes: sorted(attributes), timelines, trackCount,
  };
}
