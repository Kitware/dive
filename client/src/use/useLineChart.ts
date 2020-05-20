import { computed, Ref } from '@vue/composition-api';
import Track from '@/lib/track';
import { TrackId } from '@/use/useTrackStore';

interface UseLineChartParams {
  enabledTrackIds: Readonly<Ref<readonly TrackId[]>>;
  typeColorMapper: (type: string) => unknown;
  trackMap: Map<TrackId, Track>;
  allTypes: Readonly<Ref<readonly string[]>>;
}

interface LineChartData {
  values: [number, number][];
  color: string;
  name: string;
}

function updateHistogram(track: Track, histogram: number[]) {
  const beginval = histogram[track.begin.value];
  const endval = histogram[track.end.value];
  return [
    beginval === undefined ? 1 : beginval + 1,
    endval === undefined ? -1 : endval - 1,
  ];
}

export default function useLineChart({
  enabledTrackIds,
  typeColorMapper,
  trackMap,
  allTypes,
}: UseLineChartParams) {
  const lineChartData = computed(() => {
    /* Histogram map contains multiple histograms keyed
     * on a type name, which comes from the list of
     * enabled types
     */
    const histograms = new Map<string, number[]>();
    histograms.set('total', []);
    allTypes.value.forEach((t) => histograms.set(t, []));

    /* In order to populate the histograms, generate and solve a
     * sort of "balanced parenthesis" problem.
     * For each begin time, push a 1, for each end time, push a -1.
     * Then iterate each histogram and generate its accumulation at each point.
     */
    enabledTrackIds.value.forEach((trackId) => {
      const track = trackMap.get(trackId)!;
      const totalArr = histograms.get('total')!;
      [totalArr[track.begin.value], totalArr[track.end.value]] = updateHistogram(track, totalArr);
      const confidencePairs = track.confidencePairs.value;
      if (confidencePairs.length) {
        const trackType = confidencePairs[0][0];
        const typeArr = histograms.get(trackType)!;
        [typeArr[track.begin.value], typeArr[track.end.value]] = updateHistogram(track, typeArr);
      }
    });

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
          color: type === 'total' ? 'lime' : typeColorMapper(type),
          name: type,
        };
      }) as LineChartData[];
  });

  return { lineChartData };
}
