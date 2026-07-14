// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import { describe, expect, it } from 'vitest';

import {
  applyParentPathToAssignments,
  filterSubfolderGroupsWithMedia,
  groupFilesByImmediateSubfolder,
  groupParentFolderByCamera,
  groupRootLevelVideoFiles,
  inferSubfolderImportType,
  isEoSubfolderName,
  isImageFileName,
  isMediaFileName,
  isValidCameraName,
  isVideoFileName,
  organizeSubfolderCameras,
  orderSubfolderCameraNames,
  parentFolderLabelFromAbsolutePaths,
  rootLevelImageFiles,
  preferEoIrSubfolderOrder,
  preferEoSubfolderFirst,
  preferLeftSubfolderFirst,
  pickDefaultMulticamCamera,
  sortSubfolderCameraNames,
  subfolderVideoDisplayLabel,
} from './multicamSubfolderLayout';

describe('isValidCameraName', () => {
  it('accepts alphanumeric names and underscores', () => {
    expect(isValidCameraName('cam1')).toBe(true);
    expect(isValidCameraName('LeftCam')).toBe(true);
    expect(isValidCameraName('2021_EO_SHORT')).toBe(true);
  });

  it('rejects spaces and punctuation other than underscore', () => {
    expect(isValidCameraName('Port Cam')).toBe(false);
    expect(isValidCameraName('cam-1')).toBe(false);
  });
});

describe('applyParentPathToAssignments', () => {
  it('joins parent path with each subfolder name', () => {
    const organized = organizeSubfolderCameras(['PORT', 'STAR']);
    expect(organized.error).toBeNull();
    const resolved = applyParentPathToAssignments('/data/MyDataset', organized.assignments);
    expect(resolved).toEqual([
      { cameraName: 'PORT', folderName: 'PORT', sourcePath: '/data/MyDataset/PORT' },
      { cameraName: 'STAR', folderName: 'STAR', sourcePath: '/data/MyDataset/STAR' },
    ]);
  });

  it('uses backslashes on Windows-style paths', () => {
    const organized = organizeSubfolderCameras(['left', 'right']);
    const resolved = applyParentPathToAssignments('C:\\datasets\\stereo', organized.assignments);
    expect(resolved[0].sourcePath).toBe('C:\\datasets\\stereo\\left');
    expect(resolved[1].sourcePath).toBe('C:\\datasets\\stereo\\right');
  });
});

describe('parentFolderLabelFromAbsolutePaths', () => {
  it('returns the shared parent folder name for sibling camera paths', () => {
    expect(parentFolderLabelFromAbsolutePaths([
      '/data/my_scene/left',
      '/data/my_scene/right',
    ])).toBe('my_scene');
  });

  it('handles Windows-style paths', () => {
    expect(parentFolderLabelFromAbsolutePaths([
      'C:\\datasets\\stereo\\left',
      'C:\\datasets\\stereo\\right',
    ])).toBe('stereo');
  });

  it('returns empty when no paths are provided', () => {
    expect(parentFolderLabelFromAbsolutePaths([])).toBe('');
    expect(parentFolderLabelFromAbsolutePaths(['', '   '])).toBe('');
  });
});

describe('pickDefaultMulticamCamera', () => {
  it('prefers center or middle by name', () => {
    expect(pickDefaultMulticamCamera(['STAR', 'CENTER', 'PORT'])).toBe('CENTER');
    expect(pickDefaultMulticamCamera(['left', 'Middle', 'right'])).toBe('Middle');
    expect(pickDefaultMulticamCamera(['cam1', 'center', 'cam3'])).toBe('center');
  });

  it('uses the middle camera when no center or middle name exists', () => {
    expect(pickDefaultMulticamCamera(['cam1', 'cam2', 'cam3'])).toBe('cam2');
    expect(pickDefaultMulticamCamera(['left', 'right'])).toBe('left');
  });

  it('prefers left for stereo when no center or middle name exists', () => {
    expect(pickDefaultMulticamCamera(['LeftCam', 'RightCam'], { preferLeftForStereo: true })).toBe('LeftCam');
    expect(pickDefaultMulticamCamera(['left', 'right'], { preferLeftForStereo: true })).toBe('left');
  });
});

