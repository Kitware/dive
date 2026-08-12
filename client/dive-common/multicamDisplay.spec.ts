import {
  getMultiCamIcon,
  getMultiCamSubType,
  getMultiCamTooltip,
  isMultiCamDatasetConfig,
  isMultiCamTrainingTarget,
  isStereoscopicDatasetConfig,
  orderedMultiCamCameraNames,
  referenceCameraName,
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
    expect(getMultiCamTooltip('stereo')).toBe('Stereo dataset');
    expect(getMultiCamTooltip('multicam')).toBe('Multi Camera dataset');
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
    expect(isMultiCamDatasetConfig({ type: 'multi', subType: 'stereo' })).toBe(true);
    expect(isMultiCamDatasetConfig({ type: 'video', subType: undefined })).toBe(false);
  });

  it('detects stereoscopic vs plain multicam datasets', () => {
    expect(isStereoscopicDatasetConfig({ type: 'multi', subType: 'stereo' })).toBe(true);
    expect(isStereoscopicDatasetConfig({ type: 'multi', subType: 'multicam' })).toBe(false);
    expect(isStereoscopicDatasetConfig({ type: 'video', subType: 'stereo' })).toBe(false);
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

describe('referenceCameraName', () => {
  const cameras = { eo: {}, ir: {}, uv: {} };

  it('uses the chosen Reference Camera (defaultDisplay)', () => {
    expect(referenceCameraName({ cameras, defaultDisplay: 'uv' })).toBe('uv');
  });

  it('falls back to the first camera in display order for an unknown choice', () => {
    expect(referenceCameraName({ cameras, defaultDisplay: 'zz' })).toBe('eo');
    expect(referenceCameraName({
      cameras, cameraOrder: ['ir', 'eo', 'uv'], defaultDisplay: 'zz',
    })).toBe('ir');
  });

  it('returns null without cameras', () => {
    expect(referenceCameraName(null)).toBeNull();
    expect(referenceCameraName({ cameras: {}, defaultDisplay: 'eo' })).toBeNull();
  });
});
