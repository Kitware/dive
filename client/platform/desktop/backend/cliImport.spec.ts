import npath from 'path';
import { describe, expect, it } from 'vitest';

import { parseCliArgs } from './cliImport';

describe('parseCliArgs', () => {
  it('returns null when no --import is present', () => {
    expect(parseCliArgs(['/usr/bin/dive-desktop'])).toBeNull();
    expect(parseCliArgs(['/usr/bin/dive-desktop', '--no-sandbox'])).toBeNull();
  });

  it('parses media, annotations and name', () => {
    const args = parseCliArgs([
      '/usr/bin/dive-desktop',
      '--import', '/data/input_list.txt',
      '--annotations', '/data/detections.csv',
      '--name', 'Sea Lions',
    ]);
    expect(args).toEqual({
      importPath: '/data/input_list.txt',
      annotationPath: '/data/detections.csv',
      name: 'Sea Lions',
    });
  });

  it('parses an optional metadata file', () => {
    const args = parseCliArgs([
      'app',
      '--import', '/data/imgs',
      '--metadata', '/data/flight_log.csv',
    ]);
    expect(args).toEqual({
      importPath: '/data/imgs',
      annotationPath: undefined,
      metadataPath: '/data/flight_log.csv',
      name: undefined,
    });
  });

  it('supports = syntax for --metadata', () => {
    expect(parseCliArgs([
      'app', '--import=/data/imgs', '--metadata=/data/log.json',
    ])?.metadataPath).toEqual('/data/log.json');
  });

  it('resolves a relative metadata path against the working directory', () => {
    const args = parseCliArgs(['app', '--import', 'list.txt', '--metadata', 'log.csv']);
    expect(args?.metadataPath).toEqual(npath.resolve('log.csv'));
  });

  it('supports = syntax and short flags', () => {
    expect(parseCliArgs(['app', '--import=/data/imgs', '-a', '/data/x.csv'])).toEqual({
      importPath: '/data/imgs',
      annotationPath: '/data/x.csv',
      name: undefined,
    });
    expect(parseCliArgs(['app', '-i', '/data/imgs'])?.importPath).toEqual('/data/imgs');
  });

  it('resolves relative paths against the working directory', () => {
    const args = parseCliArgs(['app', '--import', 'list.txt', '-a', 'out.csv']);
    expect(args?.importPath).toEqual(npath.resolve('list.txt'));
    expect(args?.annotationPath).toEqual(npath.resolve('out.csv'));
  });

  it('ignores electron switches interleaved with our flags', () => {
    const args = parseCliArgs([
      '/usr/bin/dive-desktop',
      '--no-sandbox',
      '--import', '/data/video.mp4',
      '--ignore-gpu-blacklist',
    ]);
    expect(args?.importPath).toEqual('/data/video.mp4');
    expect(args?.annotationPath).toBeUndefined();
  });

  it('does not treat a following flag as a value', () => {
    // --import with no value must not swallow --no-sandbox as its path
    expect(parseCliArgs(['app', '--import', '--no-sandbox'])).toBeNull();
  });
});

describe('parseCliArgs multi-camera', () => {
  it('parses cameras, per-camera annotations and calibration', () => {
    const args = parseCliArgs([
      'app',
      '--camera', 'left=/data/left',
      '--camera', 'right=/data/right',
      '--annotations', 'left=/data/left.csv',
      '--annotations', 'right=/data/right.csv',
      '--calibration', '/data/cal.npz',
      '--name', 'Stereo Run',
    ]);
    expect(args).toEqual({
      cameras: { left: '/data/left', right: '/data/right' },
      cameraOrder: ['left', 'right'],
      cameraAnnotations: { left: '/data/left.csv', right: '/data/right.csv' },
      defaultDisplay: 'left',
      calibrationPath: '/data/cal.npz',
      name: 'Stereo Run',
    });
  });

  it('parses an optional metadata file for multi-camera', () => {
    const args = parseCliArgs([
      'app',
      '--camera', 'left=/data/left',
      '--camera', 'right=/data/right',
      '--metadata', '/data/flight_log.csv',
    ]);
    expect(args?.metadataPath).toEqual('/data/flight_log.csv');
  });

  it('defaults defaultDisplay to left, else the first camera', () => {
    expect(parseCliArgs([
      'app', '--camera', 'right=/d/r', '--camera', 'left=/d/l',
    ])?.defaultDisplay).toEqual('left');
    expect(parseCliArgs([
      'app', '--camera', 'cam2=/d/2', '--camera', 'cam1=/d/1',
    ])?.defaultDisplay).toEqual('cam2');
  });

  it('honors an explicit --default-display', () => {
    expect(parseCliArgs([
      'app', '--camera', 'left=/d/l', '--camera', 'right=/d/r',
      '--default-display', 'right',
    ])?.defaultDisplay).toEqual('right');
  });

  it('keeps camera order, which is the display order', () => {
    expect(parseCliArgs([
      'app', '--camera', 'c=/d/c', '--camera', 'a=/d/a', '--camera', 'b=/d/b',
    ])?.cameraOrder).toEqual(['c', 'a', 'b']);
  });

  it('splits on the first = so windows paths survive', () => {
    expect(parseCliArgs([
      'app', '--camera', 'left=C:\\data\\left', '--camera', 'right=C:\\data\\right',
    ])?.cameras?.left).toContain('C:\\data\\left');
  });

  it('rejects a single camera', () => {
    expect(() => parseCliArgs(['app', '--camera', 'left=/d/l']))
      .toThrow(/at least two --camera/);
  });

  it('rejects --import together with --camera', () => {
    expect(() => parseCliArgs([
      'app', '--import', '/d/x', '--camera', 'left=/d/l', '--camera', 'right=/d/r',
    ])).toThrow(/mutually exclusive/);
  });

  it('rejects annotations for an unknown camera', () => {
    expect(() => parseCliArgs([
      'app', '--camera', 'left=/d/l', '--camera', 'right=/d/r',
      '--annotations', 'middle=/d/m.csv',
    ])).toThrow(/unknown camera 'middle'/);
  });

  it('rejects an unknown --default-display', () => {
    expect(() => parseCliArgs([
      'app', '--camera', 'left=/d/l', '--camera', 'right=/d/r',
      '--default-display', 'middle',
    ])).toThrow(/unknown camera 'middle'/);
  });

  it('rejects a duplicate camera name', () => {
    expect(() => parseCliArgs([
      'app', '--camera', 'left=/d/l', '--camera', 'left=/d/l2',
    ])).toThrow(/given more than once/);
  });

  it('rejects malformed camera arguments', () => {
    expect(() => parseCliArgs(['app', '--camera', '/d/l', '--camera', 'right=/d/r']))
      .toThrow(/expects <camera>=<path>/);
  });

  it('rejects --calibration on a single-camera dataset', () => {
    expect(() => parseCliArgs(['app', '--import', '/d/x', '--calibration', '/d/c.npz']))
      .toThrow(/--calibration applies to multi-camera/);
  });

  it('rejects repeated --annotations on a single-camera dataset', () => {
    expect(() => parseCliArgs([
      'app', '--import', '/d/x', '--annotations', '/d/a.csv', '--annotations', '/d/b.csv',
    ])).toThrow(/may only be given once/);
  });
});