describe('organizeSubfolderCameras', () => {
  it('creates one camera per subfolder using folder names', () => {
    const result = organizeSubfolderCameras(['Port', 'CENTER', 'Starboard']);
    expect(result.error).toBeNull();
    expect(result.layoutLabel).toBe('Port, CENTER, Starboard');
    expect(result.assignments).toEqual([
      { cameraName: 'Port', folderName: 'Port', sourcePath: 'Port' },
      { cameraName: 'CENTER', folderName: 'CENTER', sourcePath: 'CENTER' },
      { cameraName: 'Starboard', folderName: 'Starboard', sourcePath: 'Starboard' },
    ]);
    expect(result.defaultDisplay).toBe('CENTER');
  });

  it('orders STAR, CENTER, PORT first when present', () => {
    const result = organizeSubfolderCameras(['PORT', 'STAR', 'CENTER']);
    expect(result.error).toBeNull();
    expect(result.assignments.map((a) => a.cameraName)).toEqual(['STAR', 'CENTER', 'PORT']);
    expect(result.layoutLabel).toBe('STAR, CENTER, PORT');
    expect(result.defaultDisplay).toBe('CENTER');
  });

  it('accepts arbitrary valid folder names', () => {
    const result = organizeSubfolderCameras(['cam1', 'cam2', 'cam3']);
    expect(result.error).toBeNull();
    expect(result.assignments.map((a) => a.cameraName)).toEqual(['cam1', 'cam2', 'cam3']);
    expect(result.defaultDisplay).toBe('cam2');
  });

  it('maps stereo folders by name', () => {
    const result = organizeSubfolderCameras(['LeftCam', 'RightCam']);
    expect(result.error).toBeNull();
    expect(result.assignments.map((a) => a.cameraName)).toEqual(['LeftCam', 'RightCam']);
    expect(result.defaultDisplay).toBe('LeftCam');
  });

  it('orders left before right for stereo parent-folder import', () => {
    const result = organizeSubfolderCameras(['right', 'left'], { preferLeftForStereo: true });
    expect(result.error).toBeNull();
    expect(result.assignments.map((a) => a.cameraName)).toEqual(['left', 'right']);
    expect(result.layoutLabel).toBe('left, right');
    expect(result.defaultDisplay).toBe('left');
  });

  it('rejects invalid folder names', () => {
    const result = organizeSubfolderCameras(['good', 'bad name']);
    expect(result.error).toMatch(/letters, numbers, and underscores only/);
  });

  it('accepts folder names with underscores', () => {
    const result = organizeSubfolderCameras(['2021_EO_SHORT', '2021_IR_SHORT']);
    expect(result.error).toBeNull();
    expect(result.assignments.map((a) => a.cameraName)).toEqual(['2021_EO_SHORT', '2021_IR_SHORT']);
  });

  it('rejects duplicate folder names', () => {
    const result = organizeSubfolderCameras(['cam1', 'cam1']);
    expect(result.error).toMatch(/Duplicate/);
  });

  it('rejects wrong folder count', () => {
    expect(organizeSubfolderCameras(['only']).error).toMatch(/Expected 2 or 3 cameras/);
    expect(organizeSubfolderCameras(['a', 'b', 'c', 'd']).error).toMatch(/Expected 2 or 3 cameras/);
  });
});

describe('isVideoFileName', () => {
  it('recognizes common video extensions', () => {
    expect(isVideoFileName('left.mp4')).toBe(true);
    expect(isVideoFileName('right.MOV')).toBe(true);
    expect(isVideoFileName('notes.txt')).toBe(false);
  });
});

describe('subfolderVideoDisplayLabel', () => {
  const mk = (name: string) => ({ name } as File);

  it('uses the video file name when only the stem is known on web', () => {
    expect(subfolderVideoDisplayLabel('left', 'left', [mk('left.mp4')])).toBe('left.mp4');
    expect(subfolderVideoDisplayLabel('right', 'right', [mk('right.mov')])).toBe('right.mov');
  });

  it('uses the path basename when it includes a video extension', () => {
    expect(subfolderVideoDisplayLabel('/data/stereo/left.mp4', 'left', [])).toBe('left.mp4');
  });

  it('falls back to folder name when no video file is available', () => {
    expect(subfolderVideoDisplayLabel('left', 'left', [])).toBe('left');
  });
});

