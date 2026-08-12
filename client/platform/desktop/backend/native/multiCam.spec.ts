import mockfs from 'mock-fs';
import fs from 'fs-extra';
import { Console } from 'console';

import type {
  MultiCamImportFolderArgs,
  MultiCamImportKeywordArgs,
} from 'dive-common/apispec';
import type {
  MultiCamDesktop,
} from 'platform/desktop/constants';

// import { checkMedia, convertMedia } from './mediaJobs';
import beginMultiCamImport from './multiCamImport';
// https://github.com/tschaub/mock-fs/issues/234
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const console = new Console(process.stdout, process.stderr);
const multiCamSetup = fs.readJSONSync('../testutils/multicam.spec.json');

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra') & { default: typeof import('fs-extra') }>('fs-extra');
  const fsNode = await import('node:fs');
  const existsByStat = (targetPath: Parameters<typeof fsNode.statSync>[0]) => {
    try {
      fsNode.statSync(targetPath);
      return true;
    } catch {
      return false;
    }
  };

  const patchedDefault = {
    ...actual.default,
    existsSync: existsByStat,
    pathExistsSync: existsByStat,
  };

  return {
    ...actual,
    default: patchedDefault,
    existsSync: existsByStat,
    pathExistsSync: existsByStat,
  };
});

vi.mock('./mediaJobs', () => ({
  checkMedia: vi.fn((file: string) => Promise.resolve({
    websafe: file.includes('mp4'),
    originalFpsString: '30/1',
    originalFps: 30,
    videoDimensions: { width: 1920, height: 1080 },
  })),
}));

beforeEach(() => {
  mockfs(multiCamSetup.mockfs);
});

type FolderTest = Record<string, {
  input: MultiCamImportFolderArgs;
  output: {
    multiCam: MultiCamDesktop;
    mediaConvertList?: string[];
  };
}>;

type Keyword = Record<string, {
  input: MultiCamImportKeywordArgs;
  output: {
    multiCam: MultiCamDesktop;
    mediaConvertList?: string[];
  };
}>;

type FailingFolder = Record<string, {
  input: MultiCamImportFolderArgs;
  output: {
    error: string;
  };
}>;

type FailingKeyword= Record<string, {
  input: MultiCamImportKeywordArgs;
  output: {
    error: string;
  };
}>;

