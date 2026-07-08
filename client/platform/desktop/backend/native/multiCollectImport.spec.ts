import mockfs from 'mock-fs';
import { Console } from 'console';

// https://github.com/tschaub/mock-fs/issues/234
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const console = new Console(process.stdout, process.stderr);

vi.mock('fs-extra', async () => {
  const actual = await vi.importActual<typeof import('fs-extra')>('fs-extra');
  const fsNode = await import('node:fs');
  const existsByStat = (targetPath: import('node:fs').PathLike) => {
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
  checkMedia: vi.fn(() => Promise.resolve({
    websafe: true,
    originalFpsString: '30/1',
    originalFps: 30,
    videoDimensions: { width: 1920, height: 1080 },
  })),
}));

// eslint-disable-next-line import/first
import scanMultiCamBatch from './multiCollectImport';
// eslint-disable-next-line import/first
import beginMultiCamImport from './multiCamImport';

const frames = (count: number, prefix = 'frame') => {
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i += 1) {
    files[`${prefix}_${String(i).padStart(4, '0')}.png`] = '';
  }
  return files;
};

afterEach(() => {
  mockfs.restore();
});

describe('native.multiCollectImport', () => {
  it('produces import args for every valid collect', async () => {
    mockfs({
      '/survey': {
        fl01: { EO: frames(3), IR: frames(3), UV: frames(3) },
        fl02: { EO: frames(2), IR: frames(2), UV: frames(2) },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['EO', 'IR', 'UV']);
    expect(result.collects.map((c) => c.name)).toEqual(['fl01', 'fl02']);
    result.collects.forEach((collect) => {
      expect(collect.problems).toEqual([]);
      expect(collect.warnings).toEqual([]);
      expect(collect.importArgs).not.toBeNull();
      expect(collect.importArgs?.datasetName).toBe(collect.name);
      expect(collect.importArgs?.cameraOrder).toEqual(['EO', 'IR', 'UV']);
      expect(collect.importArgs?.type).toBe('image-sequence');
      // EO is preferred as default display when present
      expect(collect.importArgs?.defaultDisplay).toBe('EO');
      expect(collect.importArgs?.sourceList).toEqual({
        EO: { sourcePath: `/survey/${collect.name}/EO`, trackFile: '' },
        IR: { sourcePath: `/survey/${collect.name}/IR`, trackFile: '' },
        UV: { sourcePath: `/survey/${collect.name}/UV`, trackFile: '' },
      });
    });
  });

  it('flags a collect missing a camera folder without blocking others', async () => {
    mockfs({
      '/survey': {
        fl01: { EO: frames(3), IR: frames(3) },
        fl02: { EO: frames(3) },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['EO', 'IR']);
    const [fl01, fl02] = result.collects;
    expect(fl01.problems).toEqual([]);
    expect(fl01.importArgs).not.toBeNull();
    expect(fl02.problems).toEqual(['Missing camera folder "IR"']);
    expect(fl02.importArgs).toBeNull();
  });

  it('distinguishes empty camera folders from folders with no supported images', async () => {
    mockfs({
      '/survey': {
        fl01: { EO: frames(2), IR: frames(2) },
        fl02: { EO: frames(2), IR: {} },
        fl03: { EO: frames(2), IR: { 'notes.txt': 'x' } },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    const [, fl02, fl03] = result.collects;
    expect(fl02.problems).toEqual(['Camera folder "IR" is empty']);
    expect(fl03.problems).toEqual(['No supported images in camera folder "IR"']);
    expect(fl02.importArgs).toBeNull();
    expect(fl03.importArgs).toBeNull();
  });

  it('ignores non-camera folders and loose files inside collects', async () => {
    mockfs({
      '/survey': {
        'flight_manifest.csv': 'a,b',
        fl01: {
          EO: frames(2),
          IR: frames(2),
          logs: { 'run.log': 'ok' },
          'readme.txt': 'notes',
        },
        fl02: { EO: frames(2), IR: frames(2), logs: {} },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    expect(result.problems).toEqual([]);
    expect(result.cameraNames).toEqual(['EO', 'IR']);
    expect(result.collects.map((c) => c.name)).toEqual(['fl01', 'fl02']);
    result.collects.forEach((collect) => {
      expect(collect.problems).toEqual([]);
      expect(Object.keys(collect.importArgs?.sourceList ?? {})).toEqual(['EO', 'IR']);
    });
  });

  it('warns (without blocking) on frame count mismatch between cameras', async () => {
    mockfs({
      '/survey': {
        fl01: { EO: frames(3), IR: frames(2) },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    const [fl01] = result.collects;
    expect(fl01.problems).toEqual([]);
    expect(fl01.warnings).toEqual(['Frame counts differ across cameras (EO: 3, IR: 2)']);
    expect(fl01.importArgs).not.toBeNull();
    expect(fl01.cameras.map((c) => c.imageCount)).toEqual([3, 2]);
  });

  it('matches camera folders case-insensitively across collects', async () => {
    mockfs({
      '/survey': {
        fl01: { EO: frames(2), IR: frames(2) },
        fl02: { eo: frames(2), ir: frames(2) },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    expect(result.cameraNames).toEqual(['EO', 'IR']);
    const [, fl02] = result.collects;
    expect(fl02.problems).toEqual([]);
    expect(fl02.importArgs?.sourceList).toEqual({
      EO: { sourcePath: '/survey/fl02/eo', trackFile: '' },
      IR: { sourcePath: '/survey/fl02/ir', trackFile: '' },
    });
  });

  it('prefers a center camera for defaultDisplay and the STAR/CENTER/PORT order', async () => {
    mockfs({
      '/survey': {
        fl01: { CENTER: frames(2), PORT: frames(2), STAR: frames(2) },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    expect(result.cameraNames).toEqual(['STAR', 'CENTER', 'PORT']);
    expect(result.collects[0].importArgs?.defaultDisplay).toBe('CENTER');
  });

  it('reports a root problem when no collect folders exist', async () => {
    mockfs({ '/survey': { 'stray.png': '' } });
    const result = await scanMultiCamBatch('/survey');
    expect(result.problems).toEqual(['No collect folders found in /survey']);
    expect(result.collects).toEqual([]);
  });

  it('blocks all collects when fewer than two cameras are shared', async () => {
    mockfs({
      '/survey': {
        fl01: { EO: frames(2) },
        fl02: { EO: frames(2) },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    expect(result.problems).toEqual([
      'Expected 2 or 3 camera folders shared across collects, found 1 (EO)',
    ]);
    result.collects.forEach((collect) => {
      expect(collect.importArgs).toBeNull();
    });
  });

  it('blocks all collects when more than three cameras are shared', async () => {
    mockfs({
      '/survey': {
        fl01: {
          A: frames(1), B: frames(1), C: frames(1), D: frames(1),
        },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    expect(result.problems).toEqual([
      'Expected 2 or 3 camera folders shared across collects, found 4 (A, B, C, D)',
    ]);
    expect(result.collects[0].importArgs).toBeNull();
  });

  it('rejects camera folder names that are not alphanumeric', async () => {
    mockfs({
      '/survey': {
        fl01: { 'EO cam': frames(2), IR: frames(2) },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    expect(result.problems).toEqual([
      'Camera folder names must be letters and numbers only (no spaces): EO cam',
    ]);
    expect(result.collects[0].importArgs).toBeNull();
  });

  it('throws when the root path does not exist', async () => {
    mockfs({ '/survey': {} });
    await expect(scanMultiCamBatch('/missing')).rejects.toThrow('Directory not found');
  });

  it('produces args accepted by beginMultiCamImport', async () => {
    mockfs({
      '/survey': {
        fl01: { EO: frames(2), IR: frames(2) },
      },
    });
    const result = await scanMultiCamBatch('/survey');
    const { importArgs } = result.collects[0];
    expect(importArgs).not.toBeNull();
    if (!importArgs) {
      return;
    }
    const imported = await beginMultiCamImport(importArgs);
    expect(imported.jsonMeta.name).toBe('fl01');
    expect(imported.jsonMeta.subType).toBe('multicam');
    expect(imported.jsonMeta.multiCam?.defaultDisplay).toBe('EO');
    expect(Object.keys(imported.jsonMeta.multiCam?.cameras ?? {})).toEqual(['EO', 'IR']);
    expect(imported.jsonMeta.multiCam?.cameras.EO.originalBasePath).toBe('/survey/fl01/EO');
    expect(imported.jsonMeta.multiCam?.cameras.EO.originalImageFiles).toHaveLength(2);
  });
});
