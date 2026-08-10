/// <reference types="vitest" />
import { ref, Ref } from 'vue';
import { clientSettings } from 'dive-common/store/settings';
import type { TrackWithContext } from '../BaseFilterControls';
import type { SortedAnnotation } from '../BaseAnnotationStore';
import type Track from '../track';
import type { TypeStyling } from '../StyleManager';
import useLineChart from './useLineChart';

function makeSorted(confidencePairs: [string, number][]): SortedAnnotation<Track> {
  return {
    id: 7,
    begin: 3,
    end: 9,
    confidencePairs,
    getType: (index = 0) => confidencePairs[index][0],
  };
}

const typeStyling = ref({
  color: (type: string) => `color:${type}`,
  strokeWidth: () => 1,
  fill: () => false,
  opacity: () => 1,
  labelSettings: () => ({ showLabel: true, showConfidence: true }),
  annotationSetColor: () => '#fff',
} as TypeStyling);

describe('useLineChart display context', () => {
  beforeEach(() => {
    clientSettings.timelineCountSettings.defaultView = 'tracks';
    clientSettings.timelineCountSettings.totalCount = false;
  });

  it.each([
    {
      name: 'monotone hierarchy leaf',
      pairs: [['root', 0.9], ['leaf', 0.7]] as [string, number][],
      index: 1,
      expected: 'leaf',
    },
    {
      name: 'non-monotone hierarchy leaf',
      pairs: [['leaf', 0.9], ['root', 0.7]] as [string, number][],
      index: 0,
      expected: 'leaf',
    },
    {
      name: 'unchecked leaf roll-up',
      pairs: [['root', 0.9], ['leaf', 0.7]] as [string, number][],
      index: 0,
      expected: 'root',
    },
  ])('uses the controller-selected pair for $name', ({ pairs, index, expected }) => {
    const annotation = makeSorted(pairs);
    const enabledTracks: Ref<TrackWithContext[]> = ref([{
      annotation,
      context: { confidencePairIndex: index },
    }]);
    const { lineChartData } = useLineChart({
      enabledTracks,
      allTypes: ref(['root', 'leaf']),
      typeStyling,
      getTracksMerged: vi.fn(),
    });

    const selectedSeries = lineChartData.value.find(({ name }) => name === expected);
    expect(selectedSeries).toEqual(expect.objectContaining({
      name: expected,
      color: `color:${expected}`,
    }));
    expect(selectedSeries?.values).toEqual(expect.arrayContaining([[3, 1], [9, 0]]));
    const other = expected === 'leaf' ? 'root' : 'leaf';
    expect(lineChartData.value.find(({ name }) => name === other)?.values)
      .toEqual([[0, 0]]);
  });
});
