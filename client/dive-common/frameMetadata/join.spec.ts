/// <reference types="vitest" />

import { extractCounter, resolveTableToFrames } from './join';
import type { ResolvedCameraFrameMetadata } from './join';
import { parseFrameMetadataTable } from './parser';
import { buildFrameAlignmentIndex } from './resolve';
import type { FrameMetadataFrameContext } from './resolve';

function imageFrameContext(mediaNames: string[]): FrameMetadataFrameContext {
  return { mediaType: 'image-sequence', mediaNames };
}

function join(text: string, context: FrameMetadataFrameContext, sourceName?: string) {
  const table = parseFrameMetadataTable(text);
  if (table === null) {
    throw new Error('expected a parsable table');
  }
  return resolveTableToFrames(table, buildFrameAlignmentIndex(context), sourceName);
}

/** Joined payload for an image sequence, or null when no tier matched. */
function joinImages(
  text: string,
  mediaNames: string[],
  sourceName?: string,
): ResolvedCameraFrameMetadata | null {
  const result = join(text, imageFrameContext(mediaNames), sourceName);
  return result.status === 'matched' ? result.parsed : null;
}

describe('filename joins', () => {
  it('emits DIVE frame numbers and preserves source column order', () => {
    const parsed = joinImages(
      'filename,3,1,2\nimg002.png,c,a,b\nimg001.png,cc,aa,bb\n',
      ['img001.png', 'img002.png'],
      'frame-metadata.csv',
    );

    expect(parsed?.sourceName).toBe('frame-metadata.csv');
    expect(parsed?.columns).toEqual(['filename', '3', '1', '2']);
    expect(parsed?.records[0]).toEqual(['img001.png', 'cc', 'aa', 'bb']);
    expect(parsed?.records[1]).toEqual(['img002.png', 'c', 'a', 'b']);
  });

  it('keeps the first row for a duplicate filename', () => {
    const parsed = joinImages(
      'filename,depth\nimg001.png,10\nimg001.png,99\n',
      ['img001.png'],
    );

    expect(parsed?.records[0]).toEqual(['img001.png', '10']);
  });

  it('matches media stored with a different image extension', () => {
    const parsed = joinImages(
      'filename,depth\nimg001.gif,10\nimg002.avif,12\n',
      ['img001.tif', 'img002.tif'],
    );

    expect(parsed?.records[0]).toEqual(['img001.gif', '10']);
    expect(parsed?.records[1]).toEqual(['img002.avif', '12']);
  });

  it('selects a camera-local filename column from a dual-camera table', () => {
    const text = [
      'port_image,depth,starboard_image',
      'port001.tif,10,star001.tif',
      'port002.tif,12,star002.tif',
      '',
    ].join('\n');
    const port = joinImages(text, ['port001.tif', 'port002.tif']);
    const starboard = joinImages(text, ['star002.tif', 'star001.tif']);

    expect(port?.records[0]).toEqual(['port001.tif', '10', 'star001.tif']);
    expect(starboard?.records[0]).toEqual(['port002.tif', '12', 'star002.tif']);
    expect(starboard?.records[1]).toEqual(['port001.tif', '10', 'star001.tif']);
  });

  it('joins on the leftmost matching column and keeps the rest as data', () => {
    const parsed = joinImages(
      'primary,secondary,depth\na.png,a.png,1\nb.png,b.png,2\nc.png,qq.png,3\n',
      ['a.png', 'b.png', 'c.png'],
    );

    expect(parsed?.columns).toEqual(['primary', 'secondary', 'depth']);
    expect(parsed?.records[2]).toEqual(['c.png', 'qq.png', '3']);
  });

  it('takes the leftmost column when two columns both name this camera', () => {
    // Only reachable when one dataset holds both cameras' media; a real multicamera dataset
    // resolves each camera against its own media, where the sibling column matches nothing.
    const parsed = joinImages(
      'left_image,right_image,depth\na.png,b.png,1\nb.png,a.png,2\n',
      ['a.png', 'b.png'],
    );

    expect(parsed?.records[0]).toEqual(['a.png', 'b.png', '1']);
    expect(parsed?.records[1]).toEqual(['b.png', 'a.png', '2']);
  });

  it('keeps filename precedence for a VIAME-shaped source with a different frame field', () => {
    const parsed = joinImages('index,image,frame,depth\n1,img001.png,100,12.5\n', ['img001.png']);

    expect(parsed?.records[0]).toEqual(['1', 'img001.png', '100', '12.5']);
  });

  it('keeps both columns when a header name repeats', () => {
    const parsed = joinImages('filename,depth,depth\nimg001.png,10,20\n', ['img001.png']);

    expect(parsed?.columns).toEqual(['filename', 'depth', 'depth']);
    expect(parsed?.records[0]).toEqual(['img001.png', '10', '20']);
  });
});

