import {
  getMultiCamIcon,
  getMultiCamSubType,
  getMultiCamTooltip,
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
});
