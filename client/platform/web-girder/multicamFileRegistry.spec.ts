// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import {
  describe, expect, it, beforeEach, vi,
} from 'vitest';

import {
  clearMulticamFileRegistry,
  getCalibrationFile,
  getCameraPackageFiles,
  getLastCalibration,
  mediaFileNamesForImport,
  saveCalibration,
  stashAnnotationFile,
  stashCalibrationFile,
} from './multicamFileRegistry';
import { buildValidatedUploadPackage } from './uploadPackage';
import type { ValidationResponse } from './api/dataset.service';

function file(name: string): File {
  return new File([name], name, { type: 'application/octet-stream' });
}

function fileWithPath(name: string, relPath: string): File {
  const f = file(name);
  Object.defineProperty(f, 'webkitRelativePath', { value: relPath, configurable: true });
  return f;
}

function validation(overrides: Partial<ValidationResponse>): ValidationResponse {
  return {
    ok: true,
    type: 'image-sequence',
    message: '',
    roles: {
      media: [], annotations: [], datasetConfig: [], frameMetadata: [],
    },
    upload: [],
    ignored: [],
    ...overrides,
  };
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
    const cameraFiles = getCameraPackageFiles(folderFiles);
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

  it('appends the explicit track file to the validation input', () => {
    const folderFiles = [file('img001.png')];
    const track = file('tracks.csv');
    stashAnnotationFile('cam1/tracks.csv', track);
    const cameraFiles = getCameraPackageFiles(folderFiles, 'cam1/tracks.csv');
    expect(cameraFiles.map((f) => f.name)).toEqual(['img001.png', 'tracks.csv']);
    expect(cameraFiles).toContain(track);
  });

  it('deduplicates the explicit track file by name', () => {
    const track = file('tracks.csv');
    stashAnnotationFile('cam1/tracks.csv', track);
    // The same File object is also part of the camera folder selection.
    const folderFiles = [file('img001.png'), track];
    const cameraFiles = getCameraPackageFiles(folderFiles, 'cam1/tracks.csv');
    expect(cameraFiles.map((f) => f.name)).toEqual(['img001.png', 'tracks.csv']);
    expect(cameraFiles.filter((f) => f.name === 'tracks.csv')).toHaveLength(1);
  });

  it('dedupes an explicit track file that shares a name with a folder file (distinct object)', () => {
    const explicitTrack = file('tracks.csv');
    stashAnnotationFile('cam1/tracks.csv', explicitTrack);
    const folderTrack = file('tracks.csv');
    const folderFiles = [file('img001.png'), folderTrack];
    const cameraFiles = getCameraPackageFiles(folderFiles, 'cam1/tracks.csv');
    expect(cameraFiles.map((f) => f.name)).toEqual(['img001.png', 'tracks.csv']);
    expect(cameraFiles).toContain(folderTrack);
    expect(cameraFiles).not.toContain(explicitTrack);
  });

  it('uploads validated camera-folder annotations and sidecars, not just media', () => {
    // tracks.csv and frame_metadata.csv are auto-detected in the camera folder; both
    // must ride along with the camera, which the old media-only path dropped.
    const folderFiles = [file('img001.png'), file('tracks.csv'), file('frame_metadata.csv')];
    const cameraFiles = getCameraPackageFiles(folderFiles);
    const resp = validation({
      roles: {
        media: ['img001.png'],
        annotations: ['tracks.csv'],
        datasetConfig: [],
        frameMetadata: ['frame_metadata.csv'],
      },
      upload: ['img001.png', 'tracks.csv', 'frame_metadata.csv'],
    });
    const { uploadFiles } = buildValidatedUploadPackage(cameraFiles, resp);
    expect(uploadFiles.map((f) => f.name)).toEqual(['img001.png', 'tracks.csv', 'frame_metadata.csv']);
  });

  it('uploads the explicit track file only when validation accepts it', () => {
    const folderFiles = [file('img001.png')];
    const track = file('tracks.csv');
    stashAnnotationFile('cam1/tracks.csv', track);
    const cameraFiles = getCameraPackageFiles(folderFiles, 'cam1/tracks.csv');

    // Accepted: the server lists the track file in upload.
    const accepted = validation({
      roles: {
        media: ['img001.png'], annotations: ['tracks.csv'], datasetConfig: [], frameMetadata: [],
      },
      upload: ['img001.png', 'tracks.csv'],
    });
    expect(buildValidatedUploadPackage(cameraFiles, accepted).uploadFiles).toContain(track);

    // Omitted by validation: the track file is present in the input but not uploaded.
    const omitted = validation({
      roles: {
        media: ['img001.png'], annotations: [], datasetConfig: [], frameMetadata: [],
      },
      upload: ['img001.png'],
    });
    expect(buildValidatedUploadPackage(cameraFiles, omitted).uploadFiles).not.toContain(track);
  });
});
