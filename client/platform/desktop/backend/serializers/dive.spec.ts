import { AnnotationSchema } from 'dive-common/apispec';
import { AnnotationsCurrentVersion, JsonConfig } from 'platform/desktop/constants';
import { filterTracks } from 'platform/desktop/backend/serializers/dive';

const annotationSchema: AnnotationSchema = {
  version: AnnotationsCurrentVersion,
  groups: {},
  tracks: {
    4: {
      id: 4,
      begin: 0,
      end: 0,
      confidencePairs: [['root', 0.2], ['leaf', 0.8]],
      attributes: {},
      features: [{ frame: 0, bounds: [0, 0, 4, 4] }],
    },
  },
};

const imageMeta = {
  version: 1,
  id: 'dataset_1',
  type: 'image-sequence',
  name: 'dataset-one',
  createdAt: 'now',
  originalFps: 1,
  originalVideoFile: '',
  transcodedVideoFile: '',
  transcodedImageFiles: [],
  fps: 1,
  originalBasePath: '/data',
  originalImageFiles: ['frame_000000.jpg'],
  confidenceFilters: { default: 0.5 },
  multiCam: null,
  subType: null,
} as JsonConfig;

describe('DIVE JSON filterTracks', () => {
  it('prunes type-filtered pairs without mutating the source track', () => {
    const source = structuredClone(annotationSchema);
    const exported = filterTracks(source, imageMeta, new Set(['leaf']));

    expect(exported.tracks[4].confidencePairs).toEqual([['leaf', 0.8]]);
    expect(source.tracks[4].confidencePairs).toEqual([['root', 0.2], ['leaf', 0.8]]);
  });

  it('prunes pairs below threshold without mutating the source track', () => {
    const source = structuredClone(annotationSchema);
    const exported = filterTracks(source, imageMeta, new Set(), {
      excludeBelowThreshold: true,
      header: true,
    });

    expect(exported.tracks[4].confidencePairs).toEqual([['leaf', 0.8]]);
    expect(source.tracks[4].confidencePairs).toEqual([['root', 0.2], ['leaf', 0.8]]);
  });

  it('omits a track when no pairs remain', () => {
    const source = structuredClone(annotationSchema);
    const exported = filterTracks(source, imageMeta, new Set(['missing']));

    expect(exported.tracks[4]).toBeUndefined();
    expect(source.tracks[4].confidencePairs).toEqual([['root', 0.2], ['leaf', 0.8]]);
  });
});
