import {
  detectKameraModalities,
  groupKameraModalities,
  isKameraViewFolderName,
  kameraDatasetName,
  kameraModalityGlob,
  parseKameraModality,
} from 'dive-common/kameraFormat';

const RGB1 = 'kamera_calibration_fl09_C_20240612_204107.625730_rgb.jpg';
const RGB2 = 'kamera_calibration_fl09_C_20240612_204108.612704_rgb.jpg';
const IR1 = 'kamera_calibration_fl09_C_20240612_204107.625730_ir.tif';
const UV1 = 'kamera_calibration_fl09_C_20240612_204107.625730_uv.jpg';

describe('parseKameraModality', () => {
  it('parses each modality suffix case-insensitively', () => {
    expect(parseKameraModality(RGB1)).toBe('rgb');
    expect(parseKameraModality(IR1)).toBe('ir');
    expect(parseKameraModality(UV1)).toBe('uv');
    expect(parseKameraModality('FL09_20240612_204107_RGB.JPG')).toBe('rgb');
  });

  it('returns null when the suffix is absent or not final', () => {
    expect(parseKameraModality('frame_000001.jpg')).toBeNull();
    expect(parseKameraModality('metadata.json')).toBeNull();
    expect(parseKameraModality('kamera_rgb_20240612_204107.jpg')).toBeNull();
  });
});

describe('detectKameraModalities', () => {
  it('detects all modalities present, in canonical order', () => {
    expect(detectKameraModalities([UV1, IR1, RGB1, RGB2])).toEqual(['rgb', 'ir', 'uv']);
    expect(detectKameraModalities([IR1, RGB1])).toEqual(['rgb', 'ir']);
    expect(detectKameraModalities([RGB1, RGB2])).toEqual(['rgb']);
  });

  it('rejects lists with any non-KAMERA image', () => {
    expect(detectKameraModalities([])).toEqual([]);
    expect(detectKameraModalities([RGB1, 'frame_000001.jpg'])).toEqual([]);
    // modality suffix but no parseable capture timestamp
    expect(detectKameraModalities(['sample_rgb.jpg'])).toEqual([]);
  });
});

describe('groupKameraModalities', () => {
  it('groups image names by modality and drops unsuffixed names', () => {
    const groups = groupKameraModalities([RGB1, RGB2, IR1, 'notes.jpg']);
    expect(groups.get('rgb')).toEqual([RGB1, RGB2]);
    expect(groups.get('ir')).toEqual([IR1]);
    expect(groups.has('uv')).toBe(false);
  });
});

describe('kameraModalityGlob', () => {
  it('builds a suffix glob per modality', () => {
    expect(kameraModalityGlob('rgb')).toBe('*_rgb.*');
    expect(kameraModalityGlob('ir')).toBe('*_ir.*');
  });
});

describe('isKameraViewFolderName', () => {
  it('matches the three view folder names only', () => {
    expect(isKameraViewFolderName('left_view')).toBe(true);
    expect(isKameraViewFolderName('CENTER_VIEW')).toBe(true);
    expect(isKameraViewFolderName('right_view')).toBe(true);
    expect(isKameraViewFolderName('side_view')).toBe(false);
    expect(isKameraViewFolderName('left')).toBe(false);
  });
});

describe('kameraDatasetName', () => {
  it('prefixes the flight folder for view-named folders', () => {
    expect(kameraDatasetName('/data/fl09/left_view')).toBe('fl09_left_view');
    expect(kameraDatasetName('C:\\data\\fl09\\center_view')).toBe('fl09_center_view');
  });

  it('uses the folder name alone otherwise', () => {
    expect(kameraDatasetName('/data/fl09/somefolder')).toBe('somefolder');
    expect(kameraDatasetName('left_view')).toBe('left_view');
  });
});
