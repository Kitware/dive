/// <reference types="vitest" />

import fs from 'fs';
import path from 'path';

import {
  ParsedFrameMetadata,
  normalizeKey,
  parseFrameMetadataSource,
} from './parser';
import isFrameMetadataSourceName from './naming';
import { buildMediaKeyIndex } from './resolve';

type FixtureRecord = Record<string, string>;
type ExpectedSource = {
  header: string[];
  recordsByFrame: Record<string, FixtureRecord>;
  cameras: Record<string, {
    joinColumn: string;
    payloadColumns: string[];
    frames: string[];
  }>;
};
type ExpectedFixture = {
  sources: Record<string, ExpectedSource>;
};

const syntheticHeader = [
  'port_image',
  'depth_m',
  'heading',
  'starboard_image',
];

const syntheticSources: Record<string, string[][]> = {
  'synthetic_auv_nav_rect.txt': [
    ['rect_port_0001.tif', '192.80', '174.5', 'rect_starboard_0001.tif'],
    ['rect_port_0002.tif', '193.05', '175.1', 'rect_starboard_0002.tif'],
  ],
  'synthetic_auv_nav_jpg.txt': [
    ['jpg_port_0001.jpg', '88.40', '92.5', 'jpg_starboard_0001.jpg'],
    ['jpg_port_0002.jpg', '88.72', '93.1', 'jpg_starboard_0002.jpg'],
  ],
};

function sourceText(sourceName: string): string {
  const rows = syntheticSources[sourceName];
  return [syntheticHeader.join(' '), ...rows.map((row) => row.join(' ')), ''].join('\n');
}

function expectedSource(rows: string[][]): ExpectedSource {
  return {
    header: syntheticHeader,
    recordsByFrame: Object.fromEntries(rows.map((row, frame) => [
      String(frame),
      Object.fromEntries(syntheticHeader.map((field, index) => [field, row[index]])),
    ])),
    cameras: {
      port: expectedCamera('port_image', rows),
      starboard: expectedCamera('starboard_image', rows),
    },
  };
}

function expectedCamera(joinColumn: string, rows: string[][]) {
  return {
    joinColumn,
    payloadColumns: syntheticHeader.filter((column) => column !== joinColumn),
    frames: rows.map((_, frame) => String(frame)),
  };
}

function loadExpectedFixture(): ExpectedFixture {
  return {
    sources: Object.fromEntries(
      Object.entries(syntheticSources).map(([sourceName, rows]) => [
        sourceName,
        expectedSource(rows),
      ]),
    ),
  };
}

function fixtureText(sourceName: string): string {
  return sourceText(sourceName);
}

function mediaKeys(
  cameraRecords: Record<string, FixtureRecord>,
  joinColumn: string,
): Map<string, number> {
  return new Map(Object.entries(cameraRecords).map(([frame, record]) => (
    [normalizeKey(record[joinColumn]), Number(frame)]
  )));
}

function recordsByFrame(
  source: ParsedFrameMetadata,
  keys: Map<string, number>,
): Record<string, FixtureRecord> {
  const records: Record<string, FixtureRecord> = {};
  Array.from(keys.entries())
    .sort(([, frameA], [, frameB]) => frameA - frameB)
    .forEach(([key, frame]) => {
      if (source.records[key] !== undefined) {
        records[String(frame)] = source.records[key];
      }
    });
  return records;
}

