/// <reference types="vitest" />
import fs from 'fs-extra';
import path from 'path';

import {
  ParsedFrameMetadata,
  findJoinColumns,
  normalizeKey,
  parseFrameMetadataSource,
  selectFrameMetadataSource,
} from 'platform/desktop/backend/serializers/frameMetadata';

type ContractRecord = Record<string, string>;
type ContractSource = {
  header: string[];
  recordsByFrame: Record<string, ContractRecord>;
  cameras: Record<string, {
    joinColumn: string;
    payloadColumns: string[];
    frames: string[];
  }>;
};
type Contract = {
  selectionStatus: Record<'missing' | 'ambiguous', 'none' | 'selected'>;
  sources: Record<string, ContractSource>;
};

const fixtureDir = path.resolve(
  process.cwd(),
  '../../..',
  'test-datasets',
  'fixtures',
  'frame-metadata',
);
const contractPath = path.join(fixtureDir, 'synthetic_auv_nav_expected.json');

function loadContract(): Contract {
  return fs.readJSONSync(contractPath) as Contract;
}

function fixtureText(sourceName: string): string {
  return fs.readFileSync(path.join(fixtureDir, sourceName), 'utf8');
}

function mediaKeys(
  cameraRecords: Record<string, ContractRecord>,
  joinColumn: string,
): Map<string, number> {
  return new Map(Object.entries(cameraRecords).map(([frame, record]) => (
    [normalizeKey(record[joinColumn]), Number(frame)]
  )));
}

function recordsByFrame(
  source: ParsedFrameMetadata,
  keys: Map<string, number>,
): Record<string, ContractRecord> {
  const records: Record<string, ContractRecord> = {};
  Array.from(keys.entries())
    .sort(([, frameA], [, frameB]) => frameA - frameB)
    .forEach(([key, frame]) => {
      if (source.records[key] !== undefined) {
        records[String(frame)] = source.records[key];
      }
    });
  return records;
}

function sourceStatus(
  source: ReturnType<typeof selectFrameMetadataSource>,
): 'none' | 'selected' {
  return source === null ? 'none' : 'selected';
}

