/// <reference types="vitest" />
import { AnnotationSchema, MultiTrackRecord } from 'dive-common/apispec';
import parseSync from 'csv-parse/lib/sync';
import fs from 'fs-extra';
import mockfs from 'mock-fs';
import { Readable } from 'stream';
import { AnnotationsCurrentVersion, JsonMeta } from 'platform/desktop/constants';
import { serialize, parse, parseFile } from 'platform/desktop/backend/serializers/viame';
import { Attribute } from 'vue-media-annotator/use/AttributeTypes';
import processTrackAttributes from 'platform/desktop/backend/native/attributeProcessor';
import { Console } from 'console';

type testPairs = [string[], MultiTrackRecord, Record<string, Attribute>];

const testData: testPairs[] = fs.readJSONSync('../testutils/viame.spec.json');

const imageFilenameTests = [
  {
    pass: false,
    error: 'A subsampling of images were used with the CSV but they were not sequential',
    csv: [
      '0,       ,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
      '1,2.png,0,111,222,3333,444,1,-1,typestring,0.55',
    ],
  },
  {
    pass: false,
    error: 'A subsampling of images were used with the CSV but they were not sequential',
    csv: [
      '0,1.png,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
      '1,invalid,0,111,222,3333,444,1,-1,typestring,0.55',
    ],
  },
  {
    pass: true,
    csv: [
      '0,invalid1,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
      '',
      '1,invalid2,0,111,222,3333,444,1,-1,typestring,0.55',
    ],
  },
  {
    pass: true,
    csv: [
      '0,       ,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
      '',
      '1,,0,111,222,3333,444,1,-1,typestring,0.55',
    ],
  },
  {
    pass: true,
    csv: [
      '0,1.png,1,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
      '',
      '1,1.png,0,111,222,3333,444,1,-1,typestring,0.55',
    ],
  },
  {
    pass: false,
    error: 'Error: Images were provided in an unexpected order and dataset contains multi-frame tracks.',
    csv: [
      '99,1.png,0,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
      '99,3.png,1,111,222,3333,444,1,-1,typestring,0.55',
    ],
  },
  {
    pass: true,
    csv: [
      '99,unknown1,2,884.66,510,1219.66,737.66,1,-1,ignored,0.98',
      '99,unknown2,2,111,222,3333,444,1,-1,typestring,0.55',
    ],
  },
];

const trackMap: MultiTrackRecord = {
  1: {
    begin: 0,
    end: 5,
    id: 1,
    features: [
      {
        frame: 0,
        bounds: [
          670,
          183,
          968,
          433,
        ],
      },
      {
        frame: 1,
        bounds: [
          670,
          183,
          968,
          433,
        ],
      },
      {
        frame: 2,
        bounds: [
          670,
          183,
          968,
          433,
        ],
      },
      {
        frame: 3,
        bounds: [
          670,
          183,
          968,
          433,
        ],
      },
      {
        frame: 4,
        bounds: [
          670,
          183,
          968,
          433,
        ],
      },
    ],
    confidencePairs: [
      [
        'second_type',
        0.7,
      ],
      [
        'fifth_type',
        0.3,
      ],
      [
        'first_type',
        0.9,
      ],
      [
        'fourth_type',
        0.5,
      ],
      [
        'third_type',
        0.6,
      ],

    ],
    attributes: {},
    meta: {},
  },
};

const data: AnnotationSchema = {
  tracks: trackMap,
  groups: {},
  version: AnnotationsCurrentVersion,
};

const meta = {
  version: 1,
  id: 'projectid1',
  type: 'video',
  name: 'project1',
  createdAt: 'now',
  originalFps: 5,
  originalVideoFile: '',
  transcodedVideoFile: '',
  transcodedImageFiles: [],
  fps: 5,
  originalBasePath: '/home/user/media/projectid1data',
  originalImageFiles: [
    'foo.png',
    'bar.png',
  ],
  confidenceFilters: {
    default: 0.65,
  },
  multiCam: null,
  subType: null,
} as JsonMeta;
const testFiles: Record<string, string> = { };
testData.forEach((item, index) => {
  // eslint-disable-next-line prefer-destructuring
  testFiles[`${index}.csv`] = item[0].join('\n');
});
const imageOrderFiles: Record<string, string> = { };
imageFilenameTests.forEach((item, index) => {
  // eslint-disable-next-line prefer-destructuring
  imageOrderFiles[`${index}.csv`] = item.csv.join('\n');
});

// https://github.com/tschaub/mock-fs/issues/234
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const console = new Console(process.stdout, process.stderr);

