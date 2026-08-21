import fs from 'fs-extra';
import mockfs from 'mock-fs';
import { AnnotationSchema } from 'dive-common/apispec';
import { AnnotationsCurrentVersion, JsonConfig } from 'platform/desktop/constants';
import {
  filterTracks,
  frameRateFromDocument,
  migrate,
  serializeFile,
} from 'platform/desktop/backend/serializers/dive';

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

beforeEach(() => {
  mockfs({
    '/output': {},
  });
});

afterEach(() => {
  mockfs.restore();
});

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

  it('clones kept tracks with threshold- and type-pruned raw confidence pairs', () => {
    const data: AnnotationSchema = {
      version: AnnotationsCurrentVersion,
      groups: {},
      tracks: {
        1: {
          id: 1,
          begin: 0,
          end: 0,
          attributes: {},
          confidencePairs: [['fish', 0.9], ['shark', 0.2], ['whale', 0.8], ['zero', 0]],
          features: [{ frame: 0, bounds: [0, 0, 1, 1] }],
        },
      },
    };
    const original = data.tracks[1].confidencePairs.map(([name, score]) => [name, score]);
    const meta = {
      confidenceFilters: { default: 0.1, fish: 0.95, zero: 0 },
    } as unknown as JsonConfig;

    const filtered = filterTracks(data, meta, new Set(['fish', 'whale', 'zero']), {
      excludeBelowThreshold: true,
      header: true,
    });

    expect(filtered).not.toBe(data);
    expect(filtered.tracks[1]).not.toBe(data.tracks[1]);
    expect(filtered.tracks[1].confidencePairs).toEqual([['whale', 0.8], ['zero', 0]]);
    expect(data.tracks[1].confidencePairs).toEqual(original);
  });
});

describe('DIVE JSON annotation fps', () => {
  it('writes fps from dataset meta on export and restores it on migrate', async () => {
    await serializeFile('/output/out.json', annotationSchema, { ...imageMeta, fps: 5 });
    const out = await fs.readJSON('/output/out.json');
    expect(out.fps).toBe(5);
    expect(migrate(out).fps).toBe(5);
  });

  it('omits fps when dataset meta rate is unusable', async () => {
    await serializeFile('/output/zero.json', annotationSchema, { ...imageMeta, fps: 0 });
    const out = await fs.readJSON('/output/zero.json');
    expect(out).not.toHaveProperty('fps');
  });

  it('preserves a usable fps through migrate and drops unusable values', () => {
    expect(migrate({ ...annotationSchema, fps: 29.97 }).fps).toBe(29.97);
    expect(migrate({ ...annotationSchema, fps: 0 }).fps).toBeUndefined();
    expect(migrate({ ...annotationSchema, fps: '5' }).fps).toBeUndefined();
    expect(migrate({ ...annotationSchema, fps: Number.POSITIVE_INFINITY }).fps).toBeUndefined();
    expect(migrate(annotationSchema).fps).toBeUndefined();
  });

  it('frameRateFromDocument mirrors migrate validation', () => {
    expect(frameRateFromDocument({ fps: 5 })).toBe(5);
    expect(frameRateFromDocument({ fps: 0 })).toBeUndefined();
    expect(frameRateFromDocument({ fps: true })).toBeUndefined();
    expect(frameRateFromDocument(null)).toBeUndefined();
  });
});
