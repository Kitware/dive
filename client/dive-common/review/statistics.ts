import type { DatasetConfig } from 'dive-common/apispec';
import { parseFrameTimestamp } from 'dive-common/frameTimestamp';
import { resolveConfidenceThreshold } from 'dive-common/typeHierarchy';
import { DefaultConfidence } from 'vue-media-annotator/BaseFilterControls';
import type { TrackData } from 'vue-media-annotator/track';

export interface StatisticsDataset {
  config: DatasetConfig;
  tracks: Iterable<TrackData>;
  sequenceId?: string;
  sequenceName?: string;
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
  duration: number;
  unit: 's' | 'frames';
  /** Frames per unit of duration in the sequence's first camera, which the viewer opens on. */
  framesPerUnit: number;
  /** Last frame of that camera. */
  lastFrame: number;
  cameraCount: number;
  series: { name: string; bins: number[] }[];
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
  const groups = new Map<string, StatisticsDataset[]>();
  Array.from(datasets).forEach((dataset) => {
    const id = dataset.sequenceId ?? dataset.config.id;
    groups.set(id, [...(groups.get(id) ?? []), dataset]);
  });
  groups.forEach((cameras, id) => {
    const seconds = cameras.every(({ config }) => Number.isFinite(config.fps) && config.fps > 0);
    const intervals = new Map<string, Map<string, [number, number][]>>();
    let duration = 0;
    let timestamp: number | undefined;
    let firstCameraLastFrame = 0;
    cameras.forEach(({ config, tracks }, cameraIndex) => {
      const filters = config.confidenceFilters ?? { default: DefaultConfidence };
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
        const key = JSON.stringify(track.id);
        const byType = intervals.get(key) ?? new Map<string, [number, number][]>();
        const divisor = seconds ? config.fps : 1;
        const range: [number, number] = [begin / divisor, (end + 1) / divisor];
        const qualifyingTypes = types.size ? [...types] : ['(unclassified)'];
        qualifyingTypes.forEach((type) => byType.set(type, [...(byType.get(type) ?? []), range]));
        intervals.set(key, byType);
        count += 1;
      });
      duration = Math.max(duration, (lastFrame + 1) / (seconds ? config.fps : 1));
      if (cameraIndex === 0) firstCameraLastFrame = lastFrame;
      config.imageData.forEach((image) => {
        const time = image.timestamp ?? parseFrameTimestamp(image.filename);
        if (time !== undefined && Number.isFinite(time)) timestamp = Math.min(timestamp ?? time, time);
      });
      timestamp ??= parseFrameTimestamp(config.name);
      trackCount += count;
    });
    const totalDelta = new Array<number>(TIMELINE_BINS + 1).fill(0);
    const typeDeltas = new Map<string, number[]>();
    // Union ranges of the same track across cameras before accumulating them,
    // so a stereo track is represented once even where camera views overlap.
    function addRanges(target: number[], ranges: [number, number][]) {
      const delta = target;
      const bins = ranges.map(([begin, end]) => [
        Math.min(TIMELINE_BINS - 1, Math.floor((begin / duration) * TIMELINE_BINS)),
        Math.min(TIMELINE_BINS, Math.max(1, Math.ceil((end / duration) * TIMELINE_BINS))),
      ]).sort((a, b) => a[0] - b[0]);
      let first = -1;
      let last = -1;
      bins.forEach(([begin, end]) => {
        if (begin > last) {
          if (first >= 0) { delta[first] += 1; delta[last] -= 1; }
          first = begin;
          last = end;
        } else last = Math.max(last, end);
      });
      if (first >= 0) { delta[first] += 1; delta[last] -= 1; }
    }
    intervals.forEach((byType) => {
      addRanges(totalDelta, [...byType.values()].flat());
      byType.forEach((ranges, type) => {
        const delta = typeDeltas.get(type) ?? new Array<number>(TIMELINE_BINS + 1).fill(0);
        addRanges(delta, ranges);
        typeDeltas.set(type, delta);
      });
    });
    function accumulate(delta: number[]) {
      let active = 0;
      return delta.slice(0, TIMELINE_BINS).map((change) => { active += change; return active; });
    }
    timestamp ??= parseFrameTimestamp(cameras[0].sequenceName ?? '');
    timelines.push({
      id,
      name: cameras[0].sequenceName ?? cameras[0].config.name,
      timestamp,
      duration,
      unit: seconds ? 's' : 'frames',
      framesPerUnit: seconds ? cameras[0].config.fps : 1,
      lastFrame: firstCameraLastFrame,
      cameraCount: cameras.length,
      annotatedExtent: cameras.some(({ config }) => !config.imageData.length),
      count: intervals.size,
      bins: accumulate(totalDelta),
      series: [...typeDeltas].sort(([a], [b]) => a.localeCompare(b))
        .map(([name, delta]) => ({ name, bins: accumulate(delta) })),
    });
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

/** The most tracks present at once in a sequence: the top of its own count axis. */
export function timelinePeak(row: Pick<TimelineRow, 'bins'>): number {
  return row.bins.reduce((max, count) => Math.max(max, count), 1);
}

/** Whole counts to label on a count axis: none, the peak, and the middle when there is one. */
export function timelineTicks(peak: number): number[] {
  const top = Math.max(1, Math.round(peak));
  return [...new Set([0, Math.round(top / 2), top])];
}

/** Where a count sits in a plot of the given height, measured down from its top. */
export function timelineY(count: number, peak: number, height = 80): number {
  return height - (count / Math.max(1, peak)) * (height - 4);
}

/** The frame at a fraction of the way along a sequence's timeline. */
export function timelineFrame(
  row: Pick<TimelineRow, 'duration' | 'framesPerUnit' | 'lastFrame'>,
  fraction: number,
): number {
  const along = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const frame = Math.floor(along * row.duration * row.framesPerUnit);
  return Math.min(Math.max(0, row.lastFrame), Math.max(0, frame));
}

/** Step-after area: horizontal plateaus with vertical transitions, never diagonal spikes. */
export function timelineStepPath(bins: number[], peak: number, width = 1000, height = 80): string {
  if (!bins.length) return '';
  const scale = Math.max(1, peak);
  let path = `M0,${height}`;
  let previous = 0;
  bins.forEach((count, index) => {
    if (count !== previous) {
      path += ` H${(index / bins.length) * width} V${timelineY(count, scale, height)}`;
      previous = count;
    }
  });
  return `${path} H${width} V${height} Z`;
}