describe('groupRootLevelVideoFiles', () => {
  const mk = (path: string) => ({ webkitRelativePath: path, name: path.split('/').pop() } as File);

  it('groups videos directly under the parent folder by file stem', () => {
    const groups = groupRootLevelVideoFiles([
      mk('stereo/left.mp4'),
      mk('stereo/right.mp4'),
      mk('stereo/readme.txt'),
    ], 'stereo');
    expect([...groups.keys()].sort()).toEqual(['left', 'right']);
    expect(groups.get('left')?.length).toBe(1);
    expect(groups.get('right')?.length).toBe(1);
  });
});

describe('rootLevelImageFiles', () => {
  const mk = (path: string) => ({ webkitRelativePath: path, name: path.split('/').pop() } as File);

  it('keeps images directly under the parent folder and skips subfolders and non-images', () => {
    const files = rootLevelImageFiles([
      mk('left_view/fl09_20240612_204107.625730_rgb.jpg'),
      mk('left_view/fl09_20240612_204107.625730_ir.tif'),
      mk('left_view/metadata.json'),
      mk('left_view/thumbs/preview.jpg'),
    ], 'left_view');
    expect(files.map((file) => file.name)).toEqual([
      'fl09_20240612_204107.625730_rgb.jpg',
      'fl09_20240612_204107.625730_ir.tif',
    ]);
  });
});

describe('isImageFileName', () => {
  it('recognizes common image extensions', () => {
    expect(isImageFileName('frame.jpg')).toBe(true);
    expect(isImageFileName('frame.tif')).toBe(true);
    expect(isImageFileName('notes.txt')).toBe(false);
  });
});

describe('isMediaFileName', () => {
  it('selects image or video extensions based on media type', () => {
    expect(isMediaFileName('frame.jpg', 'image-sequence')).toBe(true);
    expect(isMediaFileName('clip.mp4', 'video')).toBe(true);
    expect(isMediaFileName('clip.mp4', 'image-sequence')).toBe(false);
    expect(isMediaFileName('transform.h5', 'image-sequence')).toBe(false);
  });
});

describe('filterSubfolderGroupsWithMedia', () => {
  const mk = (path: string) => ({ webkitRelativePath: path, name: path.split('/').pop() } as File);

  it('drops subfolders that only contain non-media files', () => {
    const groups = groupFilesByImmediateSubfolder([
      mk('example_seal_data/2021_EO_SHORT/a.jpg'),
      mk('example_seal_data/2021_IR_SHORT/a.tif'),
      mk('example_seal_data/transformations/Kotz.h5'),
    ], 'example_seal_data');
    const filtered = filterSubfolderGroupsWithMedia(groups, 'image-sequence');
    expect([...filtered.keys()].sort()).toEqual(['2021_EO_SHORT', '2021_IR_SHORT']);
  });
});

describe('groupParentFolderByCamera', () => {
  const mk = (path: string) => ({ webkitRelativePath: path, name: path.split('/').pop() } as File);

  it('prefers subfolders when at least two exist', () => {
    const groups = groupParentFolderByCamera([
      mk('set/left/a.mp4'),
      mk('set/right/b.mp4'),
      mk('set/left_cam.mp4'),
    ], { allowRootLevelVideos: true, mediaType: 'video' }, 'set');
    expect([...groups.keys()].sort()).toEqual(['left', 'right']);
  });

  it('falls back to root-level videos when there are no subfolders', () => {
    const groups = groupParentFolderByCamera([
      mk('stereo/left.mp4'),
      mk('stereo/right.mp4'),
    ], { allowRootLevelVideos: true }, 'stereo');
    expect([...groups.keys()].sort()).toEqual(['left', 'right']);
    const organized = organizeSubfolderCameras([...groups.keys()], { preferLeftForStereo: true });
    expect(organized.error).toBeNull();
    expect(organized.assignments.map((a) => a.cameraName)).toEqual(['left', 'right']);
  });

  it('does not use root-level videos when subfolder import is disabled', () => {
    const groups = groupParentFolderByCamera([
      mk('stereo/left.mp4'),
      mk('stereo/right.mp4'),
    ], undefined, 'stereo');
    expect(groups.size).toBe(0);
  });

  it('ignores non-media subfolders when discovering cameras', () => {
    const groups = groupParentFolderByCamera([
      mk('example_seal_data/2021_EO_SHORT/a.jpg'),
      mk('example_seal_data/2021_IR_SHORT/a.tif'),
      mk('example_seal_data/transformations/Kotz.h5'),
    ], { mediaType: 'image-sequence' }, 'example_seal_data');
    expect([...groups.keys()].sort()).toEqual(['2021_EO_SHORT', '2021_IR_SHORT']);
    const organized = organizeSubfolderCameras([...groups.keys()]);
    expect(organized.error).toBeNull();
    expect(organized.assignments.map((a) => a.cameraName)).toEqual(['2021_EO_SHORT', '2021_IR_SHORT']);
  });
});

