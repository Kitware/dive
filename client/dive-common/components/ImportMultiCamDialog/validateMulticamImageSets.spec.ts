import { validateMulticamImageSets } from 'dive-common/components/ImportMultiCamDialog/validateMulticamImageSets';

describe('validateMulticamImageSets', () => {
  it('requires at least one glob pattern in keyword mode', () => {
    expect(validateMulticamImageSets('keyword', {}, 0, 'image-sequence')).toBe(
      'Add at least 1 filter pattern',
    );
  });

  it('skips image checks for video', () => {
    expect(validateMulticamImageSets('multi', { cam: [] }, 1, 'video')).toBeNull();
  });

  it('requires non-empty filtered images per camera', () => {
    expect(validateMulticamImageSets('multi', { left: [], right: ['a.png'] }, 0, 'image-sequence')).toBe(
      'Requires filtered Images for left ',
    );
  });

  it('requires equal image counts across cameras', () => {
    expect(validateMulticamImageSets(
      'multi',
      { left: ['a.png'], right: ['a.png', 'b.png'] },
      0,
      'image-sequence',
    )).toBe('All cameras should have the same length of 1');
  });

  it('allows unequal image counts when inferring frame index from filename', () => {
    expect(validateMulticamImageSets(
      'multi',
      { left: ['a.png'], right: ['a.png', 'b.png'] },
      0,
      'image-sequence',
      true,
    )).toBeNull();
  });

  it('still requires non-empty cameras when inferring frame index from filename', () => {
    expect(validateMulticamImageSets(
      'multi',
      { left: [], right: ['a.png'] },
      0,
      'image-sequence',
      true,
    )).toBe('Requires filtered Images for left ');
  });

  it('rejects overlapping filenames in keyword mode', () => {
    expect(validateMulticamImageSets(
      'keyword',
      { left: ['frame.png'], right: ['frame.png'] },
      2,
      'image-sequence',
    )).toBe('Overlapping values.  All cameras must consist of mutually exclusive images.');
  });
});
