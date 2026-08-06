/// <reference types="vitest" />

import { buildFrameAlignmentIndex, resolveCameraAttachment } from './resolve';
import type { FrameMetadataFrameContext } from './resolve';

function imageFrameContext(mediaNames: string[]): FrameMetadataFrameContext {
  return { mediaType: 'image-sequence', mediaNames };
}

function resolveImages(text: string, mediaNames: string[], sourceName?: string) {
  return resolveCameraAttachment(
    text,
    buildFrameAlignmentIndex(imageFrameContext(mediaNames)),
    sourceName,
  );
}

function resolvedMetadata(result: ReturnType<typeof resolveCameraAttachment>) {
  if (result.status !== 'resolved') {
    throw new Error(`expected a resolved attachment, got ${result.status}`);
  }
  return result.metadata;
}

describe('buildFrameAlignmentIndex', () => {
  it('normalizes an ordered media list to frame numbers', () => {
    const index = buildFrameAlignmentIndex(imageFrameContext(['img001.png', 'nested/img002.png']));

    expect(index.frameCount).toBe(2);
    expect(index.frameByAlignmentKey).toEqual(new Map([['img001', 0], ['img002', 1]]));
    expect(index.frameByCounter).toEqual(new Map([[1, 0], [2, 1]]));
  });

  it('keeps later duplicate basenames but excludes repeated counters', () => {
    const index = buildFrameAlignmentIndex(imageFrameContext([
      'a/img001.png', 'b/img001.png', 'other001.png', 'img002.png',
    ]));

    expect(index.frameByAlignmentKey.get('img001')).toBe(1);
    expect(index.frameByAlignmentKey.get('img002')).toBe(3);
    expect(index.frameByCounter?.has(1)).toBe(false);
    expect(index.frameByCounter?.get(2)).toBe(3);
  });

  it('builds a frame-bound-only index for video', () => {
    const index = buildFrameAlignmentIndex({ mediaType: 'video', frameCount: 3 });

    expect(index).toEqual({
      frameCount: 3,
      frameByAlignmentKey: new Map(),
    });
    expect(index.frameByCounter).toBeUndefined();
  });
});

describe('resolveCameraAttachment', () => {
  it('distinguishes invalid input from an unmatched valid table', () => {
    expect(resolveImages('', ['img001.png']).status).toBe('invalid');
    expect(resolveImages('station,depth\nA,10\n', ['img001.png']).status).toBe('unmatched');
  });

  it('reports why a blocked table was rejected', () => {
    expect(resolveImages(
      'frame,depth\nbad,1\n99,2\n',
      ['a.png', 'b.png'],
    )).toEqual({ status: 'unmatched', reason: 'invalid-declaration' });
  });

  it('resolves filename rows into the compact payload', () => {
    const metadata = resolvedMetadata(resolveImages(
      'filename,depth\nimg001.png,10\nimg002.png,12\n',
      ['img001.png', 'img002.png'],
      'frame_metadata.csv',
    ));

    expect(metadata.columns).toEqual(['filename', 'depth']);
    expect(metadata.records[0]).toEqual(['img001.png', '10']);
    expect(metadata.records[1]).toEqual(['img002.png', '12']);
    expect(metadata.sourceName).toBe('frame_metadata.csv');
  });

  it('keeps numeric-named columns in file order', () => {
    const metadata = resolvedMetadata(resolveImages(
      'filename,3,1,2\nimg001.png,c,a,b\n',
      ['img001.png'],
    ));

    expect(metadata.columns).toEqual(['filename', '3', '1', '2']);
    expect(metadata.records[0]).toEqual(['img001.png', 'c', 'a', 'b']);
  });

  it('bounds image-sequence literal frame rows by the media list length', () => {
    const metadata = resolvedMetadata(resolveImages(
      'frame,depth\n2,12\n3,past-the-end\n0,10\n',
      ['a.png', 'b.png', 'c.png'],
    ));

    expect(metadata.records[0]).toEqual(['0', '10']);
    expect(metadata.records[1]).toBeUndefined();
    expect(metadata.records[2]).toEqual(['2', '12']);
    expect(metadata.records[3]).toBeUndefined();
  });

  it('bounds video literal frame rows by the declared frame count', () => {
    const metadata = resolvedMetadata(resolveCameraAttachment(
      'frame,value\n2,last\nbad,invalid\n0,first\n3,out\n2,duplicate\n',
      buildFrameAlignmentIndex({ mediaType: 'video', frameCount: 3 }),
      'frame-metadata.csv',
    ));

    expect(metadata.records).toEqual({
      0: ['0', 'first'],
      2: ['2', 'last'],
    });
  });

  it.each(['filename', 'count', 'frame_index', 'frame_id', 'sample'])(
    'does not use video %s values as frame identity',
    (column) => {
      const result = resolveCameraAttachment(
        `${column},value\n0,a\n2,b\n`,
        buildFrameAlignmentIndex({ mediaType: 'video', frameCount: 3 }),
        'frame-metadata.csv',
      );

      expect(result.status).toBe('unmatched');
    },
  );

  it('selects a per-camera filename column from a shared multicamera source', () => {
    const text = [
      'port_image,depth,starboard_image',
      'port001.tif,10,star001.tif',
      'port002.tif,12,star002.tif',
      '',
    ].join('\n');
    const left = resolvedMetadata(resolveImages(text, ['port001.tif', 'port002.tif']));
    const right = resolvedMetadata(resolveImages(text, ['star002.tif', 'star001.tif']));

    expect(left.records[0]).toEqual(['port001.tif', '10', 'star001.tif']);
    expect(right.records[0]).toEqual(['port002.tif', '12', 'star002.tif']);
    expect(right.records[1]).toEqual(['port001.tif', '10', 'star001.tif']);
  });

  it('binds one shared counter log independently to each camera', () => {
    const shared = 'frame_count,depth\n173,10\n174,12\n';
    const port = resolvedMetadata(resolveImages(shared, ['P_00173.jpg', 'P_00174.jpg']));
    const star = resolvedMetadata(resolveImages(shared, ['S_00173.jpg', 'S_00174.jpg']));

    expect(port.records[0]).toEqual(['173', '10']);
    expect(star.records[0]).toEqual(['173', '10']);
    expect(star.records[1]).toEqual(['174', '12']);
  });
});
