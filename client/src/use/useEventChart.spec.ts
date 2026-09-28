import { ref, Ref } from 'vue';
import type { AnnotationWithContext } from '../BaseFilterControls';
import type { SortedAnnotation } from '../BaseAnnotationStore';
import type Track from '../track';
import type { TypeStyling } from '../StyleManager';
import useEventChart from './useEventChart';

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

describe('useEventChart display context', () => {
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
    const enabledTracks: Ref<AnnotationWithContext<Track>[]> = ref([{
      annotation,
      context: { confidencePairIndex: index },
    }]);
    const { eventChartData } = useEventChart({
      enabledTracks,
      selectedTrackIds: ref([]),
      typeStyling,
      getTrackProjection: vi.fn(),
    });

    expect(eventChartData.value.values).toEqual([expect.objectContaining({
      id: 7,
      type: expected,
      color: `color:${expected}`,
      range: [3, 9],
    })]);
  });
});

describe('useEventChart on an aligned timeline', () => {
  it('draws the range and markers at timeline slots when they are provided', () => {
    const annotation = makeSorted([['fish', 0.9]]);
    const enabledTracks: Ref<AnnotationWithContext<Track>[]> = ref([{
      annotation,
      context: { confidencePairIndex: 0 },
    }]);
    const getTrackProjection = vi.fn();
    const { eventChartData } = useEventChart({
      enabledTracks,
      selectedTrackIds: ref([7]),
      typeStyling,
      getTrackProjection,
      timelineRange: () => [4, 10],
      timelineFeatures: () => [{ frame: 4, keyframe: true, interpolate: false }],
    });

    expect(eventChartData.value.values[0]).toEqual(expect.objectContaining({
      range: [4, 10],
      markers: [[4, false]],
    }));
    expect(getTrackProjection).not.toHaveBeenCalled();
  });
});
