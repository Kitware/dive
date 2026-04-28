/// <reference types="jest" />
import fs from 'fs-extra';
import mockfs from 'mock-fs';
import { AnnotationSchema } from 'dive-common/apispec';
import { AnnotationsCurrentVersion, JsonMeta } from 'platform/desktop/constants';
import { isCocoJson, parseFile, serializeFile } from 'platform/desktop/backend/serializers/coco';

const cocoInput = {
  images: [{ id: 1, file_name: 'frame_000001.jpg', frame_index: 1 }],
  annotations: [
    {
      id: 1,
      image_id: 1,
      category_id: 5,
      bbox: [10, 20, 30, 40],
      score: 0.9,
      track_id: 7,
      dive_detection_attributes: { occluded: true, quality: 'low' },
      dive_track_attributes: { source: 'reviewed' },
      segmentation: [
        [10, 20, 40, 20, 40, 60, 10, 60],
      ],
      keypoints: [12, 22, 2, 35, 55, 2],
      num_keypoints: 2,
    },
  ],
  categories: [{ id: 5, name: 'fish', keypoints: ['head', 'tail'] }],
};

const annotationSchema: AnnotationSchema = {
  version: AnnotationsCurrentVersion,
  groups: {},
  tracks: {
    3: {
      id: 3,
      begin: 0,
      end: 0,
      confidencePairs: [['fish', 0.95]],
      attributes: { reviewer: 'alice' },
      features: [
        {
          frame: 0,
          bounds: [100, 200, 150, 280],
          attributes: { visibility: 'poor' },
        },
      ],
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
  confidenceFilters: { default: 0.1 },
  multiCam: null,
  subType: null,
} as JsonMeta;

beforeEach(() => {
  mockfs({
    '/input': {
      'coco.json': JSON.stringify(cocoInput),
    },
    '/output': {},
  });
});

describe('COCO serializer', () => {
  it('detects base coco shape', () => {
    expect(isCocoJson(cocoInput)).toBe(true);
    expect(isCocoJson({ images: [], annotations: [] })).toBe(false);
  });

  it('parses COCO with DIVE extension attributes', async () => {
    const [parsed] = await parseFile('/input/coco.json');
    const track = parsed.tracks[7];
    expect(track.id).toBe(7);
    expect(track.begin).toBe(1);
    expect(track.end).toBe(1);
    expect(track.attributes).toEqual({ source: 'reviewed' });
    expect(track.features[0].attributes).toEqual({ occluded: true, quality: 'low' });
    expect(track.features[0].geometry?.features.length).toBe(4);
    const geometryTypes = track.features[0].geometry?.features.map((f) => f.geometry.type) || [];
    expect(geometryTypes).toEqual(expect.arrayContaining(['Polygon', 'Point', 'LineString']));
  });

  it('serializes COCO with DIVE extension attributes', async () => {
    await serializeFile('/output/out.coco.json', annotationSchema, imageMeta);
    const out = await fs.readJSON('/output/out.coco.json');
    expect(out.info.dive_extensions).toEqual([
      'dive_detection_attributes',
      'dive_track_attributes',
    ]);
    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].dive_detection_attributes).toEqual({ visibility: 'poor' });
    expect(out.annotations[0].dive_track_attributes).toEqual({ reviewer: 'alice' });
  });
});

afterEach(() => {
  mockfs.restore();
});
