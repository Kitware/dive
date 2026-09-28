import { displayOptions, displayValue, parseDisplayValue } from './stereoDisplay';

describe('stereoDisplay', () => {
  it('offers each stereo camera selected or beside the 3D viewer', () => {
    expect(displayOptions(['left', 'right'], true, 'left').map((option) => option.text)).toEqual([
      'Left (Selected)', 'Right (Selected)', 'Left + 3D Viewer', 'Right + 3D Viewer',
    ]);
  });

  it('lists plain cameras for other multi-camera datasets', () => {
    expect(displayOptions(['eo', 'ir'], false, 'ir')).toEqual([
      { value: 'camera:eo', text: 'eo', menuText: 'eo' },
      { value: 'camera:ir', text: 'ir', menuText: 'ir (Default)' },
    ]);
  });

  it('round-trips a display value', () => {
    expect(parseDisplayValue(displayValue('right', true))).toEqual({ camera: 'right', viewer3d: true });
    expect(parseDisplayValue(displayValue('viewer3d:odd', false)))
      .toEqual({ camera: 'viewer3d:odd', viewer3d: false });
  });
});
