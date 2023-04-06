/// <reference types="jest" />
import { AnnotationSchema, MultiTrackRecord } from 'dive-common/apispec';
import fs from 'fs-extra';
import mockfs from 'mock-fs';
import { AnnotationsCurrentVersion, JsonMeta } from 'platform/desktop/constants';
import { serialize, parse, parseFile } from 'platform/desktop/backend/serializers/viame';
import { Attribute } from 'vue-media-annotator/use/useAttributes';
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
    error: 'Error: annotations were provided in an unexpected order and dataset contains multi-frame tracks',
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

mockfs({
  '/home': {},
  'home/user/media/projectid1data': {
    'foo.png': '',
    'bar.png': '',
  },
  '/imageorder': imageOrderFiles,
  '/csv': testFiles,
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
      expect(Object.values(results.tracks)).toEqual(trackArray);
      // eslint-disable-next-line no-await-in-loop
      const attData = processTrackAttributes(Object.values(results.tracks));
      expect(testAttributes).toEqual(attData.attributes);
    }
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
        expect(Object.values(result.tracks).length).toBeGreaterThan(0);
      }
    }
  });
});


afterAll(() => {
  mockfs.restore();
});
