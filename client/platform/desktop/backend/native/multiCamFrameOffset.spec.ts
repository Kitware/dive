import { pairedStartFrames } from './multiCamUtils';

/**
 * Pipeline inputs pair positionally -- row i of one camera's list with row i
 * of every other's -- so a rig whose recorders started at different times
 * hands a two-camera detector mismatched instants unless the inputs are
 * aligned first. Nothing downstream reports that; the associations are just
 * wrong. These cover the arithmetic that prevents it.
 *
 * Frame counts arrive already resolved (an image sequence knows its own, a
 * video is probed), so this works the same for either medium -- which is the
 * point: an all-video rig is exactly the case that needs it.
 */
describe('pairedStartFrames', () => {
  it('skips the late camera past its unpaired lead', () => {
    // IR frame 9 is the same instant as EO frame 0.
    const result = pairedStartFrames({ EO: 100, IR: 100 }, { IR: 9 });
    expect(result?.start).toStrictEqual({ EO: 0, IR: 9 });
    // IR runs out 9 frames earlier, so both stop there.
    expect(result?.length).toBe(91);
  });

  it('skips the reference instead when the other camera leads', () => {
    const result = pairedStartFrames({ EO: 100, IR: 100 }, { IR: -4 });
    expect(result?.start).toStrictEqual({ EO: 4, IR: 0 });
    expect(result?.length).toBe(96);
  });

  it('ends where the shortest camera does', () => {
    const result = pairedStartFrames({ EO: 100, IR: 50 }, { IR: 9 });
    expect(result?.start).toStrictEqual({ EO: 0, IR: 9 });
    expect(result?.length).toBe(41);
  });

  it('bounds a pair of unequal-length videos to their common span', () => {
    // The case that desynchronized the warp pipeline at teardown: one input
    // ran on after the other had completed.
    const result = pairedStartFrames({ EO: 9000, IR: 9008 }, { IR: 9 });
    expect(result?.start).toStrictEqual({ EO: 0, IR: 9 });
    // IR contributes 8999 frames from index 9; EO has 9000 from index 0.
    expect(result?.length).toBe(8999);
  });

  it('handles three cameras with independent offsets', () => {
    const result = pairedStartFrames({ EO: 100, IR: 100, UV: 100 }, { IR: 9, UV: -4 });
    // UV is earliest, so every camera skips forward to UV's first paired slot.
    expect(result?.start).toStrictEqual({ EO: 4, IR: 13, UV: 0 });
    expect(result?.length).toBe(87);
  });

  it('declines when nothing is offset, keeping the untouched path', () => {
    expect(pairedStartFrames({ EO: 100, IR: 100 }, { EO: 0, IR: 0 })).toBeNull();
    expect(pairedStartFrames({ EO: 100, IR: 100 }, undefined)).toBeNull();
  });

  it('reports no paired span when an offset outruns a camera', () => {
    const result = pairedStartFrames({ EO: 100, IR: 5 }, { IR: 9 });
    expect(result?.length).toBeLessThanOrEqual(0);
  });

  it('ignores a camera whose count could not be resolved', () => {
    // A probe that fails yields 0; that camera must not drag the span to
    // nothing and abort a run the other cameras could still support.
    const result = pairedStartFrames({ EO: 100, IR: 0 }, { IR: 9 });
    expect(result?.length).toBe(100);
  });
});