describe('shared frame metadata parser', () => {
  it('normalizes media keys the same way as image name maps', () => {
    expect(normalizeKey('nested/20191009.154056.00082_rect_color.tif')).toBe(
      '20191009.154056.00082_rect_color',
    );
  });

  it('joins only the leftmost image column when several columns match', () => {
    // Two image columns are both join candidates, but only the leftmost is the join
    // column; the second camera's column is neither joined nor shown as payload.
    const keys = new Map([
      ['20191009.154056.00082_rect_color', 0],
      ['20191009.154056.00081_rect_color', 0],
    ]);
    const text = [
      'port_image date time latitude longitude water_depth altitude starboard_image',
      '20191009.154056.00082_rect_color.tif 2019/10/09 15:40:56.1122 46.575870 -124.603094 192.80 2.78 20191009.154056.00081_rect_color.tif',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, keys, 'nav.txt');

    expect(source).not.toBeNull();
    expect(source?.sourceName).toBe('nav.txt');
    expect(Object.keys(source?.records || {})).toEqual([
      '20191009.154056.00082_rect_color',
    ]);
    const portRecord = source?.records['20191009.154056.00082_rect_color'];
    const expectedColumns = [
      'port_image',
      'date',
      'time',
      'latitude',
      'longitude',
      'water_depth',
      'altitude',
    ];
    expect(Object.keys(portRecord || {})).toEqual(expectedColumns);
    // Columns are reported in file order, excluding the second (non-join) image candidate.
    expect(source?.columns).toEqual(expectedColumns);
    expect(portRecord?.latitude).toBe('46.575870');
    expect(Object.values(portRecord || {}).every((value) => typeof value === 'string')).toBe(true);
  });

  it('parses comma, tab, and whitespace delimited sources', () => {
    const keys = new Map([['image_0001', 0]]);

    [
      'filename,depth,latitude\nimage_0001.jpg,192.80,46.575870\n',
      'filename\tdepth\tlatitude\nimage_0001.jpg\t192.80\t46.575870\n',
      'filename depth latitude\nimage_0001.jpg 192.80 46.575870\n',
    ].forEach((text) => {
      const source = parseFrameMetadataSource(text, keys);

      expect(source).not.toBeNull();
      expect(source?.records.image_0001).toEqual({
        filename: 'image_0001.jpg',
        depth: '192.80',
        latitude: '46.575870',
      });
    });
  });

  it('picks the leftmost join column on a score tie', () => {
    // Both image columns match one media key each (single-row floor of 1), so both are
    // join candidates; the leftmost wins and claims the only record.
    const keys = new Map([
      ['20191009.154056.00082_rect_color', 0],
      ['20191009.154056.00081_rect_color', 0],
    ]);
    const text = [
      'port_image,latitude,starboard_image',
      '20191009.154056.00082_rect_color.tif,46.575870,20191009.154056.00081_rect_color.tif',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, keys);

    expect(source).not.toBeNull();
    expect(Object.keys(source?.records || {})).toEqual([
      '20191009.154056.00082_rect_color',
    ]);
    // The second image column is a join candidate, so it is neither joined nor payload.
    expect(Object.keys(source?.records['20191009.154056.00082_rect_color'] || {})).toEqual([
      'port_image',
      'latitude',
    ]);
  });

  it('picks the argmax join column over a lower-scoring match', () => {
    // `left` matches all 3 rows; `right` matches only the c.png cell (score 1 < floor 2),
    // so `right` stays payload and every record is keyed by `left`.
    const keys = new Map([['a.png', 0], ['b.png', 1], ['c.png', 2]]);
    const text = 'left,right,depth\na.png,z.png,10\nb.png,y.png,11\nc.png,a.png,12\n';

    const source = parseFrameMetadataSource(text, keys);

    expect(source).not.toBeNull();
    expect(Object.keys(source?.records || {}).sort()).toEqual(['a', 'b', 'c']);
    expect(source?.records.a).toEqual({ left: 'a.png', right: 'z.png', depth: '10' });
  });

  it('parses a sidecar containing a bare double-quote character', () => {
    const keys = new Map([['image_0001', 0]]);
    const text = [
      'filename,depth',
      'image_0001.jpg,5"',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, keys);

    expect(source).not.toBeNull();
    expect(source?.records.image_0001.depth).toBe('5"');
  });

  it('accepts VIAME-shaped telemetry without the VIAME header', () => {
    const keys = new Map([['image_0001', 0]]);
    const text = [
      'index,image,frame,x,y,depth,altitude,heading,temperature',
      '1,image_0001.jpg,100,46.5,-124.6,192.8,2.7,180.5,4.2',
      '',
    ].join('\n');

    const source = parseFrameMetadataSource(text, keys);

    expect(source).not.toBeNull();
    expect(source?.records.image_0001.depth).toBe('192.8');
  });

  it('rejects bare image lists and unrelated text', () => {
    const keys = new Map([['image_0001', 0]]);

    expect(parseFrameMetadataSource('image\nimage_0001.jpg\n', keys)).toBeNull();
    expect(parseFrameMetadataSource('note,value\nhello,world\n', keys)).toBeNull();
  });

  it('matches the shared synthetic AUV fixture', () => {
    const expectedFixture = loadExpectedFixture();

    Object.entries(expectedFixture.sources).forEach(([sourceName, expected]) => {
      const text = fixtureText(sourceName);
      Object.entries(expected.cameras).forEach(([camera, cameraExpected]) => {
        const expectedRecords = Object.fromEntries(
          cameraExpected.frames.map((frame) => [frame, expected.recordsByFrame[frame]]),
        );
        const { joinColumn } = cameraExpected;
        const keys = mediaKeys(expectedRecords, joinColumn);
        const source = parseFrameMetadataSource(text, keys, sourceName);

        expect(source).not.toBeNull();
        if (source === null) {
          throw new Error(`Expected ${sourceName} to parse for ${camera}`);
        }
        expect(source.sourceName).toBe(sourceName);
        expect(recordsByFrame(source, keys)).toEqual(expectedRecords);
        expect(Object.values(source.records).every((record) => (
          Object.values(record).every((value) => typeof value === 'string')
        ))).toBe(true);
      });
    });
  });

  it('uses a hash-prefixed header line as the header', () => {
    const source = parseFrameMetadataSource(
      '# filename,depth,heading\nimg001.png,10,180\n',
      { 'img001.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001).toEqual({
      filename: 'img001.png',
      depth: '10',
      heading: '180',
    });
  });

  it('drops a standalone hash marker token from a whitespace header', () => {
    const source = parseFrameMetadataSource(
      '# filename depth heading\nimg001.png 10 180\n',
      { 'img001.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001).toEqual({
      filename: 'img001.png',
      depth: '10',
      heading: '180',
    });
  });

  it('skips a standalone comment block above the real header', () => {
    const source = parseFrameMetadataSource(
      '# vehicle: AUV, dive 42\nfilename,depth\nimg001.png,10\n',
      { 'img001.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001).toEqual({ filename: 'img001.png', depth: '10' });
  });

  it('strips a leading UTF-8 BOM from the header cell', () => {
    const source = parseFrameMetadataSource(
      '﻿filename,depth\nimg001.png,10\n',
      { 'img001.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001).toEqual({ filename: 'img001.png', depth: '10' });
  });

  it('rejects NUL-poisoned and oversized fields as no source', () => {
    expect(parseFrameMetadataSource(
      'filename,alt\x00\nimg001.png,42\x00\n',
      { 'img001.png': 0 },
    )).toBeNull();

    const hugeField = `filename,notes\nimg001.png,${'x'.repeat(140000)}\n`;
    expect(parseFrameMetadataSource(hugeField, { 'img001.png': 0 })).toBeNull();
  });

  it('normalizes a double-extension media key exactly once', () => {
    const source = parseFrameMetadataSource(
      'filename,depth\nIMG_001.jpg.png,10\n',
      { 'IMG_001.jpg.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records['IMG_001.jpg']).toEqual({
      filename: 'IMG_001.jpg.png',
      depth: '10',
    });
  });

  it('keeps the non-join column as payload in a two-column source', () => {
    const source = parseFrameMetadataSource(
      'image,altitude\nimg001.png,10\nimg002.png,12\n',
      { 'img001.png': 0, 'img002.png': 1 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001).toEqual({ image: 'img001.png', altitude: '10' });
    expect(source?.records.img002).toEqual({ image: 'img002.png', altitude: '12' });
  });

  it('does not misattribute a numeric payload colliding with an image stem', () => {
    const keys: Record<string, number> = {};
    for (let index = 1; index <= 50; index += 1) {
      keys[`${index}.png`] = index - 1;
    }
    const source = parseFrameMetadataSource(
      'image,altitude,depth\n1.png,42,100\n2.png,999,200\n',
      keys,
    );

    expect(source).not.toBeNull();
    expect(Object.keys(source?.records || {}).sort()).toEqual(['1', '2']);
    expect(source?.records['1']).toEqual({ image: '1.png', altitude: '42', depth: '100' });
  });

  it('keeps the first row for duplicate media keys', () => {
    const source = parseFrameMetadataSource(
      'filename,depth\nimg001.png,10\nimg001.png,99\n',
      { 'img001.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001.depth).toBe('10');
  });

  it('sniffs the delimiter from the data line, not a prose comment', () => {
    // A delimiter-free `#` comment over comma data sniffs the comma from the first
    // non-comment line, so a comment-headed sidecar still joins.
    const source = parseFrameMetadataSource(
      '# AUV nav log\nfilename,depth\nimg001.png,10\n',
      { 'img001.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001).toEqual({ filename: 'img001.png', depth: '10' });
  });

  it('prefers a data-line tab over a comma in the comment prose', () => {
    const source = parseFrameMetadataSource(
      '# Position (lat, lon) log\nfilename\tdepth\nimg001.png\t10\n',
      { 'img001.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001).toEqual({ filename: 'img001.png', depth: '10' });
  });

  it('returns null when every non-empty line is a comment', () => {
    expect(parseFrameMetadataSource('# one\n# two\n# three\n', { 'img001.png': 0 })).toBeNull();
  });

  it('drops a leading all-empty row before header selection', () => {
    // The tokenizer keeps `,,,` as an all-empty row; without the filter it becomes the header.
    const source = parseFrameMetadataSource(
      ',,,\nfilename,depth\nimg001.png,100\n',
      { 'img001.png': 0 },
    );

    expect(source).not.toBeNull();
    expect(source?.records.img001).toEqual({ filename: 'img001.png', depth: '100' });
  });

  it('accepts a wide row whose cells are each within the field limit', () => {
    // Total row length exceeds 131072 but no single cell does, so it stays telemetry.
    const cell = 'a'.repeat(7000);
    const columns = Array.from({ length: 20 }, (_, index) => `c${index + 1}`);
    const header = ['filename', ...columns].join(',');
    const row = ['img001.png', ...columns.map(() => cell)].join(',');
    const source = parseFrameMetadataSource(`${header}\n${row}\n`, { 'img001.png': 0 });

    expect(source).not.toBeNull();
    expect(source?.records.img001.filename).toBe('img001.png');
    expect(source?.records.img001.c1).toBe(cell);
    expect(source?.records.img001.c20).toBe(cell);
  });

  it('rejects a source with a single cell over the field limit', () => {
    const oversized = `filename,notes\nimg001.png,${'x'.repeat(131073)}\n`;
    expect(parseFrameMetadataSource(oversized, { 'img001.png': 0 })).toBeNull();
  });

  it('accepts a prebuilt index identically to raw media keys', () => {
    const text = 'filename,depth\nimg001.png,10\n';
    const fromKeys = parseFrameMetadataSource(text, { 'img001.png': 0 });
    const fromIndex = parseFrameMetadataSource(text, buildMediaKeyIndex(['img001.png']));

    expect(fromKeys).not.toBeNull();
    expect(fromIndex).not.toBeNull();
    expect(fromIndex?.records).toEqual(fromKeys?.records);
    expect(fromIndex?.records.img001).toEqual({ filename: 'img001.png', depth: '10' });
  });

  it('parses a hash header with the threaded join and a prebuilt index', () => {
    // A `#` header validated inside header selection is parsed with the join it was
    // validated with; the leftmost image column joins and the second is neither joined
    // nor payload.
    const source = parseFrameMetadataSource(
      '# port_image,depth,starboard_image\nimg001.png,10,img002.png\n',
      buildMediaKeyIndex(['img001.png', 'img002.png']),
    );

    expect(source).not.toBeNull();
    expect(Object.keys(source?.records || {})).toEqual(['img001']);
    expect(Object.keys(source?.records.img001 || {})).toEqual(['port_image', 'depth']);
    expect(source?.records.img001.depth).toBe('10');
  });
});

type ParserCase = {
  name: string;
  text: string;
  mediaKeys: Record<string, number>;
  records: Record<string, Record<string, string>> | null;
  assertParsed?: (parsed: ParsedFrameMetadata | null) => void;
};

const defaultParserMediaKeys = { 'img001.png': 0, 'img002.png': 1 };
const wideCell = 'a'.repeat(7000);
const wideColumns = Array.from({ length: 20 }, (_, index) => `c${index + 1}`);

function numericCollisionMediaKeys(): Record<string, number> {
  const keys: Record<string, number> = {};
  for (let index = 1; index <= 50; index += 1) {
    keys[`${index}.png`] = index - 1;
  }
  return keys;
}

const parserCases: ParserCase[] = [
  {
    name: 'all-comments',
    text: '# comment one\n# comment two\n# comment three\n',
    mediaKeys: defaultParserMediaKeys,
    records: null,
  },
  {
    name: 'basic',
    text: 'filename,depth\nimg001.png,10\nimg002.png,12\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10' },
      img002: { filename: 'img002.png', depth: '12' },
    },
  },
  {
    name: 'bom-telemetry',
    text: '\ufefffilename,depth\nimg001.png,10\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10' },
    },
  },
  {
    name: 'comment-block',
    text: '# vehicle: AUV, dive 42\nfilename,depth\nimg001.png,10\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10' },
    },
  },
  {
    name: 'comment-comma-over-tsv',
    text: '# Position (lat, lon) log\nfilename\tdepth\nimg001.png\t10\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10' },
    },
  },
  {
    name: 'comment-prose-header',
    text: '# AUV nav log\nfilename,depth\nimg001.png,10\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10' },
    },
  },
  {
    name: 'double-extension',
    text: 'filename,depth\nIMG_001.jpg.png,10\n',
    mediaKeys: { 'IMG_001.jpg.png': 0 },
    records: {
      'IMG_001.jpg': { filename: 'IMG_001.jpg.png', depth: '10' },
    },
  },
  {
    name: 'duplicate-rows',
    text: 'filename,depth\nimg001.png,10\nimg001.png,99\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10' },
    },
  },
  {
    name: 'hash-header',
    text: '# filename,depth,heading\nimg001.png,10,180\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10', heading: '180' },
    },
  },
  {
    name: 'huge-field',
    text: `filename,notes\nimg001.png,${'x'.repeat(131073)}\n`,
    mediaKeys: defaultParserMediaKeys,
    records: null,
  },
  {
    name: 'leading-empty-row',
    text: ',,,\nfilename,depth\nimg001.png,100\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '100' },
    },
  },
  {
    name: 'nav-whitespace',
    text: '# filename depth heading\nimg001.png 10 180\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10', heading: '180' },
    },
  },
  {
    name: 'no-join',
    text: 'station,depth\nA,10\n',
    mediaKeys: defaultParserMediaKeys,
    records: null,
  },
  {
    name: 'nul-bytes',
    text: 'filename,alt\0\nimg001.png,42\0\n',
    mediaKeys: defaultParserMediaKeys,
    records: null,
  },
  {
    name: 'numeric-collision',
    text: 'image,altitude,depth\n1.png,42,100\n2.png,999,200\n',
    mediaKeys: numericCollisionMediaKeys(),
    records: {
      1: { image: '1.png', altitude: '42', depth: '100' },
      2: { image: '2.png', altitude: '999', depth: '200' },
    },
  },
  {
    name: 'pandas-index',
    text: ',filename,depth\n0,img001.png,10\n1,img002.png,12\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10' },
      img002: { filename: 'img002.png', depth: '12' },
    },
  },
  {
    name: 'proto',
    text: 'filename,depth\n__proto__.png,10\n',
    mediaKeys: { '__proto__.png': 0 },
    records: {
      ['__proto__']: { filename: '__proto__.png', depth: '10' },
    },
    assertParsed: (parsed) => {
      expect(parsed).not.toBeNull();
      expect(Object.prototype.hasOwnProperty.call(parsed?.records ?? {}, '__proto__')).toBe(true);
    },
  },
  {
    name: 'tab-comma-units',
    text: 'filename\tPosition (lat, lon)\tDepth (m)\nimg001.png\t42.35, -70.90\t12.4\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: {
        filename: 'img001.png',
        'Position (lat, lon)': '42.35, -70.90',
        'Depth (m)': '12.4',
      },
    },
  },
  {
    name: 'trailing-comma',
    text: 'filename,depth,\nimg001.png,10,\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'img001.png', depth: '10' },
    },
  },
  {
    name: 'two-column',
    text: 'image,altitude\nimg001.png,10\nimg002.png,12\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { image: 'img001.png', altitude: '10' },
      img002: { image: 'img002.png', altitude: '12' },
    },
  },
  {
    name: 'viame-annotations',
    text: [
      '# 1: Detection or Track-id,2: Video or Image Identifier,3: Unique Frame Identifier,4-7: Img-bbox(TL_x,TL_y,BR_x,BR_y),8: Detection or Length Confidence,9: Target Length (0 or -1 if invalid),10-11+: Repeated Species,Confidence Pairs or Attributes',
      '1,img001.png,0,10,20,30,40,1.0,-1,fish,0.9',
      '',
    ].join('\n'),
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: {
        '1: Detection or Track-id': '1',
        '2: Video or Image Identifier': 'img001.png',
        '3: Unique Frame Identifier': '0',
        '4-7: Img-bbox(TL_x': '10',
        TL_y: '20',
        BR_x: '30',
        'BR_y)': '40',
        '8: Detection or Length Confidence': '1.0',
        '9: Target Length (0 or -1 if invalid)': '-1',
        '10-11+: Repeated Species': 'fish',
        'Confidence Pairs or Attributes': '0.9',
      },
    },
  },
  {
    name: 'wide-row',
    text: `${['filename', ...wideColumns].join(',')}\n${[
      'img001.png',
      ...wideColumns.map(() => wideCell),
    ].join(',')}\n`,
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: {
        filename: 'img001.png',
        ...Object.fromEntries(wideColumns.map((column) => [column, wideCell])),
      },
    },
  },
  {
    name: 'windows-paths',
    text: 'filename,depth\nimages\\img001.png,10\n',
    mediaKeys: defaultParserMediaKeys,
    records: {
      img001: { filename: 'images\\img001.png', depth: '10' },
    },
  },
];

