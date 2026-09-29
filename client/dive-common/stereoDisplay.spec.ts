import { displayOptions, displayValue, parseDisplayValue } from './stereoDisplay';

describe('stereoDisplay', () => {
  it('offers each stereo camera selected, beside the 3D viewer, or with it as a third pane', () => {
    expect(displayOptions(['left', 'right'], true, 'left').map((option) => option.text)).toEqual([
      'Stereo (Left)', 'Stereo (Right)',
      'Left + 3D', 'Right + 3D',
      'Stereo (Left) + 3D', 'Stereo (Right) + 3D',
    ]);
  });

  it('lists plain cameras for other multi-camera datasets', () => {
    expect(displayOptions(['eo', 'ir'], false, 'ir')).toEqual([
      { value: 'camera:eo', text: 'eo', menuText: 'eo' },
      { value: 'camera:ir', text: 'ir', menuText: 'ir (Default)' },
    ]);
  });

  it('round-trips a display value', () => {
    expect(parseDisplayValue(displayValue('right', 'replace'))).toEqual({ camera: 'right', mode: 'replace' });
    expect(parseDisplayValue(displayValue('left', 'beside'))).toEqual({ camera: 'left', mode: 'beside' });
    expect(parseDisplayValue(displayValue('viewer3d:odd', 'off')))
      .toEqual({ camera: 'viewer3d:odd', mode: 'off' });
  });
});
