import { computed, Ref } from '@vue/composition-api';
import type { TrackWithContext } from '../BaseFilterControls';
import type { TypeStyling } from '../StyleManager';

interface UseLineChartParams {
  enabledTracks: Readonly<Ref<readonly TrackWithContext[]>>;
  typeStyling: Ref<TypeStyling>;
  allTypes: Readonly<Ref<readonly string[]>>;
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

export default function useLineChart({
  enabledTracks,
  typeStyling,
  allTypes,
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
      const totalArr = histograms.get('total') as number[];
      const ibegin = track.begin;
      const iend = track.end > track.begin ? track.end : track.begin + 1;
      [totalArr[ibegin], totalArr[iend]] = updateHistogram(ibegin, iend, totalArr);
      const trackType = track.getType(filtered.context.confidencePairIndex)[0];
      const typeArr = histograms.get(trackType) as number[];
      [typeArr[ibegin], typeArr[iend]] = updateHistogram(ibegin, iend, typeArr);
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
