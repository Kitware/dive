import { pairedStartFrames } from './multiCamUtils';

describe('pairedStartFrames', () => {
  it('skips the late camera past its unpaired lead', () => {
    const result = pairedStartFrames({ EO: 100, IR: 100 }, { IR: 9 });
    expect(result?.start).toStrictEqual({ EO: 0, IR: 9 });
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
    const result = pairedStartFrames({ EO: 9000, IR: 9008 }, { IR: 9 });
    expect(result?.start).toStrictEqual({ EO: 0, IR: 9 });
    expect(result?.length).toBe(8999);
  });

  it('handles three cameras with independent offsets', () => {
    const result = pairedStartFrames({ EO: 100, IR: 100, UV: 100 }, { IR: 9, UV: -4 });
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
    const result = pairedStartFrames({ EO: 100, IR: 0 }, { IR: 9 });
    expect(result?.length).toBe(100);
  });
});
