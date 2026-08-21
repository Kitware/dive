import fs from 'fs-extra';
import mockfs from 'mock-fs';
import { AnnotationSchema } from 'dive-common/apispec';
import { AnnotationsCurrentVersion, JsonConfig } from 'platform/desktop/constants';
import {
  CATEGORY_MISSING_NAME_WARNING,
  DIVE_CONFIDENCE_PAIRS_INVALID_WARNING,
  PROB_DUPLICATE_CATEGORY_WARNING,
  PROB_LENGTH_MISMATCH_WARNING,
  PROB_TOP_K,
  SUPERCATEGORY_DUPLICATE_CATEGORY_WARNING,
  SUPERCATEGORY_MULTI_PARENT_WARNING,
  isCocoJson,
  parseFile,
  serializeFile,
  typeHierarchyFromCategories,
} from 'platform/desktop/backend/serializers/coco';

const kwcocoProfile = fs.readJSONSync('../testutils/kwcoco/import-profile.json');

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
} as JsonConfig;

beforeEach(() => {
  mockfs({
    '/input': {
      'coco.json': JSON.stringify(cocoInput),
    },
    '/output': {},
  });
});

describe('COCO serializer', () => {
  it('matches the shared exact-vector and hierarchy import profile', async () => {
    const profile = kwcocoProfile.highestFrameExact;
    mockfs({
      '/input': {
        'profile.json': JSON.stringify(profile.document),
      },
    });

    const [parsed, , warnings] = await parseFile('/input/profile.json');
    expect(parsed.tracks[profile.trackId].confidencePairs).toEqual(profile.expectedPairs);
    expect(typeHierarchyFromCategories(profile.document).hierarchy)
      .toEqual(profile.expectedHierarchy);
    expect(warnings).toEqual([]);
  });

  it('matches server ordering when external images omit frame indices', async () => {
    const profile = kwcocoProfile.missingFrameIndexExact;
    mockfs({
      '/input': {
        'profile.json': JSON.stringify(profile.document),
      },
    });

    const [parsed, , warnings] = await parseFile('/input/profile.json');
    expect(parsed.tracks[profile.trackId].confidencePairs).toEqual(profile.expectedPairs);
    expect(warnings).toEqual([]);
  });

  it('rejects empty DIVE confidence pairs from the shared import profile', async () => {
    const profile = kwcocoProfile.emptyDiveConfidencePairs;
    mockfs({
      '/input': {
        'profile.json': JSON.stringify(profile.document),
      },
    });

    const [parsed, , warnings] = await parseFile('/input/profile.json');
    expect(parsed.tracks[profile.trackId].confidencePairs).toEqual(profile.expectedPairs);
    expect(warnings).toEqual([DIVE_CONFIDENCE_PAIRS_INVALID_WARNING]);
  });

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
      'dive_confidence_pairs',
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

  // --- annotation fps on videos[] ---

  it('writes videos[].fps for video datasets and restores it on re-import', async () => {
    const videoMeta = {
      ...imageMeta,
      type: 'video' as const,
      fps: 5,
      name: 'clip',
    };
    await serializeFile('/output/video.coco.json', annotationSchema, videoMeta);
    const out = await fs.readJSON('/output/video.coco.json');
    expect(out.videos).toEqual([{ id: 1, name: 'clip', fps: 5 }]);
    expect(out.images.every((image: { video_id?: number }) => image.video_id === 1)).toBe(true);

    mockfs({
      '/input': { 'roundtrip.json': JSON.stringify(out) },
      '/output': {},
    });
    const [, parsedMeta] = await parseFile('/input/roundtrip.json');
    expect(parsedMeta.fps).toBe(5);
  });

  it('omits videos for image-sequence exports even when fps is set', async () => {
    await serializeFile('/output/seq.coco.json', annotationSchema, { ...imageMeta, fps: 5 });
    const out = await fs.readJSON('/output/seq.coco.json');
    expect(out).not.toHaveProperty('videos');
    expect(out.images.every((image: { video_id?: number }) => image.video_id === undefined)).toBe(true);
  });

  it('omits videos when video fps is unusable', async () => {
    await serializeFile('/output/zero.coco.json', annotationSchema, {
      ...imageMeta,
      type: 'video',
      fps: 0,
    });
    const out = await fs.readJSON('/output/zero.coco.json');
    expect(out).not.toHaveProperty('videos');
  });

  it('imports a pruned KWCOCO probability vector by raw category position', async () => {
    mockfs({
      '/input': {
        'prob.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame.jpg', frame_index: 0 }],
          annotations: [{
            id: 1,
            image_id: 1,
            category_id: 3,
            bbox: [0, 0, 1, 1],
            track_id: 9,
            prob: [0.1, 0.8, 0.2],
          }],
          categories: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/prob.json');
    expect(parsed.tracks[9].confidencePairs).toEqual([['b', 0.8], ['c', 0.2], ['a', 0.1]]);
    expect(warnings).toEqual([]);
  });

  it('keeps unnamed category slots while mapping prob vectors', async () => {
    mockfs({
      '/input': {
        'unnamed-prob.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame.jpg', frame_index: 0 }],
          annotations: [{
            id: 1,
            image_id: 1,
            category_id: 3,
            bbox: [0, 0, 1, 1],
            track_id: 9,
            prob: [0.9, 0.8, 0.7],
          }],
          categories: [{ id: 1, name: 'a' }, { id: 2 }, { id: 3, name: 'c' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/unnamed-prob.json');
    expect(parsed.tracks[9].confidencePairs).toEqual([['a', 0.9], ['c', 0.7]]);
    expect(warnings).toEqual([]);
  });

  it('clamps finite prob values and prunes to the strongest scores above epsilon', async () => {
    const aboveEpsilon = PROB_TOP_K + 2;
    const categories = Array.from({ length: aboveEpsilon + 1 }, (_, id) => ({
      id: id + 1,
      name: `type-${id}`,
    }));
    mockfs({
      '/input': {
        'pruned-prob.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame.jpg', frame_index: 0 }],
          annotations: [{
            id: 1,
            image_id: 1,
            category_id: 1,
            bbox: [0, 0, 1, 1],
            track_id: 9,
            prob: [
              1.5,
              ...Array.from({ length: aboveEpsilon - 1 }, (_, index) => 0.9 - (index * 0.01)),
              0.0005,
            ],
          }],
          categories,
        }),
      },
    });
    const [parsed] = await parseFile('/input/pruned-prob.json');
    const names = parsed.tracks[9].confidencePairs.map(([name]) => name);
    expect(parsed.tracks[9].confidencePairs).toHaveLength(PROB_TOP_K);
    expect(parsed.tracks[9].confidencePairs[0]).toEqual(['type-0', 1]);
    expect(names).not.toContain(`type-${aboveEpsilon - 1}`);
    expect(names).not.toContain(`type-${aboveEpsilon}`);
  });

  it('warns once for invalid external prob vectors and falls back to category score', async () => {
    mockfs({
      '/input': {
        'bad-prob.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame.jpg', frame_index: 0 }],
          annotations: [
            {
              id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 9, score: 0.4, prob: [0.8],
            },
            {
              id: 2, image_id: 1, category_id: 2, bbox: [0, 0, 1, 1], track_id: 10, score: 0.5, prob: [0.8],
            },
          ],
          categories: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/bad-prob.json');
    expect(parsed.tracks[9].confidencePairs).toEqual([['a', 0.4]]);
    expect(parsed.tracks[10].confidencePairs).toEqual([['b', 0.5]]);
    expect(warnings).toEqual([PROB_LENGTH_MISMATCH_WARNING]);
  });

  it('prefers valid exact DIVE confidence pairs, including zero values', async () => {
    mockfs({
      '/input': {
        'exact-pairs.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame.jpg', frame_index: 0 }],
          annotations: [{
            id: 1,
            image_id: 1,
            category_id: 1,
            bbox: [0, 0, 1, 1],
            track_id: 9,
            prob: [0.9, 0.1],
            dive_confidence_pairs: [['sparse', 0], ['exact', 0.75]],
          }],
          categories: [{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/exact-pairs.json');
    expect(parsed.tracks[9].confidencePairs).toEqual([['sparse', 0], ['exact', 0.75]]);
    expect(warnings).toEqual([]);
  });

  it('uses the highest frame classification regardless of annotation file order', async () => {
    mockfs({
      '/input': {
        'highest-frame.json': JSON.stringify({
          images: [
            { id: 1, file_name: 'early.jpg', frame_index: 2 },
            { id: 2, file_name: 'late.jpg', frame_index: 9 },
          ],
          annotations: [
            {
              id: 1, image_id: 2, category_id: 1, bbox: [0, 0, 1, 1], track_id: 9, score: 0.9,
            },
            {
              id: 2, image_id: 1, category_id: 2, bbox: [0, 0, 1, 1], track_id: 9, score: 0.2,
            },
          ],
          categories: [{ id: 1, name: 'late' }, { id: 2, name: 'early' }],
        }),
      },
    });
    const [parsed] = await parseFile('/input/highest-frame.json');
    expect(parsed.tracks[9].confidencePairs).toEqual([['late', 0.9]]);
  });

  it('uses the greatest annotation id when classifications share the highest frame', async () => {
    mockfs({
      '/input': {
        'same-frame.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame.jpg', frame_index: 9 }],
          annotations: [
            {
              id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 9, score: 0.2,
            },
            {
              id: 2, image_id: 1, category_id: 2, bbox: [0, 0, 1, 1], track_id: 9, score: 0.8,
            },
          ],
          categories: [{ id: 1, name: 'first' }, { id: 2, name: 'last' }],
        }),
      },
    });
    const [parsed] = await parseFile('/input/same-frame.json');
    expect(parsed.tracks[9].confidencePairs).toEqual([['last', 0.8]]);
  });

  it('uses the same highest-frame classification after annotations are reordered', async () => {
    const document = {
      images: [{ id: 1, file_name: 'frame.jpg', frame_index: 9 }],
      annotations: [
        {
          id: 42, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 9, score: 0.2,
        },
        {
          id: 99, image_id: 1, category_id: 2, bbox: [0, 0, 1, 1], track_id: 9, score: 0.8,
        },
      ],
      categories: [{ id: 1, name: 'lower-id' }, { id: 2, name: 'higher-id' }],
    };
    await Promise.all([
      fs.writeJSON('/input/same-frame-order-a.json', document),
      fs.writeJSON('/input/same-frame-order-b.json', {
        ...document,
        annotations: [...document.annotations].reverse(),
      }),
    ]);
    const [[first], [second]] = await Promise.all([
      parseFile('/input/same-frame-order-a.json'),
      parseFile('/input/same-frame-order-b.json'),
    ]);
    expect(first.tracks[9].confidencePairs).toEqual([['higher-id', 0.8]]);
    expect(second.tracks[9].confidencePairs).toEqual([['higher-id', 0.8]]);
  });

  it('warns once for malformed DIVE confidence pairs and falls back to category scores', async () => {
    mockfs({
      '/input': {
        'invalid-exact-pairs.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame.jpg', frame_index: 0 }],
          annotations: [
            {
              id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 1, score: 0.1, dive_confidence_pairs: 'fish',
            },
            {
              id: 2, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 2, score: 0.2, dive_confidence_pairs: [['fish']],
            },
            {
              id: 3, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 3, score: 0.3, dive_confidence_pairs: [['fish', 0.1], ['fish', 0.2]],
            },
            {
              id: 4, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 4, score: 0.4, dive_confidence_pairs: [['fish', Number.POSITIVE_INFINITY]],
            },
            {
              id: 5, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 5, score: 0.5, dive_confidence_pairs: [['fish', 1.1]],
            },
          ],
          categories: [{ id: 1, name: 'fish' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/invalid-exact-pairs.json');
    expect(Object.values(parsed.tracks).map((track) => track.confidencePairs))
      .toEqual([['fish', 0.1], ['fish', 0.2], ['fish', 0.3], ['fish', 0.4], ['fish', 0.5]].map((pair) => [pair]));
    expect(warnings).toEqual([DIVE_CONFIDENCE_PAIRS_INVALID_WARNING]);
  });

  it('extracts hierarchy edges and reports representational warnings deterministically', () => {
    const result = typeHierarchyFromCategories({
      images: [],
      annotations: [],
      categories: [
        { id: 1, name: 'fish', supercategory: 'fish' },
        {
          id: 2, name: 'shark', supercategory: 'fish', parents: ['fish', 'animal'],
        },
        { id: 3 },
      ],
    });
    expect(result.hierarchy).toEqual({ shark: 'fish' });
    expect(result.warnings).toEqual([
      SUPERCATEGORY_MULTI_PARENT_WARNING,
      CATEGORY_MISSING_NAME_WARNING,
    ]);

    expect(typeHierarchyFromCategories({
      images: [], annotations: [], categories: [{ id: 1, name: 'fish' }],
    })).toEqual({ warnings: [] });

    const duplicate = typeHierarchyFromCategories({
      images: [], annotations: [], categories: [{ id: 1, name: 'fish' }, { id: 2, name: 'fish' }],
    });
    expect(duplicate.hierarchy).toBeUndefined();
    expect(duplicate.warnings).toEqual([SUPERCATEGORY_DUPLICATE_CATEGORY_WARNING]);

    const parentsFallback = typeHierarchyFromCategories({
      images: [],
      annotations: [],
      categories: [
        { id: 1, name: 'fish' },
        { id: 2, name: 'shark', parents: ['fish'] },
        {
          id: 3, name: 'tuna', supercategory: 'animal', parents: ['fish'],
        },
        { id: 4, name: 'whale', parents: ['mammal', 'fish'] },
      ],
    });
    expect(parentsFallback.hierarchy).toEqual({ shark: 'fish', tuna: 'animal' });
    expect(parentsFallback.warnings).toEqual([SUPERCATEGORY_MULTI_PARENT_WARNING]);
  });

  it('warns once and ignores prob vectors when category names are duplicated', async () => {
    mockfs({
      '/input': {
        'duplicate-prob.json': JSON.stringify({
          images: [{ id: 1, file_name: 'frame.jpg', frame_index: 0 }],
          annotations: [{
            id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 9, prob: [0.2, 0.8],
          }],
          categories: [{ id: 1, name: 'fish' }, { id: 2, name: 'fish' }],
        }),
      },
    });
    const [parsed, , warnings] = await parseFile('/input/duplicate-prob.json');
    expect(parsed.tracks[9].confidencePairs).toEqual([['fish', 1]]);
    expect(warnings).toEqual([PROB_DUPLICATE_CATEGORY_WARNING]);
  });

  it('matches the shared KWCOCO export and round-trip profile', async () => {
    const profile = kwcocoProfile.exportRoundTrip;
    const profileTrack = profile.tracks[0] as AnnotationSchema['tracks'][number];
    const source: AnnotationSchema = {
      version: AnnotationsCurrentVersion,
      groups: {},
      tracks: {
        [profileTrack.id]: profileTrack,
      },
    };
    const originalPairs = profileTrack.confidencePairs.map(([name, score]) => [name, score]);
    await serializeFile('/output/kwcoco.json', source, {
      ...imageMeta,
      name: profile.datasetName,
      originalImageFiles: [profile.imageFilenames['0']],
      typeHierarchy: profile.typeHierarchy,
    });
    const out = await fs.readJSON('/output/kwcoco.json');
    expect(out.categories.map(({ name }: { name: string }) => name))
      .toEqual(profile.expectedCategoryNames);
    expect(Object.fromEntries(out.categories
      .filter(({ supercategory }: { supercategory?: string }) => supercategory)
      .map(({ name, supercategory }: { name: string; supercategory: string }) => (
        [name, supercategory]
      )))).toEqual(profile.expectedParents);
    expect(out.info.dive_extensions).toContain('dive_confidence_pairs');
    expect(out.annotations[0]).toMatchObject({
      category_id: 2,
      track_id: profileTrack.id,
      score: 0.75,
      prob: profile.expectedProb,
      dive_confidence_pairs: profile.expectedPairs,
    });
    expect(source.tracks[profileTrack.id].confidencePairs).toEqual(originalPairs);

    await fs.writeJSON('/input/kwcoco.json', out);
    const [parsed] = await parseFile('/input/kwcoco.json');
    expect(parsed.tracks[profileTrack.id].confidencePairs).toEqual(profile.expectedPairs);
  });

  it('filters the raw exported pair vector without mutating its source track', async () => {
    const source: AnnotationSchema = {
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
    await serializeFile('/output/filtered.json', source, {
      ...imageMeta,
      typeHierarchy: { leaf: 'root' },
    }, new Set(['root']));
    const out = await fs.readJSON('/output/filtered.json');
    // Export filters raw stored names even though hierarchy display resolves this track to leaf.
    expect(out.annotations[0].dive_confidence_pairs).toEqual([['root', 0.2]]);
    expect(out.annotations[0].prob).toEqual([0.2, 0]);
    expect(source.tracks[4].confidencePairs).toEqual([['root', 0.2], ['leaf', 0.8]]);

    await fs.writeJSON('/input/filtered.json', out);
    const [parsed] = await parseFile('/input/filtered.json');
    expect(parsed.tracks[4].confidencePairs).toEqual([['root', 0.2]]);
  });

  it('imports the frame rate a video records, as the CSV header path does', async () => {
    const document = (videos: unknown) => JSON.stringify({
      images: [{ id: 1, file_name: 'frame_000000.png', frame_index: 0 }],
      annotations: [{
        id: 1, image_id: 1, category_id: 1, bbox: [0, 0, 1, 1], track_id: 1,
      }],
      categories: [{ id: 1, name: 'fish' }],
      ...(videos === undefined ? {} : { videos }),
    });
    mockfs({
      '/input': {
        'video.json': document([{ id: 1, name: 'clip', fps: 5 }]),
        'image-list.json': document(undefined),
        'unusable.json': document([{ id: 1, name: 'clip', fps: 0 }]),
        'not-a-number.json': document([{ id: 1, name: 'clip', fps: '5' }]),
      },
    });

    const [, videoMeta] = await parseFile('/input/video.json');
    expect(videoMeta.fps).toBe(5);

    // An image sequence describes no video, so it carries no rate to import.
    const [, listMeta] = await parseFile('/input/image-list.json');
    expect(listMeta.fps).toBeUndefined();

    // Nothing downstream should ever see fps: 0 or a string.
    const [, zeroMeta] = await parseFile('/input/unusable.json');
    expect(zeroMeta.fps).toBeUndefined();
    const [, stringMeta] = await parseFile('/input/not-a-number.json');
    expect(stringMeta.fps).toBeUndefined();
  });
});

afterEach(() => {
  mockfs.restore();
});
