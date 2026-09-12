import { videoSearchFormulate, videoSearchOpenIndex, videoSearchRefine } from './api';
import { createVideoSearch } from './useVideoSearch';

vi.mock('./api', () => ({
  videoSearchFormulate: vi.fn(), videoSearchOpenIndex: vi.fn(), videoSearchRefine: vi.fn(),
}));

const results = [
  { ref: 'one', stream_id: 'left', relevancy_score: 0.8 },
  { ref: 'two', stream_id: 'right', relevancy_score: 0.7 },
];
beforeEach(() => {
  vi.mocked(videoSearchOpenIndex).mockResolvedValue({
    success: true,
    streams: [
      { streamName: 'left', datasetId: 'a', name: 'Alpha' },
      { streamName: 'right', datasetId: 'b', name: 'Beta' },
    ],
  });
  vi.mocked(videoSearchFormulate).mockResolvedValue({ results } as never);
  vi.mocked(videoSearchRefine).mockResolvedValue({ results: [...results].reverse() } as never);
});

it('limits query and refined results to the selected indexed sequence', async () => {
  const search = createVideoSearch('a', () => null);
  search.selectIndex('right');
  await search.queryFromImage('image.jpg');
  expect(search.state.results.map((r) => r.ref)).toEqual(['two']);
  search.mark('two', 'positive');
  await search.refine();
  expect(search.state.results.map((r) => r.ref)).toEqual(['two']);
  expect(videoSearchRefine).toHaveBeenCalledWith(['two'], []);
});

it('clears old results, feedback, and models when switching indexes and supports all sequences', async () => {
  const search = createVideoSearch('a', () => null);
  search.selectIndex('left');
  await search.queryFromImage('image.jpg');
  search.mark('one', 'negative');
  search.state.modelAvailable = true;
  search.selectIndex(null);
  expect(search.state).toMatchObject({
    results: [], adjudications: {}, modelAvailable: false, iteration: 0,
  });
  await search.queryFromImage('image.jpg');
  expect(search.state.results).toEqual(results);
});

it('does not switch indexes while a query is running', () => {
  const search = createVideoSearch('a', () => null);
  search.selectIndex('left');
  search.state.busy = 'Searching';
  search.selectIndex('right');
  expect(search.state.selectedStream).toBe('left');
});
