/// <reference types="vitest" />

import { buildMediaKeyIndex, resolveCameras } from './resolve';

describe('buildMediaKeyIndex', () => {
  it('normalizes an ordered media list to keys and frame numbers', () => {
    const index = buildMediaKeyIndex(['img001.png', 'nested/img002.png']);

    expect(index.normalizedKeys).toEqual(new Set(['img001', 'img002']));
    expect(index.frameByKey).toEqual(new Map([['img001', 0], ['img002', 1]]));
  });

  it('is tolerant of duplicate basenames (last-wins, never throws)', () => {
    // The import-path validator throws on duplicate basenames; the read-time index must not,
    // so a duplicate can never blank a camera. The later frame wins (Contract READ-KEYS).
    const index = buildMediaKeyIndex(['a/img001.png', 'b/img001.png', 'img002.png']);

    expect(index.normalizedKeys).toEqual(new Set(['img001', 'img002']));
    expect(index.frameByKey.get('img001')).toBe(1);
    expect(index.frameByKey.get('img002')).toBe(2);
  });
});

describe('resolveCameras', () => {
  it('resolves a single camera single source into the compact payload', () => {
    const media = buildMediaKeyIndex(['img001.png', 'img002.png']);
    const resolved = resolveCameras(
      { singleCam: [['nav.meta.csv', 'filename,depth\nimg001.png,10\nimg002.png,12\n']] },
      { singleCam: media },
    );

    expect(resolved.columns.singleCam).toEqual(['filename', 'depth']);
    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', '10']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', '12']);
    expect(resolved.sources.singleCam).toEqual(['nav.meta.csv']);
  });

  it('first-wins merges frames across sources in precedence order', () => {
    const media = buildMediaKeyIndex(['img001.png', 'img002.png']);
    const resolved = resolveCameras(
      {
        singleCam: [
          // The earlier (higher-precedence) source claims frame 0.
          ['primary.meta.csv', 'filename,depth\nimg001.png,10\n'],
          // The later source re-lists frame 0 (ignored) and adds frame 1.
          ['secondary.meta.csv', 'filename,depth\nimg001.png,99\nimg002.png,20\n'],
        ],
      },
      { singleCam: media },
    );

    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', '10']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', '20']);
    expect(resolved.sources.singleCam).toEqual(['primary.meta.csv', 'secondary.meta.csv']);
  });

  it('unions columns across sources in precedence and file order', () => {
    const media = buildMediaKeyIndex(['img001.png', 'img002.png']);
    const resolved = resolveCameras(
      {
        singleCam: [
          ['a.meta.csv', 'filename,depth\nimg001.png,10\n'],
          ['b.meta.csv', 'filename,heading\nimg002.png,180\n'],
        ],
      },
      { singleCam: media },
    );

    expect(resolved.columns.singleCam).toEqual(['filename', 'depth', 'heading']);
    // A frame's row is aligned to the union columns; cells its source lacked are empty.
    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', '10', '']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', '', '180']);
  });

  it('selects a per-camera join column from a shared multicam source', () => {
    // One wide sidecar binds both cameras: left joins on port_image, right on starboard_image,
    // and each camera keys rows by its own media order.
    const text = [
      'port_image,depth,starboard_image',
      'port001.tif,10,star001.tif',
      'port002.tif,12,star002.tif',
      '',
    ].join('\n');
    const resolved = resolveCameras(
      { left: [['nav.meta.csv', text]], right: [['nav.meta.csv', text]] },
      {
        left: buildMediaKeyIndex(['port001.tif', 'port002.tif']),
        // Reversed order so the join, not the row order, drives right's frame keys.
        right: buildMediaKeyIndex(['star002.tif', 'star001.tif']),
      },
    );

    expect(resolved.cameras.left[0]).toEqual(['port001.tif', '10', 'star001.tif']);
    expect(resolved.cameras.left[1]).toEqual(['port002.tif', '12', 'star002.tif']);
    // right frame 0 is star002 (its media index 0), which is the second data row.
    expect(resolved.cameras.right[0]).toEqual(['port002.tif', '12', 'star002.tif']);
    expect(resolved.cameras.right[1]).toEqual(['port001.tif', '10', 'star001.tif']);
  });

  it('tolerates duplicate media basenames when resolving (last-wins frame)', () => {
    const media = buildMediaKeyIndex(['a/img001.png', 'b/img001.png', 'img002.png']);
    const resolved = resolveCameras(
      { singleCam: [['nav.meta.csv', 'filename,depth\nimg001.png,10\nimg002.png,12\n']] },
      { singleCam: media },
    );

    // img001 resolves to the last (frame 1) of its duplicate basenames.
    expect(resolved.cameras.singleCam[1]).toEqual(['img001.png', '10']);
    expect(resolved.cameras.singleCam[2]).toEqual(['img002.png', '12']);
  });

  it('keeps numeric-named header columns in file order, not JS object-key order', () => {
    // Object keys would iterate numeric-like names as ['1','2','3']; the explicit columns array
    // preserves the file order ['3','1','2'] (readtime deferred finding #8).
    const media = buildMediaKeyIndex(['img001.png', 'img002.png']);
    const text = 'filename,3,1,2\nimg001.png,c,a,b\nimg002.png,cc,aa,bb\n';
    const resolved = resolveCameras(
      { singleCam: [['nav.meta.csv', text]] },
      { singleCam: media },
    );

    expect(resolved.columns.singleCam).toEqual(['filename', '3', '1', '2']);
    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', 'c', 'a', 'b']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', 'cc', 'aa', 'bb']);
  });

  it('omits a camera with no matching sidecar', () => {
    const resolved = resolveCameras(
      { singleCam: [['unrelated.meta.csv', 'station,depth\nA,10\n']] },
      { singleCam: buildMediaKeyIndex(['img001.png', 'img002.png']) },
    );

    expect(resolved.cameras.singleCam).toBeUndefined();
    expect(resolved.sources.singleCam).toBeUndefined();
    expect(resolved.columns.singleCam).toBeUndefined();
  });
});
