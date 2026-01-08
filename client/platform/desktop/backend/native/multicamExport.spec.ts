import mockfs from 'mock-fs';
import npath from 'path';
import fs from 'fs-extra';

import type { Settings } from 'platform/desktop/constants';
import { exportMulticamEverything } from './multicamExport';

/**
 * Captures the staged export directory before it is zipped and removed. Zipping is the only
 * thing replaced here; everything the export writes is real (mocked) filesystem work.
 * mock-fs only backs the asynchronous fs API in this environment, so the snapshot is async and
 * the mocked archive holds its "finished" event until the snapshot completes.
 */
const zipMock = vi.hoisted(() => ({
  staged: {} as Record<string, string>,
  snapshot: null as null | ((dir: string) => Promise<Record<string, string>>),
}));

vi.mock('archiver', () => ({
  default: () => {
    let piped: { end: () => void } | undefined;
    let pending: Promise<unknown> = Promise.resolve();
    const archive = {
      on: () => archive,
      pipe: (output: { end: () => void }) => { piped = output; },
      directory: (sourceDir: string) => {
        pending = zipMock.snapshot!(sourceDir)
          .then((tree) => Object.assign(zipMock.staged, tree));
      },
      finalize: () => { pending.then(() => piped?.end()); },
    };
    return archive;
  },
}));

async function snapshot(dir: string, prefix = ''): Promise<Record<string, string>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const trees = await Promise.all(entries.map(async (entry) => {
    const full = npath.join(dir, entry.name);
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory()
      ? snapshot(full, key)
      : { [key]: await fs.readFile(full, 'utf-8') };
  }));
  return Object.assign({}, ...trees);
}
zipMock.snapshot = (dir: string) => snapshot(dir);

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

  const patchedDefault = { ...actual.default, existsSync: existsByStat, pathExistsSync: existsByStat };
  return {
    ...actual, default: patchedDefault, existsSync: existsByStat, pathExistsSync: existsByStat,
  };
});

const settings: Settings = {
  version: 1,
  dataPath: '/home/user/viamedata',
  viamePath: '/opt/viame',
  readonlyMode: false,
  nativeVideoPlayback: false,
  overrides: {},
};

const projectDir = '/home/user/viamedata/DIVE_Projects/multicamExport';

function cameraMeta(camera: string) {
  return {
    version: 1,
    id: `multicamExport/${camera}`,
    name: camera,
    type: 'image-sequence',
    fps: 5,
    originalFps: 5,
    originalBasePath: `/home/user/data/multicamExport/${camera}`,
    originalImageFiles: [`img_${camera}.png`],
    originalVideoFile: '',
    transcodedImageFiles: [],
    transcodedVideoFile: '',
    multiCam: null,
    subType: null,
  };
}

beforeEach(() => {
  zipMock.staged = {};
  mockfs({
    '/tmp': {},
    '/home/user/output': {},
    '/home/user/data/multicamExport': {
      left: { 'img_left.png': '' },
      right: { 'img_right.png': '' },
    },
    '/home/user/viamedata': {
      DIVE_Projects: {
        multicamExport: {
          'meta.json': JSON.stringify({
            version: 1,
            id: 'multicamExport',
            name: 'reef_survey',
            type: 'multi',
            fps: 5,
            originalFps: 5,
            originalBasePath: '/home/user/data/multicamExport',
            originalImageFiles: [],
            originalVideoFile: '',
            transcodedImageFiles: [],
            transcodedVideoFile: '',
            subType: 'stereo',
            metadataFile: `${projectDir}/auxiliary/flight_log.csv`,
            metadataOriginalName: 'flight_log.csv',
            multiCam: {
              defaultDisplay: 'left',
              cameraOrder: ['left', 'right'],
              cameras: {
                left: {
                  ...cameraMeta('left'),
                  metadataFile: `${projectDir}/auxiliary/left/left_log.csv`,
                  metadataOriginalName: 'left_log.csv',
                },
                right: cameraMeta('right'),
              },
            },
          }),
          'result_1.json': JSON.stringify({}),
          auxiliary: {
            'flight_log.csv': 'filename,altitude\nimg_left.png,120\n',
            left: { 'left_log.csv': 'filename,depth\nimg_left.png,10\n' },
          },
          left: {
            'meta.json': JSON.stringify({
              ...cameraMeta('left'),
              metadataFile: `${projectDir}/auxiliary/left/left_log.csv`,
              metadataOriginalName: 'left_log.csv',
            }),
            'result_1.json': JSON.stringify({}),
            auxiliary: {},
          },
          right: {
            'meta.json': JSON.stringify(cameraMeta('right')),
            'result_1.json': JSON.stringify({}),
            auxiliary: {},
          },
        },
      },
    },
  });
});

afterEach(() => {
  mockfs.restore();
});

describe('exportMulticamEverything', () => {
  it('writes each scope\'s attachment under its own metadata directory', async () => {
    const path = await exportMulticamEverything(settings, {
      id: 'multicamExport',
      path: '/home/user/output/reef_survey.zip',
      exclude: false,
      typeFilter: new Set<string>(),
    });

    expect(path).toBe('/home/user/output/reef_survey.zip');
    // Dataset scope at <dataset>/metadata/, camera scope at <dataset>/<camera>/metadata/ --
    // the two places both importers look.
    expect(zipMock.staged['reef_survey/metadata/flight_log.csv']).toContain('img_left.png,120');
    expect(zipMock.staged['reef_survey/left/metadata/left_log.csv']).toContain('img_left.png,10');
    expect(zipMock.staged['reef_survey/right/metadata/left_log.csv']).toBeUndefined();
    expect(zipMock.staged['reef_survey/annotations.dive.json']).toBeDefined();
    expect(zipMock.staged['reef_survey/left/annotations.dive.json']).toBeDefined();
  });

  it('never writes a local attachment path into the archive config.json', async () => {
    await exportMulticamEverything(settings, {
      id: 'multicamExport',
      path: '/home/user/output/reef_survey.zip',
      exclude: false,
      typeFilter: new Set<string>(),
    });

    // A locator would be this machine's absolute path; a re-import would read it as a local
    // file that does not exist there. Importers discover the attachment by directory instead.
    const meta = JSON.parse(zipMock.staged['reef_survey/config.json']);
    expect(meta.metadataFile).toBeUndefined();
    expect(meta.metadataOriginalName).toBeUndefined();
    expect(meta.multiCam.cameras.left.metadataFile).toBeUndefined();
    expect(meta.multiCam.cameras.left.metadataOriginalName).toBeUndefined();

    const multiCam = JSON.parse(zipMock.staged['reef_survey/multiCam.json']);
    expect(multiCam.cameras.left.metadataFile).toBeUndefined();

    const leftMeta = JSON.parse(zipMock.staged['reef_survey/left/config.json']);
    expect(leftMeta.metadataFile).toBeUndefined();
    expect(leftMeta.metadataOriginalName).toBeUndefined();
  });
});