beforeEach(() => {
  mockfs({
    '/home': {},
    'home/user/media/projectid1data': {
      'foo.png': '',
      'bar.png': '',
    },
    '/imageorder': imageOrderFiles,
    '/csv': testFiles,
  });
});

// Returns first confidence pairs output of CSV that isn't a comment
function checkConfidenceOutput(output: string[]) {
  for (let i = 0; i < output.length; i += 1) {
    const line = output[i];
    if (line[0] !== '#' && line.length > 0) {
      const split = line.split(',');
      return split.slice(9);
    }
  }
  return [];
}

function getCSVTiming(output: string[]) {
  const timings = [];
  for (let i = 0; i < output.length; i += 1) {
    const line = output[i];
    if (line[0] !== '#' && line.length > 0) {
      const split = line.split(',');
      timings.push(split.slice(1, 2).toString());
    }
  }
  return timings;
}

describe('VIAME Python Compatibility Check', () => {
  it('testing import and convert', async () => {
    for (let i = 0; i < testData.length; i += 1) {
      const trackData = testData[i][1];
      const testAttributes = testData[i][2];
      const testPath = `/csv/${i}.csv`;
      const csvStream = fs.createReadStream(testPath);
      const trackArray = Object.values(trackData);
      // eslint-disable-next-line no-await-in-loop
      const results = await parse(csvStream);
      expect(Object.values(results[0].tracks)).toEqual(trackArray);
      // eslint-disable-next-line no-await-in-loop
      const attData = processTrackAttributes(Object.values(results[0].tracks));
      expect(testAttributes).toEqual(attData.attributes);
    }
  });
});

describe('Attribute value parsing', () => {
  it('keeps filename-like attribute values as full strings', async () => {
    const csv = [
      '0,1.png,0,10,10,20,20,1,-1,seal,0.9,'
      + '(atr) source_image 0123ABC456,'
      + '(atr) other_file 20240624_120000_C0_0042.jpg,'
      + '(atr) score 12.5,(atr) flag true',
    ].join('\n');
    const results = await parse(Readable.from([csv]));
    const track = Object.values(results[0].tracks)[0];
    const attrs = track.features[0].attributes || {};
    expect(attrs.source_image).toBe('0123ABC456');
    expect(attrs.other_file).toBe('20240624_120000_C0_0042.jpg');
    expect(attrs.score).toBe(12.5);
    expect(attrs.flag).toBe(true);
    const attData = processTrackAttributes(Object.values(results[0].tracks));
    expect(attData.attributes.detection_source_image.datatype).toBe('text');
    expect(attData.attributes.detection_other_file.datatype).toBe('text');
    expect(attData.attributes.detection_score.datatype).toBe('number');
    expect(attData.attributes.detection_flag.datatype).toBe('boolean');
  });
});

describe('VIAME serialize testing', () => {
  it('testing exporting with viame CSV and proper order', async () => {
    const path = '/home/test.json';
    const stream = fs.createWriteStream(path);
    const typeFilter = new Set<string>();
    const options = {
      excludeBelowThreshold: false,
      header: true,
    };
    await serialize(stream, data, meta, typeFilter, options);
    const output = fs.readFileSync(path).toString().split('\n');
    const expectedOutput = ['first_type', '0.9', 'second_type', '0.7', 'third_type', '0.6', 'fourth_type', '0.5', 'fifth_type', '0.3'];
    expect(checkConfidenceOutput(output)).toEqual(expectedOutput);
    expect(getCSVTiming(output)).toEqual(['00:00:00.000000', '00:00:00.200000', '00:00:00.400000', '00:00:00.600000', '00:00:00.800000']);
  });
  it('testing exporting with viame CSV with type filter', async () => {
    const path = '/home/test.json';
    const stream = fs.createWriteStream(path);
    const typeFilter = new Set<string>();
    typeFilter.add('first_type');
    typeFilter.add('third_type');
    typeFilter.add('fifth_type');
    const options = {
      excludeBelowThreshold: false,
      header: true,
    };
    await serialize(stream, data, meta, typeFilter, options);
    const output = fs.readFileSync(path).toString().split('\n');
    const expectedOutput = ['first_type', '0.9', 'third_type', '0.6', 'fifth_type', '0.3'];
    expect(checkConfidenceOutput(output)).toEqual(expectedOutput);
  });
  it('testing exporting with viame CSV with excluded confidence', async () => {
    const path = '/home/test.json';
    const stream = fs.createWriteStream(path);
    const typeFilter = new Set<string>();
    const options = {
      excludeBelowThreshold: true,
      header: true,
    };
    await serialize(stream, data, meta, typeFilter, options);
    const output = fs.readFileSync(path).toString().split('\n');
    const expectedOutput = ['first_type', '0.9', 'second_type', '0.7'];
    expect(checkConfidenceOutput(output)).toEqual(expectedOutput);
  });
});

