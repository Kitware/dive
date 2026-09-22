import { parseViewerFocus, reviewViewerLocation } from './viewerNavigation';

describe('review viewer navigation', () => {
  it('round-trips a frame and track through the query', () => {
    const location = reviewViewerLocation('abc', { frame: 12, trackId: 7 });
    expect(location).toEqual({ name: 'viewer', params: { id: 'abc' }, query: { frame: '12', track: '7' } });
    expect(parseViewerFocus(location.query)).toEqual({ frame: 12, trackId: 7 });
  });

  it('ignores missing or malformed values', () => {
    expect(reviewViewerLocation('abc', {}).query).toEqual({});
    expect(parseViewerFocus({ frame: 'x', track: ['3'] })).toEqual({ trackId: 3 });
    expect(parseViewerFocus({ frame: '-1' })).toEqual({});
  });
});
