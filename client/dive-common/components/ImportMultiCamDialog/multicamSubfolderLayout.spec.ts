// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import { describe, expect, it } from 'vitest';

import {
  applyParentPathToAssignments,
  groupFilesByImmediateSubfolder,
  groupParentFolderByCamera,
  groupRootLevelVideoFiles,
  isValidCameraName,
  isVideoFileName,
  organizeSubfolderCameras,
  orderSubfolderCameraNames,
  preferLeftSubfolderFirst,
  pickDefaultMulticamCamera,
  sortSubfolderCameraNames,
} from './multicamSubfolderLayout';

describe('isValidCameraName', () => {
  it('accepts alphanumeric names', () => {
    expect(isValidCameraName('cam1')).toBe(true);
    expect(isValidCameraName('LeftCam')).toBe(true);
  });

  it('rejects spaces and punctuation', () => {
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
    expect(result.error).toMatch(/letters and numbers only/);
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

describe('groupParentFolderByCamera', () => {
  const mk = (path: string) => ({ webkitRelativePath: path, name: path.split('/').pop() } as File);

  it('prefers subfolders when at least two exist', () => {
    const groups = groupParentFolderByCamera([
      mk('set/left/a.mp4'),
      mk('set/right/b.mp4'),
      mk('set/left_cam.mp4'),
    ], 'set', { allowRootLevelVideos: true });
    expect([...groups.keys()].sort()).toEqual(['left', 'right']);
  });

  it('falls back to root-level videos when there are no subfolders', () => {
    const groups = groupParentFolderByCamera([
      mk('stereo/left.mp4'),
      mk('stereo/right.mp4'),
    ], 'stereo', { allowRootLevelVideos: true });
    expect([...groups.keys()].sort()).toEqual(['left', 'right']);
    const organized = organizeSubfolderCameras([...groups.keys()], { preferLeftForStereo: true });
    expect(organized.error).toBeNull();
    expect(organized.assignments.map((a) => a.cameraName)).toEqual(['left', 'right']);
  });

  it('does not use root-level videos when subfolder import is disabled', () => {
    const groups = groupParentFolderByCamera([
      mk('stereo/left.mp4'),
      mk('stereo/right.mp4'),
    ], 'stereo');
    expect(groups.size).toBe(0);
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