// Returns the entries of the `# metadata` row (without the leading marker), or null if absent
function getMetadataFields(output: string[]): string[] | null {
  const metadataLine = output.find((line) => line.startsWith('# metadata'));
  if (metadataLine === undefined) {
    return null;
  }
  return (parseSync(metadataLine) as string[][])[0].slice(1);
}

function getDatasetInfoEntry(output: string[]): Record<string, unknown> | null {
  const fields = getMetadataFields(output);
  if (fields === null) {
    return null;
  }
  const entry = fields.find((field) => field.startsWith('dataset_info: '));
  return entry ? JSON.parse(entry.slice('dataset_info: '.length)) : null;
}

describe('VIAME datasetInfo passthrough', () => {
  const datasetInfo = {
    gfishsite_id: '2024TXN012',
    cruise: 2403,
    sta_lat: 26.8195,
    year: 2024,
  };

  it('writes a populated datasetInfo as one nested JSON entry on the # metadata line', async () => {
    const path = '/home/test.json';
    const stream = fs.createWriteStream(path);
    await serialize(stream, data, { ...meta, datasetInfo } as JsonMeta, new Set<string>(), {
      excludeBelowThreshold: false,
      header: true,
    });
    const output = fs.readFileSync(path).toString().split('\n');
    const parsed = getDatasetInfoEntry(output);
    // round-trips as a single key with numeric fields preserved and ids kept as strings
    expect(parsed).toEqual(datasetInfo);
    expect(typeof parsed?.cruise).toBe('number');
    expect(typeof parsed?.sta_lat).toBe('number');
    expect(typeof parsed?.gfishsite_id).toBe('string');
  });

  it('omits the datasetInfo entry entirely when datasetInfo is empty', async () => {
    const path = '/home/test.json';
    const stream = fs.createWriteStream(path);
    await serialize(stream, data, { ...meta, datasetInfo: {} } as JsonMeta, new Set<string>(), {
      excludeBelowThreshold: false,
      header: true,
    });
    const output = fs.readFileSync(path).toString().split('\n');
    const fields = getMetadataFields(output);
    expect(fields).not.toBeNull();
    expect(fields?.some((field) => field.startsWith('dataset_info'))).toBe(false);
  });

  it('restores datasetInfo from the # metadata line on parse', async () => {
    const path = '/home/test.json';
    const stream = fs.createWriteStream(path);
    await serialize(stream, data, { ...meta, datasetInfo } as JsonMeta, new Set<string>(), {
      excludeBelowThreshold: false,
      header: true,
    });
    const [parsedData] = await parseFile(path);
    expect(parsedData.datasetInfo).toEqual(datasetInfo);
  });

  // Drive an unusable dataset_info field straight into parse via a # metadata row.
  // Each case should be skipped with a warning rather than aborting the import.
  it.each([
    ['malformed JSON', 'dataset_info: {bad json}', /malformed dataset_info/],
    ['a JSON number', 'dataset_info: 42', /expected a JSON object but got number/],
    ['a JSON array', 'dataset_info: [1]', /expected a JSON object but got array/],
    ['JSON null', 'dataset_info: null', /expected a JSON object but got null/],
  ])('skips %s with a warning and no datasetInfo', async (_label, field, pattern) => {
    const [parsedData, warnings] = await parse(Readable.from(`# metadata,fps: 30,${field}`));
    expect(parsedData.datasetInfo).toBeUndefined();
    expect(warnings.some((w) => pattern.test(w))).toBe(true);
  });
});

describe('Test Image Filenames', () => {
  it('testing image filenames', async () => {
    const imageMap = new Map([
      ['1', 0],
      ['2', 1],
      ['3', 2],
    ]);
    for (let i = 0; i < imageFilenameTests.length; i += 1) {
      const testPath = `/imageorder/${i}.csv`;
      const imageOrderData = imageFilenameTests[i];
      if (!imageOrderData.pass) {
        try {
        // eslint-disable-next-line no-await-in-loop
          await parseFile(testPath, imageMap);
        } catch (err) {
          expect((err as Error).toString()).toBe(imageOrderData.error);
        }
      } else {
        // eslint-disable-next-line no-await-in-loop
        const result = await parseFile(testPath, imageMap);
        expect(Object.values(result[0].tracks).length).toBeGreaterThan(0);
      }
    }
  });
});

afterEach(() => {
  mockfs.restore();
});
