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
      dive_notes: ['primary note', 'secondary note'],
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
          notes: ['exported note'],
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
    const [parsed, , warnings] = await parseFile('/input/coco.json');
    expect(warnings).toEqual([]);
    const track = parsed.tracks[7];
    expect(track.id).toBe(7);
    expect(track.begin).toBe(1);
    expect(track.end).toBe(1);
    expect(track.attributes).toEqual({ source: 'reviewed' });
    expect(track.features[0].attributes).toEqual({ occluded: true, quality: 'low' });
    expect(track.features[0].notes).toEqual(['primary note', 'secondary note']);
    expect(track.features[0].geometry?.features.length).toBe(4);
    const geometryTypes = track.features[0].geometry?.features.map((f) => f.geometry.type) || [];
    expect(geometryTypes).toEqual(expect.arrayContaining(['Polygon', 'Point', 'LineString']));
  });

  it('throws a descriptive error when bbox and polygon are both missing', async () => {
    mockfs({
      '/input': {
        'coco_no_bbox.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame_000001.jpg', frame_index: 0 }],
          annotations: [{
            id: 2,
            image_id: 1,
            category_id: 5,
            iscrowd: 1,
            segmentation: { size: [100, 100], counts: 'abc' },
          }],
          categories: [{ id: 5, name: 'fish' }],
        }),
      },
    });
    await expect(parseFile('/input/coco_no_bbox.json')).rejects.toThrow(/no bbox and no usable polygon/);
    await expect(parseFile('/input/coco_no_bbox.json')).rejects.toThrow(/RLE segmentation masks still require a bbox/);
  });

  it('derives bbox from polygon when bbox is omitted', async () => {
    mockfs({
      '/input': {
        'coco_polygon_only.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame_000001.jpg', frame_index: 0 }],
          annotations: [{
            id: 3,
            image_id: 1,
            category_id: 5,
            track_id: 401,
            segmentation: [[120, 80, 200, 80, 200, 120, 120, 120]],
          }],
          categories: [{ id: 5, name: 'fish' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/coco_polygon_only.json');
    expect(parsed.tracks[401].features[0].bounds).toEqual([120, 80, 200, 120]);
    expect(parsed.tracks[401].features[0].geometry?.features.length).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('imports polygon segmentations and warns on RLE in the same file', async () => {
    mockfs({
      '/input': {
        'coco_mixed.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame_000001.jpg', frame_index: 0 }],
          annotations: [
            {
              id: 1,
              image_id: 1,
              category_id: 5,
              bbox: [120, 80, 80, 40],
              track_id: 301,
              segmentation: [[120, 80, 200, 80, 200, 120, 120, 120]],
            },
            {
              id: 2,
              image_id: 1,
              category_id: 5,
              bbox: [400, 200, 200, 60],
              track_id: 302,
              iscrowd: 1,
              segmentation: { size: [1080, 1920], counts: 'abc' },
            },
          ],
          categories: [{ id: 5, name: 'fish' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/coco_mixed.json');
    expect(parsed.tracks[301].features[0].geometry?.features.length).toBe(1);
    expect(parsed.tracks[302].features[0].geometry).toBeUndefined();
    expect(warnings).toHaveLength(1);
  });

  it('imports bbox when RLE masks are present and returns a warning', async () => {
    mockfs({
      '/input': {
        'coco_rle.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame_000001.jpg', frame_index: 1 }],
          annotations: [{
            id: 2,
            image_id: 1,
            category_id: 5,
            bbox: [10, 20, 30, 40],
            track_id: 8,
            iscrowd: 1,
            segmentation: { size: [100, 100], counts: 'abc' },
          }],
          categories: [{ id: 5, name: 'fish' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/coco_rle.json');
    expect(parsed.tracks[8].features[0].bounds).toEqual([10, 20, 40, 60]);
    expect(parsed.tracks[8].features[0].geometry).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('segmentation masks');
  });

  it('serializes COCO with DIVE extension attributes', async () => {
    await serializeFile('/output/out.coco.json', annotationSchema, imageMeta);
    const out = await fs.readJSON('/output/out.coco.json');
    expect(out.info.dive_extensions).toEqual([
      'dive_detection_attributes',
      'dive_track_attributes',
      'dive_notes',
    ]);
    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].dive_detection_attributes).toEqual({ visibility: 'poor' });
    expect(out.annotations[0].dive_track_attributes).toEqual({ reviewer: 'alice' });
    expect(out.annotations[0].dive_notes).toEqual(['exported note']);
  });

  // --- datasetInfo passthrough ---

  const datasetInfo = {
    gfishsite_id: '2024TXN012',
    cruise: '2403',
    sta_lat: '26.8195',
    year: '2024',
  };

  it('writes dive_dataset_info under info and advertises it in dive_extensions', async () => {
    await serializeFile('/output/info.coco.json', annotationSchema, { ...imageMeta, datasetInfo });
    const out = await fs.readJSON('/output/info.coco.json');
    expect(out.info.dive_dataset_info).toEqual(datasetInfo);
    expect(out.info.dive_extensions).toContain('dive_dataset_info');
  });

  it('omits datasetInfo entirely when empty so exports stay byte-unchanged', async () => {
    await serializeFile('/output/empty.coco.json', annotationSchema, { ...imageMeta, datasetInfo: {} });
    const withEmpty = await fs.readJSON('/output/empty.coco.json');
    await serializeFile('/output/base.coco.json', annotationSchema, imageMeta);
    const baseline = await fs.readJSON('/output/base.coco.json');
    expect(withEmpty.info).not.toHaveProperty('dive_dataset_info');
    expect(withEmpty.info.dive_extensions).not.toContain('dive_dataset_info');
    expect(withEmpty.info).toEqual(baseline.info);
  });

  it('restores datasetInfo from info on import', async () => {
    mockfs({
      '/input': {
        'coco_info.json': JSON.stringify({
          ...cocoInput,
          info: {
            description: 'DIVE export for x',
            dive_extensions: ['dive_detection_attributes', 'dive_dataset_info'],
            dive_dataset_info: datasetInfo,
          },
        }),
      },
    });
    const [, parsedMeta] = await parseFile('/input/coco_info.json');
    expect(parsedMeta.datasetInfo).toEqual(datasetInfo);
  });

  it('returns no datasetInfo when the COCO file has none', async () => {
    const [, parsedMeta] = await parseFile('/input/coco.json');
    expect(parsedMeta).not.toHaveProperty('datasetInfo');
  });
});

afterEach(() => {
  mockfs.restore();
});
