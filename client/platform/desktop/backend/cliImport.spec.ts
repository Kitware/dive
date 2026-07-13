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
