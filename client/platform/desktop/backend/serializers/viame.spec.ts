/// <reference types="jest" />
import { MultiTrackRecord } from 'dive-common/apispec';
import fs from 'fs-extra';
import mockfs from 'mock-fs';
import { JsonMeta } from 'platform/desktop/constants';
import { serialize, parse } from 'platform/desktop/backend/serializers/viame';
import { Attribute } from 'vue-media-annotator/use/useAttributes';
import processTrackAttributes from 'platform/desktop/backend/native/attributeProcessor';

type testPairs = [string[], MultiTrackRecord, Record<string, Attribute>];

const testData: testPairs[] = fs.readJSONSync('../testutils/viame.spec.json');


const data: MultiTrackRecord = {
  1: {
    begin: 0,
    end: 5,
    trackId: 1,
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

mockfs({
  '/home': {},
  'home/user/media/projectid1data': {
    'foo.png': '',
    'bar.png': '',
  },
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
      expect(results.tracks).toEqual(trackArray);
      // eslint-disable-next-line no-await-in-loop
      const attData = processTrackAttributes(results.tracks);
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


afterAll(() => {
  mockfs.restore();
});
