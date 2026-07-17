// eslint-disable-next-line import/no-extraneous-dependencies -- Vitest is only used in tests
import { describe, expect, it } from 'vitest';

import { buildValidatedUploadPackage } from './uploadPackage';
import type { ValidationResponse } from './api/dataset.service';

function file(name: string): File {
  return new File([name], name, { type: 'application/octet-stream' });
}

function validation(overrides: Partial<ValidationResponse>): ValidationResponse {
  return {
    ok: true,
    type: 'image-sequence',
    message: '',
    roles: {
      media: [],
      annotations: [],
      datasetConfig: [],
      frameMetadata: [],
    },
    upload: [],
    ignored: [],
    ...overrides,
  };
}

describe('buildValidatedUploadPackage', () => {
  it('keeps both an annotation CSV and a frame-metadata sidecar in uploadFiles', () => {
    const selected = [file('img001.png'), file('annotations.csv'), file('frame_metadata.csv')];
    const resp = validation({
      roles: {
        media: ['img001.png'],
        annotations: ['annotations.csv'],
        datasetConfig: [],
        frameMetadata: ['frame_metadata.csv'],
      },
      upload: ['img001.png', 'annotations.csv', 'frame_metadata.csv'],
    });

    const { uploadFiles, roles, ignored } = buildValidatedUploadPackage(selected, resp);

    expect(uploadFiles.map((f) => f.name)).toEqual([
      'img001.png',
      'annotations.csv',
      'frame_metadata.csv',
    ]);
    // The original File objects are preserved.
    expect(uploadFiles).toEqual([selected[0], selected[1], selected[2]]);
    expect(roles).toBe(resp.roles);
    expect(ignored).toBe(resp.ignored);
  });

  it('excludes ignored unsupported files from uploadFiles', () => {
    const selected = [file('img001.png'), file('notes.txt')];
    const resp = validation({
      roles: {
        media: ['img001.png'],
        annotations: [],
        datasetConfig: [],
        frameMetadata: [],
      },
      upload: ['img001.png'],
      ignored: [{ name: 'notes.txt', reason: 'Unsupported side file' }],
    });

    const { uploadFiles, ignored } = buildValidatedUploadPackage(selected, resp);

    expect(uploadFiles.map((f) => f.name)).toEqual(['img001.png']);
    expect(uploadFiles.some((f) => f.name === 'notes.txt')).toBe(false);
    expect(ignored).toEqual([{ name: 'notes.txt', reason: 'Unsupported side file' }]);
  });

  it('does not upload files that validation omitted from the upload list', () => {
    const selected = [file('img001.png'), file('img002.png'), file('extra.csv')];
    const resp = validation({
      roles: {
        media: ['img001.png', 'img002.png'],
        annotations: [],
        datasetConfig: [],
        frameMetadata: [],
      },
      // extra.csv is neither uploaded nor ignored: it simply is not consumed.
      upload: ['img001.png', 'img002.png'],
    });

    const { uploadFiles } = buildValidatedUploadPackage(selected, resp);

    expect(uploadFiles.map((f) => f.name)).toEqual(['img001.png', 'img002.png']);
    expect(uploadFiles.some((f) => f.name === 'extra.csv')).toBe(false);
  });

  it('preserves duplicate names only as many times as validation lists them', () => {
    const first = file('dup.png');
    const second = file('dup.png');
    const selected = [first, second];
    const resp = validation({
      roles: {
        media: ['dup.png', 'dup.png'],
        annotations: [],
        datasetConfig: [],
        frameMetadata: [],
      },
      upload: ['dup.png', 'dup.png'],
    });

    const { uploadFiles } = buildValidatedUploadPackage(selected, resp);

    expect(uploadFiles).toEqual([first, second]);
  });

  it('throws when validation references a file that was not selected', () => {
    const selected = [file('img001.png')];
    const resp = validation({
      roles: {
        media: ['img001.png'],
        annotations: ['ghost.csv'],
        datasetConfig: [],
        frameMetadata: [],
      },
      upload: ['img001.png', 'ghost.csv'],
    });

    expect(() => buildValidatedUploadPackage(selected, resp)).toThrow(/ghost\.csv/);
  });

  it('throws when validation lists a name more times than it was selected', () => {
    const selected = [file('img001.png')];
    const resp = validation({
      roles: {
        media: ['img001.png', 'img001.png'],
        annotations: [],
        datasetConfig: [],
        frameMetadata: [],
      },
      upload: ['img001.png', 'img001.png'],
    });

    expect(() => buildValidatedUploadPackage(selected, resp)).toThrow(/img001\.png/);
  });
});
