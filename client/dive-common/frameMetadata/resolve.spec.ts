/// <reference types="vitest" />

import { buildFrameAlignmentIndex, resolveCameras } from './resolve';

describe('buildFrameAlignmentIndex', () => {
  it('normalizes an ordered media list to keys and frame numbers', () => {
    const index = buildFrameAlignmentIndex(['img001.png', 'nested/img002.png']);

    expect(index.alignmentKeys).toEqual(new Set(['img001', 'img002']));
    expect(index.frameByAlignmentKey).toEqual(new Map([['img001', 0], ['img002', 1]]));
  });

  it('is tolerant of duplicate basenames (last-wins, never throws)', () => {
    // The import-path validator throws on duplicate basenames; the read-time index must not
    // because that would blank the camera's metadata.
    const index = buildFrameAlignmentIndex(['a/img001.png', 'b/img001.png', 'img002.png']);

    expect(index.alignmentKeys).toEqual(new Set(['img001', 'img002']));
    expect(index.frameByAlignmentKey.get('img001')).toBe(1);
    expect(index.frameByAlignmentKey.get('img002')).toBe(2);
  });
});

describe('resolveCameras', () => {
  it('resolves a single camera single source into the compact payload', () => {
    const alignmentIndex = buildFrameAlignmentIndex(['img001.png', 'img002.png']);
    const resolved = resolveCameras(
      { singleCam: [['frame_metadata.csv', 'filename,depth\nimg001.png,10\nimg002.png,12\n']] },
      { singleCam: alignmentIndex },
    );

    expect(resolved.columns.singleCam).toEqual(['filename', 'depth']);
    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', '10']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', '12']);
    expect(resolved.sources.singleCam).toEqual(['frame_metadata.csv']);
  });

  it('first-wins merges frames across sources in precedence order, per column', () => {
    const alignmentIndex = buildFrameAlignmentIndex(['img001.png', 'img002.png']);
    const resolved = resolveCameras(
      {
        singleCam: [
          // The earlier (higher-precedence) source claims frame 0's columns.
          ['frame-metadata.txt', 'filename,depth\nimg001.png,10\n'],
          // The later source re-lists frame 0 (ignored for columns already claimed) and adds
          // frame 1.
          ['frame_metadata.csv', 'filename,depth\nimg001.png,99\nimg002.png,20\n'],
        ],
      },
      { singleCam: alignmentIndex },
    );

    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', '10']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', '20']);
    expect(resolved.sources.singleCam).toEqual(['frame-metadata.txt', 'frame_metadata.csv']);
  });

  it('fills disjoint columns from lower-precedence sources on frames a higher source claims', () => {
    // Mirrors the multicam repro: a camera-local sidecar covers every frame, and a shared
    // parent-level sidecar contributes columns the local sidecar does not define. Record-level
    // first-wins would blank the shared columns on every frame; column-level first-wins fills
    // them in.
    const alignmentIndex = buildFrameAlignmentIndex(['port001.tif', 'port002.tif']);
    const local = [
      'filename,local_depth_m,local_note',
      'port001.tif,10,a',
      'port002.tif,12,b',
      '',
    ].join('\n');
    const shared = [
      'port_image,starboard_image,vehicle_altitude_m,shared_note',
      'port001.tif,star001.tif,4.2,x',
      'port002.tif,star002.tif,4.4,y',
      '',
    ].join('\n');
    const resolved = resolveCameras(
      { left: [['left/frame_metadata.csv', local], ['frame_metadata.csv', shared]] },
      { left: alignmentIndex },
    );

    expect(resolved.columns.left).toEqual([
      'filename', 'local_depth_m', 'local_note',
      'port_image', 'starboard_image', 'vehicle_altitude_m', 'shared_note',
    ]);
    expect(resolved.cameras.left[0])
      .toEqual(['port001.tif', '10', 'a', 'port001.tif', 'star001.tif', '4.2', 'x']);
    expect(resolved.cameras.left[1])
      .toEqual(['port002.tif', '12', 'b', 'port002.tif', 'star002.tif', '4.4', 'y']);
  });

  it('keeps higher-precedence values for conflicting columns while lower sources fill the rest', () => {
    const alignmentIndex = buildFrameAlignmentIndex(['img001.png', 'img002.png']);
    const resolved = resolveCameras(
      {
        singleCam: [
          // Both sources define depth; the higher-precedence value wins on frames it covers.
          ['frame-metadata.txt', 'filename,depth\nimg001.png,10\n'],
          ['frame_metadata.csv', 'filename,depth,heading\nimg001.png,99,180\nimg002.png,20,181\n'],
        ],
      },
      { singleCam: alignmentIndex },
    );

    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', '10', '180']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', '20', '181']);
  });

  it('treats an empty-string cell in a claiming source as claimed, not overridable', () => {
    const alignmentIndex = buildFrameAlignmentIndex(['img001.png', 'img002.png']);
    const resolved = resolveCameras(
      {
        singleCam: [
          // The higher source defines depth but leaves the cell blank on frame 0.
          ['frame-metadata.txt', 'filename,depth,note\nimg001.png,,keep\n'],
          ['frame_metadata.csv', 'filename,depth\nimg001.png,99\nimg002.png,7\n'],
        ],
      },
      { singleCam: alignmentIndex },
    );

    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', '', 'keep']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', '7', '']);
  });

  it('unions columns across sources in precedence and file order', () => {
    const alignmentIndex = buildFrameAlignmentIndex(['img001.png', 'img002.png']);
    const resolved = resolveCameras(
      {
        singleCam: [
          ['frame-metadata.txt', 'filename,depth\nimg001.png,10\n'],
          ['frame_metadata.csv', 'filename,heading\nimg002.png,180\n'],
        ],
      },
      { singleCam: alignmentIndex },
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
      { left: [['frame_metadata.csv', text]], right: [['frame_metadata.csv', text]] },
      {
        left: buildFrameAlignmentIndex(['port001.tif', 'port002.tif']),
        // Reversed order so the join, not the row order, drives right's frame keys.
        right: buildFrameAlignmentIndex(['star002.tif', 'star001.tif']),
      },
    );

    expect(resolved.cameras.left[0]).toEqual(['port001.tif', '10', 'star001.tif']);
    expect(resolved.cameras.left[1]).toEqual(['port002.tif', '12', 'star002.tif']);
    // right frame 0 is star002 (its media index 0), which is the second data row.
    expect(resolved.cameras.right[0]).toEqual(['port002.tif', '12', 'star002.tif']);
    expect(resolved.cameras.right[1]).toEqual(['port001.tif', '10', 'star001.tif']);
  });

  it('tolerates duplicate media basenames when resolving (last-wins frame)', () => {
    const alignmentIndex = buildFrameAlignmentIndex(['a/img001.png', 'b/img001.png', 'img002.png']);
    const resolved = resolveCameras(
      { singleCam: [['frame_metadata.csv', 'filename,depth\nimg001.png,10\nimg002.png,12\n']] },
      { singleCam: alignmentIndex },
    );

    // img001 resolves to the last (frame 1) of its duplicate basenames.
    expect(resolved.cameras.singleCam[1]).toEqual(['img001.png', '10']);
    expect(resolved.cameras.singleCam[2]).toEqual(['img002.png', '12']);
  });

  it('keeps numeric-named header columns in file order, not JS object-key order', () => {
    // Object keys would iterate numeric-like names as ['1','2','3']; the explicit columns array
    // preserves the file order ['3','1','2'] (readtime deferred finding #8).
    const alignmentIndex = buildFrameAlignmentIndex(['img001.png', 'img002.png']);
    const text = 'filename,3,1,2\nimg001.png,c,a,b\nimg002.png,cc,aa,bb\n';
    const resolved = resolveCameras(
      { singleCam: [['frame_metadata.csv', text]] },
      { singleCam: alignmentIndex },
    );

    expect(resolved.columns.singleCam).toEqual(['filename', '3', '1', '2']);
    expect(resolved.cameras.singleCam[0]).toEqual(['img001.png', 'c', 'a', 'b']);
    expect(resolved.cameras.singleCam[1]).toEqual(['img002.png', 'cc', 'aa', 'bb']);
  });

  it('omits a camera with no matching sidecar', () => {
    const resolved = resolveCameras(
      { singleCam: [['frame_metadata.csv', 'station,depth\nA,10\n']] },
      { singleCam: buildFrameAlignmentIndex(['img001.png', 'img002.png']) },
    );

    expect(resolved.cameras.singleCam).toBeUndefined();
    expect(resolved.sources.singleCam).toBeUndefined();
    expect(resolved.columns.singleCam).toBeUndefined();
  });
});