describe('groupFilesByImmediateSubfolder', () => {
  const mk = (path: string) => ({ webkitRelativePath: path, name: path.split('/').pop() } as File);

  it('groups by first path segment after explicit root', () => {
    const groups = groupFilesByImmediateSubfolder([
      mk('dataset/port/a.png'),
      mk('dataset/port/b.png'),
      mk('dataset/starboard/c.png'),
    ], 'dataset');
    expect(groups.get('port')?.length).toBe(2);
    expect(groups.get('starboard')?.length).toBe(1);
  });

  it('infers parent prefix when root is omitted (STAR, CENTER, PORT)', () => {
    const groups = groupFilesByImmediateSubfolder([
      mk('MyDataset/PORT/a.png'),
      mk('MyDataset/CENTER/b.png'),
      mk('MyDataset/STAR/c.png'),
    ]);
    expect([...groups.keys()].sort()).toEqual(['CENTER', 'PORT', 'STAR']);
    expect(groups.get('PORT')?.length).toBe(1);
    expect(groups.get('CENTER')?.length).toBe(1);
    expect(groups.get('STAR')?.length).toBe(1);
  });

  it('groups UGAMAK_short layout (CENTER, PORT, STAR)', () => {
    const groups = groupFilesByImmediateSubfolder([
      mk('UGAMAK_short/CENTER/2018_UGAMAK_NORTH_SSLC0200.JPG'),
      mk('UGAMAK_short/PORT/2018_UGAMAK_NORTH_SSLC0200.JPG'),
      mk('UGAMAK_short/STAR/2018_UGAMAK_NORTH_SSLC0200.JPG'),
    ]);
    expect([...groups.keys()].sort()).toEqual(['CENTER', 'PORT', 'STAR']);
    const organized = organizeSubfolderCameras([...groups.keys()]);
    expect(organized.error).toBeNull();
    expect(organized.assignments.map((a) => a.cameraName)).toEqual(['STAR', 'CENTER', 'PORT']);
  });

  it('preserves camera folder name casing', () => {
    const groups = groupFilesByImmediateSubfolder([
      mk('set/PORT/a.png'),
      mk('set/Center/b.png'),
    ]);
    expect([...groups.keys()].sort()).toEqual(['Center', 'PORT']);
  });
});

describe('sortSubfolderCameraNames', () => {
  it('sorts STAR, CENTER, PORT', () => {
    expect(sortSubfolderCameraNames(['PORT', 'CENTER', 'STAR'])).toEqual(['STAR', 'CENTER', 'PORT']);
  });
});

describe('preferEoIrSubfolderOrder', () => {
  it('moves EO-named folders left and IR-named folders right', () => {
    expect(preferEoIrSubfolderOrder(['2021_IR_SHORT', '2021_EO_SHORT'])).toEqual([
      '2021_EO_SHORT',
      '2021_IR_SHORT',
    ]);
    expect(preferEoIrSubfolderOrder(['IR', 'UV', 'EO'])).toEqual(['EO', 'UV', 'IR']);
  });

  it('leaves order unchanged when EO is already first and IR is already last', () => {
    expect(preferEoIrSubfolderOrder(['2021_EO_SHORT', '2021_IR_SHORT'])).toEqual([
      '2021_EO_SHORT',
      '2021_IR_SHORT',
    ]);
    expect(preferEoIrSubfolderOrder(['EO', 'UV', 'IR'])).toEqual(['EO', 'UV', 'IR']);
  });
});