describe('literal frame joins', () => {
  it('accepts zero-based, sparse, out-of-order, and leading-zero values', () => {
    const parsed = joinImages(
      'frame,depth\n03,30\n0,10\n2,20\n',
      ['a.png', 'b.png', 'c.png', 'd.png'],
    );

    expect(parsed?.columns).toEqual(['frame', 'depth']);
    expect(parsed?.records).toEqual({
      0: ['0', '10'],
      2: ['2', '20'],
      3: ['03', '30'],
    });
  });

  it('skips malformed and out-of-range rows while keeping valid rows', () => {
    const invalid = ['', '-1', '1.5', '+1', '9007199254740992', 'text', '3', '99'];
    const text = [
      'frame,value',
      ...invalid.map((value, index) => `${value},bad-${index}`),
      '1,good',
      '',
    ].join('\n');
    const parsed = joinImages(text, ['a.png', 'b.png', 'c.png']);

    expect(parsed?.records).toEqual({ 1: ['1', 'good'] });
  });

  it('keeps the first row for a duplicate valid frame', () => {
    const parsed = joinImages('frame,value\n1,first\n01,second\n', ['a.png', 'b.png']);

    expect(parsed?.records[1]).toEqual(['1', 'first']);
  });

  it('blocks a wholly invalid declaration without falling through to a counter', () => {
    expect(join(
      'frame,source_count,value\nbad,1,a\n99,2,b\n',
      imageFrameContext(['img_001.jpg', 'img_002.jpg']),
    )).toEqual({ status: 'blocked', reason: 'invalid-declaration' });
  });

  it('rejects a bare frame list', () => {
    expect(joinImages('frame\n0\n1\n', ['a.png', 'b.png'])).toBeNull();
  });

  it.each(['Frame', 'frame_index', 'frame_id', 'sample'])(
    'does not treat %s as the literal frame declaration',
    (column) => {
      expect(joinImages(`${column},value\n0,a\n1,b\n`, ['alpha.png', 'beta.png'])).toBeNull();
    },
  );
});

