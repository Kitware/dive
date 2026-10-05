/// <reference types="vitest/globals" />
import {
  parseStitchedPath,
  stitchedFrame,
  stitchedSourceCrop,
  tagStitchedPath,
} from './stitchedStereo';

describe('stitched stereo frame geometry', () => {
  it('splits an even-width frame into two abutting halves', () => {
    expect(stitchedSourceCrop('left', 200, 50)).toEqual({
      left: 0, top: 0, right: 100, bottom: 50,
    });
    expect(stitchedSourceCrop('right', 200, 50)).toEqual({
      left: 100, top: 0, right: 200, bottom: 50,
    });
  });

  it('gives both halves of an odd-width frame the same width', () => {
    const left = stitchedSourceCrop('left', 201, 50);
    const right = stitchedSourceCrop('right', 201, 50);
    expect(left.right - left.left).toBe(100);
    expect(right.right - right.left).toBe(100);
    expect(right.right).toBe(201);
  });

  it('reports the half as the frame size, and the whole frame when not stitched', () => {
    expect(stitchedFrame('right', 200, 50)).toEqual({
      width: 100,
      height: 50,
      crop: {
        left: 100, top: 0, right: 200, bottom: 50,
      },
    });
    expect(stitchedFrame(null, 200, 50)).toEqual({ width: 200, height: 50 });
  });
});

describe('stitched path tags', () => {
  it('round-trips a tagged path', () => {
    const tagged = tagStitchedPath('/data/pair 01/frame#1.png', 'right');
    expect(parseStitchedPath(tagged)).toEqual({ path: '/data/pair 01/frame#1.png', side: 'right' });
  });

  it('leaves untagged and empty paths alone', () => {
    expect(tagStitchedPath('/data/a.png', undefined)).toBe('/data/a.png');
    expect(tagStitchedPath('', 'left')).toBe('');
    expect(parseStitchedPath('/data/a.png')).toEqual({ path: '/data/a.png', side: null });
    expect(parseStitchedPath('/data/a.png#stitched=middle')).toEqual({
      path: '/data/a.png#stitched=middle', side: null,
    });
  });
});
