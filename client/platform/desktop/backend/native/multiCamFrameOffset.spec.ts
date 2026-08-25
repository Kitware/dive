import { pairedStartFrames } from './multiCamUtils';

/** A camera entry with just the field the pairing needs. */
function cam(name: string, frames: number): [string, { originalImageFiles: string[] }] {
  return [name, { originalImageFiles: new Array(frames).fill('x') }];
}

/**
 * Pipeline inputs pair positionally -- row i of one camera's list with row i
 * of every other's -- so a rig whose recorders started at different times
 * hands a two-camera detector mismatched instants unless the lists are
 * aligned first. Nothing downstream reports that; the associations are just
 * wrong. These cover the arithmetic that prevents it.
 */
describe('pairedStartFrames', () => {
  it('skips the late camera past its unpaired lead', () => {
    // IR frame 9 is the same instant as EO frame 0.
    const result = pairedStartFrames([cam('EO', 100), cam('IR', 100)], { IR: 9 });
    expect(result?.start).toStrictEqual({ EO: 0, IR: 9 });
    // IR runs out 9 frames earlier, so both stop there.
    expect(result?.length).toBe(91);
  });

  it('skips the reference instead when the other camera leads', () => {
    const result = pairedStartFrames([cam('EO', 100), cam('IR', 100)], { IR: -4 });
    expect(result?.start).toStrictEqual({ EO: 4, IR: 0 });
    expect(result?.length).toBe(96);
  });

  it('ends where the shortest camera does', () => {
    const result = pairedStartFrames([cam('EO', 100), cam('IR', 50)], { IR: 9 });
    expect(result?.start).toStrictEqual({ EO: 0, IR: 9 });
    expect(result?.length).toBe(41);
  });

  it('handles three cameras with independent offsets', () => {
    const rig = [cam('EO', 100), cam('IR', 100), cam('UV', 100)];
    const result = pairedStartFrames(rig, { IR: 9, UV: -4 });
    // UV is earliest, so every camera skips forward to UV's first paired slot.
    expect(result?.start).toStrictEqual({ EO: 4, IR: 13, UV: 0 });
    expect(result?.length).toBe(87);
  });

  it('declines when nothing is offset, keeping the untouched path', () => {
    expect(pairedStartFrames([cam('EO', 100), cam('IR', 100)], { EO: 0, IR: 0 })).toBeNull();
    expect(pairedStartFrames([cam('EO', 100), cam('IR', 100)], undefined)).toBeNull();
  });

  it('reports no paired span when an offset outruns a camera', () => {
    const result = pairedStartFrames([cam('EO', 100), cam('IR', 5)], { IR: 9 });
    expect(result?.length).toBeLessThanOrEqual(0);
  });
});