describe('native.multiCamImport', () => {
  it('uses datasetName when provided for folder imports', async () => {
    const output = await beginMultiCamImport({
      datasetName: 'my_stereo_scene',
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/stereoLeftRightImages/left', trackFile: '' },
        right: { sourcePath: '/home/user/data/stereoLeftRightImages/right', trackFile: '' },
      },
      type: 'image-sequence',
    });
    expect(output.jsonConfig.name).toBe('my_stereo_scene');
  });

  it('carries one camera-local metadata attachment into the camera record', async () => {
    const metadataFile = '/home/user/data/local.csv';

    const output = await beginMultiCamImport({
      datasetName: 'my_stereo_scene',
      defaultDisplay: 'left',
      sourceList: {
        left: {
          sourcePath: '/home/user/data/stereoLeftRightImages/left',
          trackFile: '',
          metadataFile,
        },
        right: { sourcePath: '/home/user/data/stereoLeftRightImages/right', trackFile: '' },
      },
      type: 'image-sequence',
    });

    expect(output.jsonConfig.multiCam?.cameras.left.metadataFile).toBe(metadataFile);
    expect(output.jsonConfig.multiCam?.cameras.left.metadataOriginalName).toBe('local.csv');
    expect(output.jsonConfig.multiCam?.cameras.right.metadataFile).toBeUndefined();
  });

  it('discovers shared and camera archive attachments by directory', async () => {
    const output = await beginMultiCamImport({
      datasetName: 'archive_multicam',
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/archiveMulticam/left', trackFile: '' },
        right: { sourcePath: '/home/user/data/archiveMulticam/right', trackFile: '' },
      },
      type: 'image-sequence',
    });

    expect(output.metadataFileAbsPath)
      .toBe('/home/user/data/archiveMulticam/metadata/shared.csv');
    expect(output.jsonConfig.metadataFile).toBeUndefined();
    expect(output.jsonConfig.multiCam?.cameras.left.metadataFile)
      .toBe('/home/user/data/archiveMulticam/left/metadata/local.csv');
    expect(output.jsonConfig.multiCam?.cameras.right.metadataFile).toBeUndefined();
  });

  it('imports an archive whose meta.json carries only a legacy item-id locator', async () => {
    // What today's upstream/main writes: a bare Girder item id in meta.json and the attachment
    // at the archive root. Nothing to discover, and nothing to fail on.
    const output = await beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/upstreamArchiveMulticam/left', trackFile: '' },
        right: { sourcePath: '/home/user/data/upstreamArchiveMulticam/right', trackFile: '' },
      },
      type: 'image-sequence',
    });

    expect(output.metadataFileAbsPath).toBeUndefined();
    expect(output.jsonConfig.metadataFile).toBeUndefined();
    expect(output.jsonConfig.multiCam?.cameras.left.metadataFile).toBeUndefined();
    expect(output.jsonConfig.multiCam?.cameras.right.metadataFile).toBeUndefined();
  });

  it('rejects an archive metadata directory holding more than one file', async () => {
    await fs.writeFile('/home/user/data/archiveMulticam/metadata/extra.csv', 'filename,depth\n');

    await expect(beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/archiveMulticam/left', trackFile: '' },
        right: { sourcePath: '/home/user/data/archiveMulticam/right', trackFile: '' },
      },
      type: 'image-sequence',
    })).rejects.toThrow(
      'More than one metadata file was found in the archive metadata directory.'
      + ' Keep one and try again.',
    );
  });

  it('rejects an archive metadata attachment of an unsupported type', async () => {
    await fs.remove('/home/user/data/archiveMulticam/metadata/shared.csv');
    await fs.writeFile('/home/user/data/archiveMulticam/metadata/shared.png', '');

    await expect(beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/archiveMulticam/left', trackFile: '' },
        right: { sourcePath: '/home/user/data/archiveMulticam/right', trackFile: '' },
      },
      type: 'image-sequence',
    })).rejects.toThrow('Archive metadata attachment must be a JSON, TXT, or CSV file');
  });

  it('finds an archive attachment a rewriting tool nested one level down', async () => {
    // The Python twin walks metadata/ with rglob and pins this same shape in
    // server/tests/test_multicam_zip_import.py. A flat-only readdir here would drop the file
    // silently, because the import skips the metadata directory when uploading media.
    await fs.remove('/home/user/data/archiveMulticam/metadata/shared.csv');
    await fs.ensureDir('/home/user/data/archiveMulticam/metadata/nested');
    await fs.writeFile(
      '/home/user/data/archiveMulticam/metadata/nested/shared.csv',
      'filename,depth\n',
    );

    const output = await beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/archiveMulticam/left', trackFile: '' },
        right: { sourcePath: '/home/user/data/archiveMulticam/right', trackFile: '' },
      },
      type: 'image-sequence',
    });

    expect(output.metadataFileAbsPath)
      .toBe('/home/user/data/archiveMulticam/metadata/nested/shared.csv');
    expect(output.jsonConfig.metadataFile).toBeUndefined();
  });

  it('ignores an empty directory beside one archive attachment', async () => {
    await fs.ensureDir('/home/user/data/archiveMulticam/metadata/empty');

    const output = await beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/archiveMulticam/left', trackFile: '' },
        right: { sourcePath: '/home/user/data/archiveMulticam/right', trackFile: '' },
      },
      type: 'image-sequence',
    });

    expect(output.metadataFileAbsPath)
      .toBe('/home/user/data/archiveMulticam/metadata/shared.csv');
    expect(output.jsonConfig.metadataFile).toBeUndefined();
  });

  it('lets an explicit camera pick stand where discovery finds an ambiguous folder', async () => {
    // Two reserved-name files beside the media: the server prefers the explicit selection
    // rather than refusing the folder, and so does desktop.
    await fs.writeFile('/home/user/data/stereoLeftRightImages/left/frame_metadata.csv', 'filename,depth\n');
    await fs.writeFile('/home/user/data/stereoLeftRightImages/left/frame-metadata.txt', 'filename,depth\n');

    const output = await beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: {
          sourcePath: '/home/user/data/stereoLeftRightImages/left',
          trackFile: '',
          metadataFile: '/home/user/data/local.csv',
        },
        right: { sourcePath: '/home/user/data/stereoLeftRightImages/right', trackFile: '' },
      },
      type: 'image-sequence',
    });

    expect(output.jsonConfig.multiCam?.cameras.left.metadataFile).toBe('/home/user/data/local.csv');
  });

  it('rejects an ambiguous camera folder when nothing was picked for it', async () => {
    await fs.writeFile('/home/user/data/stereoLeftRightImages/left/frame_metadata.csv', 'filename,depth\n');
    await fs.writeFile('/home/user/data/stereoLeftRightImages/left/frame-metadata.txt', 'filename,depth\n');

    await expect(beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/stereoLeftRightImages/left', trackFile: '' },
        right: { sourcePath: '/home/user/data/stereoLeftRightImages/right', trackFile: '' },
      },
      type: 'image-sequence',
    })).rejects.toThrow(
      'More than one metadata file was found in /home/user/data/stereoLeftRightImages/left.'
      + ' Keep one and try again.',
    );
  });

  it('treats reserved metadata beside same-directory videos as shared', async () => {
    const output = await beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/sharedVideos/left.mp4', trackFile: '' },
        right: { sourcePath: '/home/user/data/sharedVideos/right.mp4', trackFile: '' },
      },
      type: 'video',
    });

    expect(output.metadataFileAbsPath)
      .toBe('/home/user/data/sharedVideos/frame_metadata.csv');
    expect(output.jsonConfig.metadataFile).toBeUndefined();
    expect(output.jsonConfig.multiCam?.cameras.left.metadataFile).toBeUndefined();
    expect(output.jsonConfig.multiCam?.cameras.right.metadataFile).toBeUndefined();
  });

  it('lets ImportDialog clear a discovered shared multicam attachment', async () => {
    // Shared discovery must land on metadataFileAbsPath (dialog-bound), not jsonConfig,
    // or clearing the field would still leave finalize attaching the discovered file.
    const output = await beginMultiCamImport({
      defaultDisplay: 'left',
      sourceList: {
        left: { sourcePath: '/home/user/data/sharedVideos/left.mp4', trackFile: '' },
        right: { sourcePath: '/home/user/data/sharedVideos/right.mp4', trackFile: '' },
      },
      type: 'video',
    });

    expect(output.metadataFileAbsPath)
      .toBe('/home/user/data/sharedVideos/frame_metadata.csv');
    output.metadataFileAbsPath = '';
    expect(output.jsonConfig.metadataFile).toBeUndefined();
  });

  if (multiCamSetup.folderTests) {
    const folderTests = (multiCamSetup.folderTests as FolderTest);
    Object.entries(folderTests).forEach(([key, val]) => {
      it(`Test Folder Import: ${key}`, async () => {
        const output = await beginMultiCamImport(val.input);
        expect(output.jsonConfig.multiCam).toEqual(val.output.multiCam);
        expect(output.mediaConvertList).toEqual(val.output.mediaConvertList);
      });
    });
  }
  if (multiCamSetup.keywordTests) {
    const keywordTests = (multiCamSetup.keywordTests as Keyword);
    Object.entries(keywordTests).forEach(([key, val]) => {
      it(`Test Keyword Import: ${key}`, async () => {
        const output = await beginMultiCamImport(val.input);
        expect(output.jsonConfig.multiCam).toEqual(val.output.multiCam);
        expect(output.mediaConvertList).toEqual(val.output.mediaConvertList);
      });
    });
  }
  if (multiCamSetup.failingFolderTests) {
    const failingFolderTests = (multiCamSetup.failingFolderTests as FailingFolder);
    Object.entries(failingFolderTests).forEach(([key, val]) => {
      it(`Failing Folder Test: ${key}`, async () => {
        await expect(beginMultiCamImport(val.input))
          .rejects.toThrow(val.output.error);
      });
    });
  }
  if (multiCamSetup.failingKeywordTests) {
    const failingKeywordTests = (multiCamSetup.failingKeywordTests as FailingKeyword);
    Object.entries(failingKeywordTests).forEach(([key, val]) => {
      it(`Failing Folder Test: ${key}`, async () => {
        await expect(beginMultiCamImport(val.input))
          .rejects.toThrow(val.output.error);
      });
    });
  }
});

afterEach(() => {
  mockfs.restore();
});