describe('desktop frame metadata serializer', () => {
  it('normalizes media keys the same way as image name maps', () => {
    expect(normalizeKey('nested/20191009.154056.00082_rect_color.tif')).toBe(
      '20191009.154056.00082_rect_color',
    );
  });

  it('parses NOAA-style rows with multiple image columns', () => {
    const mediaKeys = new Map([
      ['20191009.154056.00082_rect_color', 0],
      ['20191009.154056.00081_rect_color', 0],
    ]);
    const text = [
      'port_image date time latitude longitude water_depth altitude starboard_image',
      '20191009.154056.00082_rect_color.tif 2019/10/09 15:40:56.1122 46.575870 -124.603094 192.80 2.78 20191009.154056.00081_rect_color.tif',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, mediaKeys, 'nav.txt');

    expect(source).not.toBeNull();
    expect(source?.sourceName).toBe('nav.txt');
    expect(source?.header).toEqual([
      'port_image',
      'date',
      'time',
      'latitude',
      'longitude',
      'water_depth',
      'altitude',
      'starboard_image',
    ]);
    expect(source?.joinColumns).toEqual(['port_image', 'starboard_image']);
    expect(source?.payloadColumns).toEqual([
      'date',
      'time',
      'latitude',
      'longitude',
      'water_depth',
      'altitude',
    ]);
    expect(Object.keys(source?.records || {}).sort()).toEqual([
      '20191009.154056.00081_rect_color',
      '20191009.154056.00082_rect_color',
    ]);
    const portRecord = source?.records['20191009.154056.00082_rect_color'];
    expect(Object.keys(portRecord || {})).toEqual(source?.header);
    expect(portRecord?.latitude).toBe('46.575870');
    expect(Object.values(portRecord || {}).every((value) => typeof value === 'string')).toBe(true);
  });

  it('parses comma, tab, and whitespace delimited sources', () => {
    const mediaKeys = new Map([['image_0001', 0]]);

    [
      'filename,depth,latitude\nimage_0001.jpg,192.80,46.575870\n',
      'filename\tdepth\tlatitude\nimage_0001.jpg\t192.80\t46.575870\n',
      'filename depth latitude\nimage_0001.jpg 192.80 46.575870\n',
    ].forEach((text) => {
      const source = parseFrameMetadataSource(text, mediaKeys);

      expect(source).not.toBeNull();
      expect(source?.header).toEqual(['filename', 'depth', 'latitude']);
      expect(source?.joinColumns).toEqual(['filename']);
      expect(source?.records.image_0001).toEqual({
        filename: 'image_0001.jpg',
        depth: '192.80',
        latitude: '46.575870',
      });
    });
  });

  it('finds join columns by filename value matches', () => {
    const rows = [
      {
        port_image: '20191009.154056.00082_rect_color.tif',
        latitude: '46.575870',
        starboard_image: '20191009.154056.00081_rect_color.tif',
      },
    ];

    expect(findJoinColumns(
      ['port_image', 'latitude', 'starboard_image'],
      rows,
      new Map([
        ['20191009.154056.00082_rect_color', 0],
        ['20191009.154056.00081_rect_color', 0],
      ]),
    )).toEqual(['port_image', 'starboard_image']);
  });

  it('rejects VIAME annotation CSV even when its image column matches', () => {
    const mediaKeys = new Map([['20191009.154056.00082_rect_color', 0]]);
    const viameCsv = [
      '# 1: Detection or Track-id,2: Video or Image Identifier,3: Unique Frame Identifier,4-7: Img-bbox(TL_x,TL_y,BR_x,BR_y),8: Detection or Length Confidence,9: Target Length (0 or -1 if invalid),10-11+: Repeated Species,Confidence Pairs or Attributes',
      '1,20191009.154056.00082_rect_color.tif,0,0,0,10,10,1.0,-1,fish,0.9',
      '',
    ].join('\n');

    expect(parseFrameMetadataSource(viameCsv, mediaKeys)).toBeNull();
  });

  it('rejects a headerless VIAME annotation CSV', () => {
    const mediaKeys = new Map([['frame_0001', 0], ['frame_0002', 1]]);
    const headerlessViame = [
      '1,frame_0001.png,0,10,20,30,40,1.0,-1,fish,0.9',
      '2,frame_0002.png,1,11,21,31,41,1.0,-1,fish,0.8',
      '',
    ].join('\n');

    expect(parseFrameMetadataSource(headerlessViame, mediaKeys)).toBeNull();
  });

  it('parses a sidecar containing a bare double-quote character', () => {
    const mediaKeys = new Map([['image_0001', 0]]);
    const text = [
      'filename,depth',
      'image_0001.jpg,5"',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, mediaKeys);

    expect(source).not.toBeNull();
    expect(source?.records.image_0001.depth).toBe('5"');
  });

  it('accepts VIAME-shaped telemetry without the VIAME header', () => {
    const mediaKeys = new Map([['image_0001', 0]]);
    const text = [
      'index,image,frame,x,y,depth,altitude,heading,temperature',
      '1,image_0001.jpg,100,46.5,-124.6,192.8,2.7,180.5,4.2',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, mediaKeys);

    expect(source).not.toBeNull();
    expect(source?.joinColumns).toEqual(['image']);
    expect(source?.records.image_0001.depth).toBe('192.8');
  });

  it('rejects bare image lists and unrelated text', () => {
    const mediaKeys = new Map([['image_0001', 0]]);

    expect(parseFrameMetadataSource('image\nimage_0001.jpg\n', mediaKeys)).toBeNull();
    expect(parseFrameMetadataSource('note,value\nhello,world\n', mediaKeys)).toBeNull();
  });

  it('rejects ambiguous candidates and non-text extensions', () => {
    const mediaKeys = new Map([['image_0001', 0]]);
    const acceptedText = 'filename,depth\nimage_0001.jpg,192.80\n';

    expect(selectFrameMetadataSource(
      [
        ['metadata.json', acceptedText],
        ['telemetry-a.txt', acceptedText],
      ],
      mediaKeys,
    )?.sourceName).toBe('telemetry-a.txt');
    expect(selectFrameMetadataSource(
      [
        ['telemetry-a.txt', acceptedText],
        ['telemetry-b.csv', 'filename,temperature\nimage_0001.jpg,4.2\n'],
      ],
      mediaKeys,
    )).toBeNull();
  });

  it('matches the shared synthetic AUV fixture contract', () => {
    const contract = loadContract();

    Object.entries(contract.sources).forEach(([sourceName, expected]) => {
      const text = fixtureText(sourceName);
      Object.entries(expected.cameras).forEach(([camera, cameraContract]) => {
        const expectedRecords = Object.fromEntries(
          cameraContract.frames.map((frame) => [frame, expected.recordsByFrame[frame]]),
        );
        const { joinColumn } = cameraContract;
        const keys = mediaKeys(expectedRecords, joinColumn);
        const source = parseFrameMetadataSource(text, keys, sourceName);

        expect(source).not.toBeNull();
        if (source === null) {
          throw new Error(`Expected ${sourceName} to parse for ${camera}`);
        }
        expect(source.sourceName).toBe(sourceName);
        expect(source.header).toEqual(expected.header);
        expect(source.joinColumns).toEqual([joinColumn]);
        expect(source.payloadColumns).toEqual(cameraContract.payloadColumns);
        expect(recordsByFrame(source, keys)).toEqual(expectedRecords);
        expect(Object.values(source.records).every((record) => (
          Object.values(record).every((value) => typeof value === 'string')
        ))).toBe(true);
      });
    });
  });

  it('matches shared missing and ambiguous source decisions', () => {
    const contract = loadContract();
    const sourceContract = contract.sources['synthetic_auv_nav_rect.txt'];
    const portContract = sourceContract.cameras.port;
    const portRecords = Object.fromEntries(
      portContract.frames.map((frame) => [frame, sourceContract.recordsByFrame[frame]]),
    );
    const keys = mediaKeys(portRecords, portContract.joinColumn);
    const rectText = fixtureText('synthetic_auv_nav_rect.txt');

    const missingSource = selectFrameMetadataSource(
      [['synthetic_auv_nav_jpg.txt', fixtureText('synthetic_auv_nav_jpg.txt')]],
      keys,
    );
    const ambiguousSource = selectFrameMetadataSource(
      [
        ['synthetic_auv_nav_rect.txt', rectText],
        ['synthetic_auv_nav_rect_copy.csv', rectText],
      ],
      keys,
    );

    expect({
      missing: sourceStatus(missingSource),
      ambiguous: sourceStatus(ambiguousSource),
    }).toEqual(contract.selectionStatus);
  });
});
