import { computed, Ref } from 'vue';
import { clientSettings } from 'dive-common/store/settings';
import { AnnotationId } from 'vue-media-annotator/BaseAnnotation';
import Track from 'vue-media-annotator/track';
import type { TrackWithContext } from '../BaseFilterControls';
import type { TypeStyling } from '../StyleManager';

interface UseLineChartParams {
  enabledTracks: Readonly<Ref<readonly TrackWithContext[]>>;
  typeStyling: Ref<TypeStyling>;
  allTypes: Readonly<Ref<readonly string[]>>;
  getTracksMerged: (id: AnnotationId) => Track;

}

export interface LineChartData {
  values: [number, number][];
  color: string;
  name: string;
}

function updateHistogram(begin: number, end: number, histogram: number[]) {
  const beginval = histogram[begin];
  const endval = histogram[end];
  return [
    beginval === undefined ? 1 : beginval + 1,
    endval === undefined ? -1 : endval - 1,
  ];
}

function framesToSegments(frames: number[]): [number, number][] {
  if (frames.length === 0) return [];

  const sorted = [...frames].sort((a, b) => a - b);
  const segments: [number, number][] = [];

  let start = sorted[0];
  let end = start + 1;

  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === sorted[i - 1] + 1) {
      end = sorted[i] + 1;
    } else {
      segments.push([start, end]);
      start = sorted[i];
      end = start + 1;
    }
  }

  segments.push([start, end]);
  return segments;
}

export default function useLineChart({
  enabledTracks,
  typeStyling,
  allTypes,
  getTracksMerged,
}: UseLineChartParams) {
  const lineChartData = computed(() => {
    /* Histogram map contains multiple histograms keyed
     * on a type name, which comes from the list of
     * enabled types
     */
    const histograms = new Map<string, number[]>();
    histograms.set('total', [0]);
    allTypes.value.forEach((t) => histograms.set(t, [0]));

    /* In order to populate the histograms, generate and solve a
     * sort of "balanced parenthesis" problem.
     * For each begin time, push a 1, for each end time, push a -1.
     * Then iterate each histogram and generate its accumulation at each point.
     */
    enabledTracks.value.forEach((filtered) => {
      const { annotation: track } = filtered;
      if (clientSettings.timelineCountSettings.defaultView === 'detections') {
        const trackObj = getTracksMerged(track.id);
        const frames = trackObj.features.filter((item) => item.keyframe).map((item) => item.frame);
        const segments = framesToSegments(frames);
        segments.forEach((segment) => {
          const ibegin = segment[0];
          const iend = segment[1] > segment[0] ? segment[1] : segment[0] + 1;
          if (clientSettings.timelineCountSettings.totalCount) {
            const totalArr = histograms.get('total') as number[];
            [totalArr[ibegin], totalArr[iend]] = updateHistogram(ibegin, iend, totalArr);
          }
          const trackType = track.getType(filtered.context.confidencePairIndex);
          const typeArr = histograms.get(trackType) as number[];
          [typeArr[ibegin], typeArr[iend]] = updateHistogram(ibegin, iend, typeArr);
        });
      } else {
        const ibegin = track.begin;
        const iend = track.end > track.begin ? track.end : track.begin + 1;

        if (clientSettings.timelineCountSettings.totalCount) {
          const totalArr = histograms.get('total') as number[];
          [totalArr[ibegin], totalArr[iend]] = updateHistogram(ibegin, iend, totalArr);
        }
        const trackType = track.getType(filtered.context.confidencePairIndex);
        const typeArr = histograms.get(trackType) as number[];
        [typeArr[ibegin], typeArr[iend]] = updateHistogram(ibegin, iend, typeArr);
      }
    });

    const mapfunc = typeStyling.value.color;
    /* Now, each histograms array looks like this:
     *   [1, 2, 0, -2, -1]
     * We want to accumulate each array left-to-right so it looks like this:
     *   [1, 3, 3, 1, 0]
     */
    return Array.from(histograms.entries())
      .map(([type, arr]) => {
        const accumulatedHistogram = [] as [number, number][];
        arr.reduce((prev, current, i) => {
          accumulatedHistogram.push([i, prev + current]);
          return prev + current;
        }, 0);
        return {
          values: accumulatedHistogram,
          color: type === 'total' ? 'lime' : mapfunc(type),
          name: type,
        };
      }) as LineChartData[];
  });

  return { lineChartData };
}