// Resolve the shared naming truth table at the repo root. The spec lives at
// client/dive-common/frameMetadata, three levels below the root; when the runner does not
// provide __dirname, npm test runs with CWD=client/ (one level below root).
function sourceNamesTruthTablePath(): string {
  const fromDirname = typeof __dirname === 'string'
    ? path.resolve(
      __dirname,
      '../../../testdata/frame-metadata-conformance/source_names.expected.json',
    )
    : null;
  if (fromDirname && fs.existsSync(fromDirname)) {
    return fromDirname;
  }
  return path.resolve('../testdata/frame-metadata-conformance/source_names.expected.json');
}

// Compare records structurally through sorted [key, value] pairs so equality is
// unaffected by prototype and so an own "__proto__" key participates in the comparison
// instead of being read off the chain.
function toComparable(records: Record<string, Record<string, string>> | null) {
  if (records === null) {
    return null;
  }
  return Object.keys(records).sort().map((frame) => {
    const record = records[frame];
    return [frame, Object.keys(record).sort().map((field) => [field, record[field]])];
  });
}

describe('inline frame-metadata parser cases', () => {
  parserCases.forEach((parserCase) => {
    it(`matches ${parserCase.name}`, () => {
      const parsed = parseFrameMetadataSource(parserCase.text, parserCase.mediaKeys);
      const records = parsed === null ? null : parsed.records;

      expect(toComparable(records)).toEqual(toComparable(parserCase.records));
      parserCase.assertParsed?.(parsed);
    });
  });
});

describe('shared frame-metadata naming', () => {
  it('matches the shared source-name predicate truth table', () => {
    // The truth table is shared with the server harness so the mirrored predicate cannot drift.
    const truthTablePath = sourceNamesTruthTablePath();
    expect(fs.existsSync(truthTablePath)).toBe(true);
    const truthTable = JSON.parse(fs.readFileSync(truthTablePath, 'utf-8')) as Record<string, boolean>;
    Object.entries(truthTable).forEach(([name, expected]) => {
      expect(isFrameMetadataSourceName(name)).toBe(expected);
    });
  });
});
