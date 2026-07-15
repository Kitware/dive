import {
  detectFolderModalities,
  groupByModality,
  isViewFolderName,
  modalityGlob,
  parseModalitySuffix,
  viewFolderDatasetName,
} from 'dive-common/viewFolderFormat';

const RGB1 = 'fl09_C_20240612_204107.625730_rgb.jpg';
const RGB2 = 'fl09_C_20240612_204108.612704_rgb.jpg';
const IR1 = 'fl09_C_20240612_204107.625730_ir.tif';
const UV1 = 'fl09_C_20240612_204107.625730_uv.jpg';

describe('parseModalitySuffix', () => {
  it('parses each modality suffix case-insensitively', () => {
    expect(parseModalitySuffix(RGB1)).toBe('rgb');
    expect(parseModalitySuffix(IR1)).toBe('ir');
    expect(parseModalitySuffix(UV1)).toBe('uv');
    expect(parseModalitySuffix('FL09_20240612_204107_RGB.JPG')).toBe('rgb');
  });

  it('returns null when the suffix is absent or not final', () => {
    expect(parseModalitySuffix('frame_000001.jpg')).toBeNull();
    expect(parseModalitySuffix('metadata.json')).toBeNull();
    expect(parseModalitySuffix('fl09_rgb_20240612_204107.jpg')).toBeNull();
  });
});

describe('detectFolderModalities', () => {
  it('detects all modalities present, in canonical order', () => {
    expect(detectFolderModalities([UV1, IR1, RGB1, RGB2])).toEqual(['rgb', 'ir', 'uv']);
    expect(detectFolderModalities([IR1, RGB1])).toEqual(['rgb', 'ir']);
    expect(detectFolderModalities([RGB1, RGB2])).toEqual(['rgb']);
  });

  it('rejects lists with any non-conforming image', () => {
    expect(detectFolderModalities([])).toEqual([]);
    expect(detectFolderModalities([RGB1, 'frame_000001.jpg'])).toEqual([]);
    // modality suffix but no parseable capture timestamp
    expect(detectFolderModalities(['sample_rgb.jpg'])).toEqual([]);
  });
});

describe('groupByModality', () => {
  it('groups image names by modality and drops unsuffixed names', () => {
    const groups = groupByModality([RGB1, RGB2, IR1, 'notes.jpg']);
    expect(groups.get('rgb')).toEqual([RGB1, RGB2]);
    expect(groups.get('ir')).toEqual([IR1]);
    expect(groups.has('uv')).toBe(false);
  });
});

describe('modalityGlob', () => {
  it('builds a suffix glob per modality', () => {
    expect(modalityGlob('rgb')).toBe('*_rgb.*');
    expect(modalityGlob('ir')).toBe('*_ir.*');
  });
});

describe('isViewFolderName', () => {
  it('matches the *_view folder names', () => {
    expect(isViewFolderName('left_view')).toBe(true);
    expect(isViewFolderName('CENTER_VIEW')).toBe(true);
    expect(isViewFolderName('right_view')).toBe(true);
  });

  it('matches port/center/starboard abbreviations', () => {
    expect(isViewFolderName('PORT')).toBe(true);
    expect(isViewFolderName('CENT')).toBe(true);
    expect(isViewFolderName('STBD')).toBe(true);
    expect(isViewFolderName('starboard')).toBe(true);
  });

  it('rejects other folder names', () => {
    expect(isViewFolderName('side_view')).toBe(false);
    expect(isViewFolderName('left')).toBe(false);
    expect(isViewFolderName('center')).toBe(false);
  });
});

describe('viewFolderDatasetName', () => {
  it('prefixes the parent folder for view-named folders', () => {
    expect(viewFolderDatasetName('/data/fl09/left_view')).toBe('fl09_left_view');
    expect(viewFolderDatasetName('C:\\data\\fl09\\center_view')).toBe('fl09_center_view');
    expect(viewFolderDatasetName('/data/fl09/CENT')).toBe('fl09_CENT');
  });

  it('uses the folder name alone otherwise', () => {
    expect(viewFolderDatasetName('/data/fl09/somefolder')).toBe('somefolder');
    expect(viewFolderDatasetName('left_view')).toBe('left_view');
  });
});
