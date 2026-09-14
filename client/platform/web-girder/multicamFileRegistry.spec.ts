import {
  describe, expect, it, beforeEach, vi,
} from 'vitest';

import {
  clearMulticamFileRegistry,
  getCalibrationFile,
  getCameraPackageFiles,
  getLastCalibration,
  getMetadataFile,
  mediaFileNamesForImport,
  saveCalibration,
  stashAnnotationFile,
  stashCalibrationFile,
  stashMetadataFile,
} from './multicamFileRegistry';

/** Fixed lastModified so "did the user pick this very file?" is deterministic in tests. */
function file(name: string, content = name): File {
  return new File([content], name, { type: 'application/octet-stream', lastModified: 0 });
}

function fileWithPath(name: string, relPath: string, content = name): File {
  const f = file(name, content);
  Object.defineProperty(f, 'webkitRelativePath', { value: relPath, configurable: true });
  return f;
}

describe('multicamFileRegistry calibration', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    clearMulticamFileRegistry();
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
    });
  });

  it('resolves calibration by basename when stashed with a path-like key', () => {
    const cal = new File(['{}'], 'stereo-cal.json', { type: 'application/json' });
    stashCalibrationFile('folder/stereo-cal.json', cal);
    expect(getCalibrationFile('stereo-cal.json')).toBe(cal);
    expect(getCalibrationFile('folder/stereo-cal.json')).toBe(cal);
  });

  it('does not restore last calibration from localStorage without a session File', async () => {
    await saveCalibration('cal.json');
    clearMulticamFileRegistry();
    await expect(getLastCalibration()).resolves.toBeNull();
  });

  it('restores last calibration when the File is still in the registry', async () => {
    const cal = new File(['{}'], 'cal.json', { type: 'application/json' });
    stashCalibrationFile('cal.json', cal);
    await saveCalibration('cal.json');
    await expect(getLastCalibration()).resolves.toBe('cal.json');
  });
});