describe('source image counter joins', () => {
  it('extracts safe trailing decimal runs', () => {
    expect(extractCounter('cam_00173')).toBe(173);
    expect(extractCounter('20181101.155406.00082')).toBe(82);
    expect(extractCounter('img12_34')).toBe(34);
    expect(extractCounter('frame')).toBeUndefined();
    expect(extractCounter('h_1234567890123456789012')).toBeUndefined();
  });

  it('resolves a uniquely best monotonic counter column to frame numbers', () => {
    const parsed = joinImages(
      'frame_count,date,depth,pass\n173,145.00,10,1\n174,146.30,12,1\n175,147.10,14,1\n',
      ['cam_00173.jpg', 'cam_00174.jpg', 'cam_00175.jpg'],
    );

    expect(parsed?.records[0]).toEqual(['173', '145.00', '10', '1']);
    expect(parsed?.records[2][0]).toBe('175');
  });

  it('accepts strictly descending frame matches', () => {
    const parsed = joinImages(
      'count,value\n3,c\n2,b\n1,a\n',
      ['cam_1.jpg', 'cam_2.jpg', 'cam_3.jpg'],
    );

    expect(parsed?.records[0][1]).toBe('a');
    expect(parsed?.records[2][1]).toBe('c');
  });

  it('excludes ambiguous media counters', () => {
    const parsed = joinImages(
      'count,value\n1,a\n2,b\n',
      ['port_1.jpg', 'star_1.jpg', 'port_2.jpg'],
    );

    expect(parsed?.records[0]).toBeUndefined();
    expect(parsed?.records[1]).toBeUndefined();
    expect(parsed?.records[2]).toEqual(['2', 'b']);
  });

  it('disqualifies a column whose counters are claimed by two rows', () => {
    expect(joinImages(
      'count,value\n1,a\n1,b\n2,c\n3,d\n',
      ['cam_1.jpg', 'cam_2.jpg', 'cam_3.jpg'],
    )).toBeNull();
  });

  it('rejects a reset/reuse table while either monotonic segment resolves', () => {
    const mediaNames = ['cam_1.jpg', 'cam_2.jpg', 'cam_3.jpg'];

    expect(joinImages('count,value\n1,a\n2,b\n3,c\n1,d\n2,e\n3,f\n', mediaNames)).toBeNull();
    expect(joinImages('count,value\n1,a\n2,b\n3,c\n', mediaNames)?.records[2][1]).toBe('c');
    expect(joinImages('count,value\n1,d\n2,e\n3,f\n', mediaNames)?.records[0][1]).toBe('d');
  });

  it('blocks a non-monotonic candidate', () => {
    expect(joinImages(
      'count,value\n1,a\n3,c\n2,b\n',
      ['cam_1.jpg', 'cam_2.jpg', 'cam_3.jpg'],
    )).toBeNull();
  });

  it('takes the leftmost qualifying counter column', () => {
    const parsed = joinImages(
      'left,right,value\n1,1,a\n2,2,b\n3,3,c\n',
      ['cam_1.jpg', 'cam_2.jpg', 'cam_3.jpg'],
    );

    expect(parsed?.columns).toEqual(['left', 'right', 'value']);
    expect(parsed?.records[0]).toEqual(['1', '1', 'a']);
    expect(parsed?.records[2]).toEqual(['3', '3', 'c']);
  });

  it('finds frame_count in an independently authored 31-column hazard table', () => {
    const hazardColumns = Array.from({ length: 26 }, (_, index) => `sensor_${index + 1}`);
    const header = [
      'date', 'pass', 'time_a', 'time_b', ...hazardColumns, 'frame_count',
    ];
    const row = (counter: number, offset: number) => [
      String(20240708 + offset),
      '1',
      offset % 2 ? '12:00:00' : '12:00:01',
      offset % 2 ? '12:00:01' : '12:00:00',
      ...hazardColumns.map((_, index) => (
        index % 4 === 0 ? '' : `${6000 + offset * 100 + index}.5`
      )),
      String(counter),
    ];
    const text = [
      header.join(','),
      row(900, 0).join(','),
      row(173, 1).join(','),
      row(174, 2).join(','),
      row(175, 3).join(','),
      '',
    ].join('\n');
    const parsed = joinImages(text, ['cam_00173.jpg', 'cam_00174.jpg', 'cam_00175.jpg']);

    expect(header).toHaveLength(31);
    expect(parsed?.columns).toEqual(header);
    expect(parsed?.records[0][30]).toBe('173');
    expect(parsed?.records[2][30]).toBe('175');
  });

  it('still rejects a counter-only list with nothing to display', () => {
    expect(joinImages('count\n1\n2\n', ['cam_1.jpg', 'cam_2.jpg'])).toBeNull();
  });
});
