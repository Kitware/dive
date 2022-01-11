/// <reference types="jest" />
import { MultiTrackRecord } from 'dive-common/apispec';
import fs from 'fs-extra';
import mockfs from 'mock-fs';
import { JsonMeta } from 'platform/desktop/constants';
import { serialize } from 'platform/desktop/backend/serializers/viame';


const data: MultiTrackRecord = {
  1: {
    begin: 0,
    end: 0,
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
        interpolate: false,
        keyframe: true,
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
  type: 'image-sequence',
  name: 'project1',
  createdAt: 'now',
  originalFps: 1,
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
mockfs({
  '/home': {},
  'home/user/media/projectid1data': {
    'foo.png': '',
    'bar.png': '',
  },
});

// Returns first confidence pairs output of CSV that isn't a comment
function checkoutput(output: string[]) {
  for (let i = 0; i < output.length; i += 1) {
    const line = output[i];
    if (line[0] !== '#' && line.length > 0) {
      const split = line.split(',');
      return split.slice(9);
    }
  }
  return [];
}
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
    expect(checkoutput(output)).toEqual(expectedOutput);
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
    expect(checkoutput(output)).toEqual(expectedOutput);
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
    expect(checkoutput(output)).toEqual(expectedOutput);
  });
});

afterAll(() => {
  mockfs.restore();
});