describe('multicam camera package construction', () => {
  beforeEach(() => {
    clearMulticamFileRegistry();
  });

  it('flattens folder files before validation so names match uploaded names', () => {
    const folderFiles = [
      fileWithPath('img001.png', 'cam1/img001.png'),
      fileWithPath('img002.png', 'cam1/img002.png'),
    ];
    const { files: cameraFiles } = getCameraPackageFiles(folderFiles);
    // The server validates and Girder uploads flat basenames, not folder paths.
    expect(cameraFiles.map((f) => f.name)).toEqual(['img001.png', 'img002.png']);
    expect(
      cameraFiles.every((f) => !f.webkitRelativePath || f.webkitRelativePath === f.name),
    ).toBe(true);
  });

  it('reports only media filenames for multicam pre-import validation', () => {
    const files = [
      fileWithPath('img001.png', 'cam1/img001.png'),
      fileWithPath('frame_metadata.csv', 'cam1/frame_metadata.csv'),
      fileWithPath('tracks.csv', 'cam1/tracks.csv'),
    ];
    expect(mediaFileNamesForImport(files, 'image-sequence')).toEqual(['img001.png']);
  });

  it('reports TIFF camera files as media so Begin Import stays enabled', () => {
    // Subfolder discovery registers a camera folder of .tif images (the SealTK IR layout) and
    // imports it as large-image; reporting zero files here disables Begin Import permanently.
    const files = [
      fileWithPath('ir_0001.tif', 'ir/ir_0001.tif'),
      fileWithPath('ir_0002.TIFF', 'ir/ir_0002.TIFF'),
      fileWithPath('scan.nitf', 'ir/scan.nitf'),
      fileWithPath('notes.txt', 'ir/notes.txt'),
    ];
    expect(mediaFileNamesForImport(files, 'image-sequence')).toEqual([
      'ir_0001.tif', 'ir_0002.TIFF', 'scan.nitf',
    ]);
  });

  it('appends the explicit track file to the validation input', () => {
    const folderFiles = [file('img001.png')];
    const track = file('tracks.csv');
    stashAnnotationFile('cam1/tracks.csv', track);
    const { files: cameraFiles, replaced } = getCameraPackageFiles(folderFiles, 'cam1/tracks.csv');
    expect(cameraFiles.map((f) => f.name)).toEqual(['img001.png', 'tracks.csv']);
    expect(cameraFiles).toContain(track);
    expect(replaced).toEqual([]);
  });

  it('deduplicates the explicit track file by name', () => {
    const track = file('tracks.csv');
    stashAnnotationFile('cam1/tracks.csv', track);
    // The same File object is also part of the camera folder selection.
    const folderFiles = [file('img001.png'), track];
    const { files: cameraFiles, replaced } = getCameraPackageFiles(folderFiles, 'cam1/tracks.csv');
    expect(cameraFiles.map((f) => f.name)).toEqual(['img001.png', 'tracks.csv']);
    expect(cameraFiles.filter((f) => f.name === 'tracks.csv')).toHaveLength(1);
    // Re-picking the folder's own file is not a file leaving the upload.
    expect(replaced).toEqual([]);
  });

  it('uploads the explicitly picked track file, and reports the folder copy it displaced', () => {
    const explicitTrack = file('tracks.csv', 'chosen elsewhere');
    stashAnnotationFile('cam1/tracks.csv', explicitTrack);
    const folderTrack = file('tracks.csv', 'the camera folder copy');
    const folderFiles = [file('img001.png'), folderTrack];
    const { files: cameraFiles, replaced } = getCameraPackageFiles(folderFiles, 'cam1/tracks.csv');
    expect(cameraFiles.map((f) => f.name)).toEqual(['img001.png', 'tracks.csv']);
    expect(cameraFiles).toContain(explicitTrack);
    expect(cameraFiles).not.toContain(folderTrack);
    expect(replaced).toEqual([folderTrack]);
  });

  it('keeps same-named camera metadata selections under distinct keys', () => {
    const left = new File(['left'], 'frame_metadata.csv', { type: 'text/csv' });
    const right = new File(['right'], 'frame_metadata.csv', { type: 'text/csv' });
    stashMetadataFile('metadata-selection-left', left);
    stashMetadataFile('metadata-selection-right', right);

    expect(getMetadataFile('metadata-selection-left')).toBe(left);
    expect(getMetadataFile('metadata-selection-right')).toBe(right);
    expect(getMetadataFile('frame_metadata.csv')).toBeUndefined();
  });

  it('removes an explicitly selected in-folder attachment before flattening', () => {
    const selected = file('frame_metadata.csv');
    stashMetadataFile('metadata-selection-left', selected);
    const { files: cameraFiles, replaced } = getCameraPackageFiles([
      fileWithPath('img001.png', 'left/img001.png'),
      fileWithPath('frame_metadata.csv', 'left/frame_metadata.csv'),
    ], undefined, 'metadata-selection-left');

    expect(cameraFiles.map((entry) => entry.name)).toEqual(['img001.png']);
    // The attachment is uploaded separately, so re-picking it drops nothing.
    expect(replaced).toEqual([]);
  });

  it('reports a camera-folder sidecar displaced by a same-named metadata pick', () => {
    // The metadata attachment is never added back to the package, so a distinct folder file
    // of the same name would otherwise leave the upload with no message at all.
    const picked = file('nav.csv', 'chosen from another directory');
    stashMetadataFile('metadata-selection-left', picked);
    const folderSidecar = fileWithPath('nav.csv', 'left/nav.csv', 'the camera folder sidecar');
    const { files: cameraFiles, replaced } = getCameraPackageFiles([
      fileWithPath('img001.png', 'left/img001.png'),
      folderSidecar,
    ], undefined, 'metadata-selection-left');

    expect(cameraFiles.map((entry) => entry.name)).toEqual(['img001.png']);
    expect(replaced).toEqual([folderSidecar]);
  });

  it('keeps camera-folder annotations and sidecars in the package, not just media', () => {
    // tracks.csv and frame_metadata.csv are auto-detected in the camera folder; both
    // must ride along with the camera, not just the media.
    const folderFiles = [file('img001.png'), file('tracks.csv'), file('frame_metadata.csv')];
    expect(getCameraPackageFiles(folderFiles).files.map((f) => f.name)).toEqual([
      'img001.png', 'tracks.csv', 'frame_metadata.csv',
    ]);
  });
});
