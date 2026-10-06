import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_SOURCE_QUERY,
  desktopViewerLocation,
  scoringSourceUsesPreview,
  webViewerLocation,
} from './viewerNavigation';

describe('webViewerLocation', () => {
  it('opens the current annotations when no set or revision is set', () => {
    expect(webViewerLocation({ datasetId: 'abc' })).toEqual({
      name: 'viewer',
      params: { id: 'abc' },
    });
  });

  it('opens an annotation set', () => {
    expect(webViewerLocation({ datasetId: 'abc', set: 'training' })).toEqual({
      name: 'set viewer',
      params: { id: 'abc', set: 'training' },
    });
  });

  it('treats the default set like current annotations', () => {
    expect(webViewerLocation({ datasetId: 'abc', set: 'default' })).toEqual({
      name: 'viewer',
      params: { id: 'abc' },
    });
  });

  it('opens a revision', () => {
    expect(webViewerLocation({ datasetId: 'abc', revision: 4 })).toEqual({
      name: 'revision viewer',
      params: { id: 'abc', revision: '4' },
    });
  });

  it('opens a revision within a set', () => {
    expect(webViewerLocation({ datasetId: 'abc', set: 'training', revision: 4 })).toEqual({
      name: 'revision set viewer',
      params: { id: 'abc', set: 'training', revision: '4' },
    });
  });

  it('adds an annotation source label for preview routes', () => {
    expect(webViewerLocation(
      { datasetId: 'abc', revision: 2 },
      'My data · rev 2',
    )).toEqual({
      name: 'revision viewer',
      params: { id: 'abc', revision: '2' },
      query: { [ANNOTATION_SOURCE_QUERY]: 'My data · rev 2' },
    });
  });

  it('omits the label for current annotations', () => {
    expect(webViewerLocation({ datasetId: 'abc' }, 'My data')).toEqual({
      name: 'viewer',
      params: { id: 'abc' },
    });
  });
});

describe('scoringSourceUsesPreview', () => {
  it('is false for the current annotations', () => {
    expect(scoringSourceUsesPreview({ datasetId: 'abc' })).toBe(false);
    expect(scoringSourceUsesPreview({ datasetId: 'abc', set: 'default' })).toBe(false);
  });

  it('is true for alternate sources', () => {
    expect(scoringSourceUsesPreview({ datasetId: 'abc', revision: 1 })).toBe(true);
    expect(scoringSourceUsesPreview({ datasetId: 'abc', set: 'training' })).toBe(true);
    expect(scoringSourceUsesPreview({ datasetId: 'abc', file: '/tmp/old.json' })).toBe(true);
  });
});

describe('desktopViewerLocation', () => {
  it('opens the dataset viewer', () => {
    expect(desktopViewerLocation({ datasetId: 'abc' })).toEqual({
      name: 'viewer',
      params: { id: 'abc' },
    });
  });

  it('passes auxiliary annotation files as a query parameter', () => {
    expect(desktopViewerLocation({
      datasetId: 'abc',
      file: '/data/auxiliary/result_old.json',
    }, 'result_old.json')).toEqual({
      name: 'viewer',
      params: { id: 'abc' },
      query: {
        scoringFile: '/data/auxiliary/result_old.json',
        [ANNOTATION_SOURCE_QUERY]: 'result_old.json',
      },
    });
  });
});
