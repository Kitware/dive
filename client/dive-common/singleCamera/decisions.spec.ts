import type { Api, DatasetConfig } from '../apispec';
import { remapCsvIds, singleCameraContext, validateAssociation } from './decisions';

describe('single camera pipeline decisions', () => {
  const config = {
    subType: 'stereo',
    multiCamMedia: { cameras: { left: {}, right: {}, third: {} }, defaultDisplay: 'left' },
  } as unknown as DatasetConfig;
  function apiFor(ids: Record<string, number[]>) {
    return {
      loadConfig: vi.fn(async () => config),
      loadDetections: vi.fn(async (id: string) => ({ tracks: (ids[id] || []).map((value) => ({ id: value })) })),
    } as unknown as Pick<Api, 'loadConfig' | 'loadDetections'>;
  }

  it('checks every other camera and resolves parent-only runs to defaultDisplay', async () => {
    const api = apiFor({ 'rig/third': [500] });
    const result = await singleCameraContext(api, 'rig');
    expect(result).toMatchObject({ datasetId: 'rig/left', hasOtherTracks: true });
    expect(api.loadDetections).toHaveBeenCalledWith('rig/right');
    expect(api.loadDetections).toHaveBeenCalledWith('rig/third');
    expect(api.loadDetections).not.toHaveBeenCalledWith('rig/left');
  });

  it('does not prompt just because the selected camera has tracks', async () => {
    const result = await singleCameraContext(apiFor({ 'rig/right': [22] }), 'rig/right');
    expect(result).toMatchObject({ datasetId: 'rig/right', hasOtherTracks: false });
  });

  it('rejects unsupported multicam, missing calibration, and disabled stereo', () => {
    expect(() => validateAssociation(false, true, true)).toThrow('not implemented');
    expect(() => validateAssociation(true, false, true)).toThrow('calibration file');
    expect(() => validateAssociation(true, true, false)).toThrow('Enable stereo');
    expect(() => validateAssociation(true, true, true)).not.toThrow();
  });

  it('moves every ID above the other cameras and preserves repeated track states', () => {
    const csv = '# comment\n2,frame,0,1,2,3,4,.8,-1\n2,frame,3,1,2,3,4,.9,-1\n0,frame,5,1,2,3,4,.7,-1\n';
    expect(remapCsvIds(csv, 999)).toBe(csv.replace(/^2,/gm, '1000,').replace(/^0,/gm, '1001,'));
  });

  it('refuses unsafe numeric IDs', () => {
    expect(() => remapCsvIds('1,frame,0,1,2,3,4,1,-1\n', Number.MAX_SAFE_INTEGER)).toThrow('integer range');
  });
});
