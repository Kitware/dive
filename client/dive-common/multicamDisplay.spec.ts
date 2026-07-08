import {
  getMultiCamIcon,
  getMultiCamSubType,
  getMultiCamTooltip,
  isMultiCamDatasetMeta,
  isMultiCamTrainingTarget,
  isStereoscopicDatasetMeta,
  orderedMultiCamCameraNames,
} from './multicamDisplay';

describe('multicamDisplay', () => {
  it('detects stereo and multicam datasets', () => {
    expect(getMultiCamSubType({ type: 'multi', subType: 'stereo' })).toBe('stereo');
    expect(getMultiCamSubType({ type: 'multi', subType: 'multicam' })).toBe('multicam');
    expect(getMultiCamSubType({ type: 'video', subType: 'stereo' })).toBeNull();
  });

  it('returns icons and tooltips', () => {
    expect(getMultiCamIcon('stereo')).toBe('mdi-binoculars');
    expect(getMultiCamIcon('multicam')).toBe('mdi-camera-burst');
    expect(getMultiCamTooltip('stereo')).toBe('Stereoscopic dataset');
    expect(getMultiCamTooltip('multicam')).toBe('Multicamera dataset');
  });

  it('orders cameras using cameraOrder when present', () => {
    expect(orderedMultiCamCameraNames({
      defaultDisplay: 'center',
      cameraOrder: ['port', 'star', 'center'],
      cameras: { star: {}, center: {}, port: {} },
    })).toEqual(['port', 'star', 'center']);
  });

  it('falls back to object key order when cameraOrder is missing', () => {
    expect(orderedMultiCamCameraNames({
      defaultDisplay: 'left',
      cameras: { left: {}, right: {} },
    })).toEqual(['left', 'right']);
  });

  it('falls back to EO left and IR right when cameraOrder is missing', () => {
    expect(orderedMultiCamCameraNames({
      defaultDisplay: 'EO',
      cameras: { IR: {}, UV: {}, EO: {} },
    })).toEqual(['EO', 'UV', 'IR']);
  });

  it('detects multicam dataset meta for training guards', () => {
    expect(isMultiCamDatasetMeta({ type: 'multi', subType: 'stereo' })).toBe(true);
    expect(isMultiCamDatasetMeta({ type: 'video', subType: null })).toBe(false);
  });

  it('detects stereoscopic vs plain multicam datasets', () => {
    expect(isStereoscopicDatasetMeta({ type: 'multi', subType: 'stereo' })).toBe(true);
    expect(isStereoscopicDatasetMeta({ type: 'multi', subType: 'multicam' })).toBe(false);
    expect(isStereoscopicDatasetMeta({ type: 'video', subType: 'stereo' })).toBe(false);
  });

  it('disables training for multicam parent and child camera selection', () => {
    const parent = {
      _id: 'parent-id',
      meta: { type: 'multi', subType: 'multicam' },
    };
    const left = { _id: 'left-id', parentId: 'parent-id', meta: { type: 'video' } };
    expect(isMultiCamTrainingTarget([parent], null)).toBe(true);
    expect(isMultiCamTrainingTarget([], parent)).toBe(true);
    expect(isMultiCamTrainingTarget([left], parent)).toBe(true);
    expect(isMultiCamTrainingTarget([{ meta: { type: 'video' }, parentId: 'other' }], parent)).toBe(false);
  });
});