describe('preferEoSubfolderFirst', () => {
  it('delegates to preferEoIrSubfolderOrder', () => {
    expect(preferEoSubfolderFirst(['IR', 'UV', 'EO'])).toEqual(['EO', 'UV', 'IR']);
  });
});

describe('pickDefaultMulticamCamera EO/IR', () => {
  it('prefers EO as default display when present', () => {
    expect(pickDefaultMulticamCamera(['2021_IR_SHORT', '2021_EO_SHORT'])).toBe('2021_EO_SHORT');
  });
});

describe('inferSubfolderImportType', () => {
  const mk = (name: string) => ({ name } as File);

  it('uses large-image for all-TIFF subfolders on web', () => {
    expect(inferSubfolderImportType([
      mk('a.tif'),
      mk('b.tiff'),
    ], { largeImageForTiff: true })).toBe('large-image');
  });

  it('keeps image-sequence for mixed or JPG folders', () => {
    expect(inferSubfolderImportType([
      mk('a.jpg'),
      mk('b.jpg'),
    ], { largeImageForTiff: true })).toBe('image-sequence');
    expect(inferSubfolderImportType([
      mk('a.tif'),
      mk('b.jpg'),
    ], { largeImageForTiff: true })).toBe('image-sequence');
  });
});

describe('organizeSubfolderCameras seal example', () => {
  it('orders EO before IR and picks EO as default', () => {
    const result = organizeSubfolderCameras(['2021_IR_SHORT', '2021_EO_SHORT']);
    expect(result.error).toBeNull();
    expect(result.assignments.map((a) => a.cameraName)).toEqual(['2021_EO_SHORT', '2021_IR_SHORT']);
    expect(result.defaultDisplay).toBe('2021_EO_SHORT');
    expect(isEoSubfolderName(result.defaultDisplay)).toBe(true);
  });
});

describe('preferLeftSubfolderFirst', () => {
  it('moves an exact "left" folder to the front', () => {
    expect(preferLeftSubfolderFirst(['right', 'left'])).toEqual(['left', 'right']);
    expect(preferLeftSubfolderFirst(['RIGHT', 'LEFT'])).toEqual(['LEFT', 'RIGHT']);
  });

  it('leaves order unchanged when left is already first or absent', () => {
    expect(preferLeftSubfolderFirst(['left', 'right'])).toEqual(['left', 'right']);
    expect(preferLeftSubfolderFirst(['cam1', 'cam2'])).toEqual(['cam1', 'cam2']);
    expect(preferLeftSubfolderFirst(['LeftCam', 'RightCam'])).toEqual(['LeftCam', 'RightCam']);
  });
});

describe('orderSubfolderCameraNames', () => {
  it('preserves discovery order for arbitrary names', () => {
    expect(orderSubfolderCameraNames(['right', 'left'])).toEqual(['right', 'left']);
  });

  it('puts left first for stereo parent-folder import', () => {
    expect(orderSubfolderCameraNames(['right', 'left'], { preferLeftFirst: true })).toEqual(['left', 'right']);
    expect(orderSubfolderCameraNames(['RIGHT', 'LEFT'], { preferLeftFirst: true })).toEqual(['LEFT', 'RIGHT']);
  });

  it('uses preferred order when STAR, CENTER, and PORT are all present', () => {
    expect(orderSubfolderCameraNames(['PORT', 'CENTER', 'STAR'])).toEqual(['STAR', 'CENTER', 'PORT']);
  });

  it('orders EO left and IR right when those tokens appear in folder names', () => {
    expect(orderSubfolderCameraNames(['IR', 'UV', 'EO'])).toEqual(['EO', 'UV', 'IR']);
  });
});

describe('organizeSubfolderCameras case', () => {
  it('treats STAR, CENTER, PORT as distinct cameras', () => {
    const result = organizeSubfolderCameras(['STAR', 'CENTER', 'PORT']);
    expect(result.error).toBeNull();
    expect(result.assignments.map((a) => a.cameraName)).toEqual(['STAR', 'CENTER', 'PORT']);
    expect(result.defaultDisplay).toBe('CENTER');
  });

  it('flags case-only duplicates', () => {
    const result = organizeSubfolderCameras(['STAR', 'star']);
    expect(result.error).toMatch(/Duplicate/);
  });
});
